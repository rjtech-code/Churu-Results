import { RO_STATE, expect, loginUi, test, world } from './support';

test.describe('as the Churu PS RO', () => {
  test.use({ storageState: RO_STATE });

  test("another PS's ward or an unknown entry by direct URL -> not allowed", async ({ page }) => {
    await page.goto(`/wards/${world().otherPsWard}`);
    await expect(page.getByRole('heading', { name: 'अनुमति नहीं' })).toBeVisible();
    await page.goto('/entries/99999999/edit');
    await expect(page.getByRole('heading', { name: 'अनुमति नहीं' })).toBeVisible();
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'पेज नहीं मिला' })).toBeVisible();
  });
});

test('login: wrong password message, then own wards only, then logout', async ({ page }) => {
  await loginUi(page, world().users.roOther, 'not-the-password-1');
  await expect(page.getByRole('alert')).toContainText('गलत यूज़रनेम या पासवर्ड');
  await expect(page.getByLabel('पासवर्ड')).toHaveValue('');
  await loginUi(page, world().users.roOther);
  await expect(page.getByRole('heading', { name: 'मेरे वार्ड' })).toBeVisible();
  await expect(page.locator('table.list tbody tr')).toHaveCount(1);
  await expect(page.locator('table.list tbody tr')).toContainText('वार्ड 1');
  await expect(page.locator('header')).toContainText('राजगढ़'); // the PS is in the header, not each row
  await page.getByRole('button', { name: 'लॉगआउट' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/wards');
  await expect(page).toHaveURL(/\/login$/);
});

test('the DM sees only the placeholder', async ({ page }) => {
  await loginUi(page, world().users.dm);
  await expect(page).toHaveURL(/\/dm$/);
  await expect(page.getByText('जिला निर्वाचन अधिकारी की रिपोर्ट भाग 10 में आएँगी।')).toBeVisible();
  await page.goto('/wards');
  await expect(page).toHaveURL(/\/dm$/);
  await page.goto(`/wards/${world().wards.ready.id}/declare`);
  await expect(page).toHaveURL(/\/dm$/);
});
