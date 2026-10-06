import { RO_STATE, expect, test, typeSheet, world } from './support';

test.use({ storageState: RO_STATE });

test('postal entry: rejected postal votes are shown separately, not in the sum', async ({ page }) => {
  const w = world().wards.postal;
  await page.goto(`/wards/${w.id}`);
  await expect(page.getByText('अभी दर्ज नहीं')).toBeVisible();
  await page.getByRole('link', { name: 'डाक मत दर्ज करें' }).click();
  await typeSheet(page, [3, 2, 0], 5);
  await page.locator('#postal-rejected').fill('4');
  await expect(page.getByTestId('postal-sumline')).toContainText('✓ बराबर');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByTestId('confirm-votes')).toHaveText(['3', '2', '0']);
  await expect(page.getByTestId('confirm-total')).toHaveText('5');
  await expect(page.getByTestId('confirm-rejected')).toContainText('4');
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page).toHaveURL(new RegExp(`/wards/${w.id}$`));
  await expect(page.getByText(/✓ दर्ज \(/).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('घोषणा के लिए तैयार');
});

test('postal: an unchanged edit is blocked; the postal history shows the whole story', async ({ page }) => {
  const w = world().wards.postal;
  await page.goto(`/wards/${w.id}`);
  await page.getByRole('link', { name: 'सुधारें' }).first().click();
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveValue('3');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('कोई बदलाव नहीं — सुधार की ज़रूरत नहीं');
  // changing only the rejected count is a real change, so it goes on to the reason check
  await page.locator('#postal-rejected').fill('5');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('कारण चुनें');

  await page.goto(`/wards/${w.id}/postal/history`);
  const rows = page.getByTestId('story').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('डाक मत दर्ज');
});
