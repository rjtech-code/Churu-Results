import { expect, test, world } from './support';

// The Super Admin makes a key -> a screen (another browser, no key) asks for it -> a wrong key is
// refused -> the right key shows the screen and survives a reload -> switching that screen off and
// on makes it ask again by itself -> revoking the key closes the open screen at once.
//
// Nov 2026: every screen control is the Super Admin's; the DM has no screen page at all, which the
// last check here proves from the browser.
test('screen keys in the Super Admin panel: create, unlock, off-and-on, revoke', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.goto('/superadmin');
  await page.getByLabel('यूज़रनेम').fill(world().users.superAdmin);
  await page.getByLabel('पासवर्ड', { exact: true }).fill(world().password);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  const keys = page.getByTestId('sa-keys');
  await expect(keys).toBeVisible();

  await page.getByLabel('key का नाम (कौन-सा TV / कक्ष)').fill('प्रेस कक्ष e2e');
  await page.getByRole('button', { name: 'Key बनाएँ', exact: true }).click();
  const card = page.getByTestId('sa-key-card').filter({ hasText: 'प्रेस कक्ष e2e' });
  const value = card.getByTestId('sa-key-value');
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
    // Survives a refresh (HttpOnly cookie, nothing typed again) — counting day cannot lose a TV to F5.
    await tv.reload();
    await expect(tv.getByTestId('page-title')).toBeVisible();

    // That key opened screen 1 only: screen 2 in the same browser asks for its own.
    const other = await tvContext.newPage();
    try {
      await other.goto('/screen/2?interval=120');
      await expect(other.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toBeVisible();
    } finally {
      await other.close();
    }

    // Switched OFF from the panel: the TV shows the calm card, by itself, with no key box.
    const screen1 = page.getByTestId('sa-screen-1');
    await screen1.getByRole('button', { name: 'बंद करें' }).click();
    await page.getByRole('button', { name: 'बंद करें' }).last().click();
    await expect(page.getByTestId('sa-done')).toBeVisible();
    await page.getByRole('button', { name: 'ठीक है' }).click();
    await expect(tv.getByTestId('screen-off')).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toHaveCount(0);

    // Switched back ON: the key box appears on the TV by itself — nobody reloads, nobody touches it.
    await expect(screen1.getByRole('button', { name: 'चालू करें' })).toBeVisible();
    await screen1.getByRole('button', { name: 'चालू करें' }).click();
    await page.getByRole('button', { name: 'चालू करें' }).last().click();
    await expect(page.getByTestId('sa-done')).toBeVisible();
    await page.getByRole('button', { name: 'ठीक है' }).click();
    await expect(tv.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(tv.getByTestId('page-title')).toHaveCount(0);

    // The key still works: type it again and the results are back.
    await tv.getByLabel('स्क्रीन key', { exact: true }).fill(key);
    await tv.getByRole('button', { name: 'स्क्रीन खोलें' }).click();
    await expect(tv.getByTestId('page-title')).toBeVisible();

    // Revoked: the open screen goes back to the popup by itself.
    await card.getByRole('button', { name: 'रद्द करें' }).click();
    await page.getByRole('button', { name: 'हाँ, रद्द करें' }).click();
    await expect(page.getByTestId('sa-done')).toBeVisible();
    await expect(tv.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toBeVisible({
      timeout: 15_000,
    });
    expect((await tv.request.get('/api/public/screens/1')).status()).toBe(401);
  } finally {
    await tvContext.close();
  }
});

test('the DM has no screen page left', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('यूज़रनेम').fill(world().users.dm);
  await page.getByLabel('पासवर्ड', { exact: true }).fill(world().password);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  // No link on the reports home, and the old address is not the DM's any more.
  await expect(page.getByRole('link', { name: /स्क्रीन सुरक्षा/ })).toHaveCount(0);
  expect((await page.request.get('/api/admin/screen-keys')).status()).toBe(404);
  expect((await page.request.get('/api/superadmin/screen-keys')).status()).toBe(403);
});
