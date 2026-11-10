import { expect, loginUi, test, world } from './support';

// DM creates a key -> a screen (another browser, no key) asks for it -> a wrong key is refused ->
// the right key shows the screen -> the DM revokes the key -> the open screen asks again at once.
test('screen key: create, refuse wrong key, unlock, revoke closes the open screen', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  await loginUi(page, world().users.dm);
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole('link', { name: 'स्क्रीन सुरक्षा (Screen Keys)' }).click();
  await expect(page.getByRole('heading', { name: 'स्क्रीन सुरक्षा (Screen Keys)' })).toBeVisible();
  await page.getByLabel('key का नाम (कौन-सा TV / कक्ष)').fill('प्रेस कक्ष e2e');
  await page.getByRole('button', { name: 'Key बनाएँ', exact: true }).click();
  await expect(page.getByText('नई key बन गई: प्रेस कक्ष e2e')).toBeVisible();
  const card = page.getByTestId('key-card').filter({ hasText: 'प्रेस कक्ष e2e' });
  const value = card.getByTestId('key-value');
  // The new key is shown at once (highlighted); the eye hides and shows it again.
  await card.getByRole('button', { name: 'key छिपाएँ' }).click();
  await expect(value).toHaveText('••••-••••-••••');
  await card.getByRole('button', { name: 'key दिखाएँ' }).click();
  const key = (await value.innerText()).trim();
  expect(key).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // A second browser (like a phone at home): no key -> only the popup, no data.
  const tvContext = await browser.newContext();
  const tv = await tvContext.newPage();
  try {
    await tv.goto('/screen/1?interval=120');
    const prompt = tv.getByRole('dialog', { name: 'स्क्रीन key डालें' });
    await expect(prompt).toBeVisible();
    await expect(tv.getByTestId('page-title')).toHaveCount(0);
    expect((await tv.request.get('/api/public/screens/1')).status()).toBe(401);

    await tv.getByLabel('स्क्रीन key', { exact: true }).fill('WRNG-WRNG-WRNG');
    await tv.getByRole('button', { name: 'स्क्रीन खोलें' }).click();
    await expect(tv.getByRole('alert')).toContainText('गलत key');

    await tv.getByLabel('स्क्रीन key', { exact: true }).fill(key.toLowerCase());
    await tv.getByRole('button', { name: 'स्क्रीन खोलें' }).click();
    await expect(tv.getByTestId('page-title')).toBeVisible();
    await expect(prompt).toHaveCount(0);
    // Survives a refresh (HttpOnly cookie, nothing typed again).
    await tv.reload();
    await expect(tv.getByTestId('page-title')).toBeVisible();

    // The DM revokes: the open screen goes back to the popup by itself.
    await card.getByRole('button', { name: 'रद्द करें' }).click();
    await page.getByRole('button', { name: 'हाँ, रद्द करें' }).click();
    await expect(
      page.getByText('"प्रेस कक्ष e2e" की key रद्द हो गई। उससे खुली स्क्रीन बंद हो गईं।'),
    ).toBeVisible();
    await expect(tv.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toBeVisible({ timeout: 10_000 });
    await expect(tv.getByTestId('page-title')).toHaveCount(0);
    expect((await tv.request.get('/api/public/screens/1')).status()).toBe(401);
  } finally {
    await tvContext.close();
  }
});
