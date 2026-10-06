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
