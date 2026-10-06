import { backendScript, expect, loginUi, test, world } from './support';

// Uses the ZP RO only, so the stored Churu RO session is never touched.
test.describe.configure({ mode: 'serial' });

test('absolute session expiry -> login page with "session expired"', async ({ page }) => {
  await loginUi(page, world().users.zp);
  await expect(page.getByRole('heading', { name: 'मेरे वार्ड' })).toBeVisible();
  backendScript('expire-sessions.ts', ['age', world().users.zp]);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('सत्र समाप्त, दोबारा लॉगिन करें');
});

test('a deleted session -> login page with "please log in"', async ({ page }) => {
  await loginUi(page, world().users.zp);
  await expect(page.getByRole('heading', { name: 'मेरे वार्ड' })).toBeVisible();
  backendScript('expire-sessions.ts', ['delete', world().users.zp]);
  await page.getByRole('link', { name: 'खोलें' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('कृपया दोबारा लॉगिन करें');
});
