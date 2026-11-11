// The OBSERVER journey: login -> executive dashboard -> Panchayat Samiti -> ward -> back ->
// Zila Parishad -> winners -> a report download -> and every RO/DM/admin URL sends the observer
// straight back to the dashboard. The language toggle is remembered in the browser.
import { expect, loginUi, test, world } from './support';

test('observer: dashboard journey, downloads, and no way into operator pages', async ({ page }) => {
  await loginUi(page, world().users.observer);

  // Lands on the observer dashboard (never the RO/DM pages).
  await expect(page).toHaveURL(/\/observer$/);
  await expect(
    page.getByRole('link', { name: 'Churu District Panchayat General Elections 2026 · Counting Dashboard' }),
  ).toBeVisible();

  // Panchayat Samitis -> one PS -> one ward -> back.
  await page.getByRole('link', { name: 'Panchayat Samitis', exact: true }).click();
  await expect(page).toHaveURL(/\/observer\/ps$/);
  await page.getByRole('link', { name: /CHURU/ }).first().click();
  await expect(page).toHaveURL(/\/observer\/ps\/\d+$/);
  await page.getByRole('link', { name: /Ward \d+/ }).first().click();
  await expect(page).toHaveURL(/\/observer\/wards\/\d+$/);
  await expect(page.getByText('Candidate', { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/observer\/ps\/\d+$/);

  // Zila Parishad and winners.
  await page.getByRole('link', { name: 'Zila Parishad', exact: true }).click();
  await expect(page).toHaveURL(/\/observer\/zp$/);
  await page.getByRole('link', { name: 'Winners', exact: true }).click();
  await expect(page).toHaveURL(/\/observer\/winners$/);

  // A report download (audited server-side).
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Ward-wise status (CSV)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('counting-status-district-wards');

  // Every operator URL redirects back to the observer dashboard.
  for (const path of ['/wards', '/reports', '/reports/counting-status', '/admin/users', '/dm']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/observer$/);
  }
  // The Super Admin panel is not reachable either.
  await page.goto('/superadmin');
  await expect(page).toHaveURL(/\/observer$/);

  // The API behind those pages refuses the observer outright.
  const forbidden = await page.request.get('/api/reports/summary');
  expect(forbidden.status()).toBe(403);

  // Language toggle: Hindi labels, remembered across a reload.
  await page.goto('/observer');
  await page.getByRole('button', { name: 'हिंदी' }).click();
  await expect(page.getByRole('link', { name: 'पंचायत समितियाँ' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'पंचायत समितियाँ' })).toBeVisible();
});
