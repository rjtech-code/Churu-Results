import { RO_STATE, expect, test, world } from './support';

test.use({ storageState: RO_STATE });

test('a correction creates declaration version 2', async ({ page }) => {
  const w = world().wards.correction;
  await page.goto(`/wards/${w.id}`);
  await page.getByRole('link', { name: 'संशोधन / घोषणा के संस्करण' }).click();
  const versions = page.getByTestId('declaration-versions');
  await expect(versions.locator('tbody tr')).toHaveCount(1);

  // Ticking loads the entry first; the box shows ticked once its sheet is there.
  await page.getByRole('checkbox', { name: /बूथ 9/ }).click();
  await expect(page.getByRole('checkbox', { name: /बूथ 9/ })).toBeChecked();
  await expect(page.getByLabel('भरत कुमार के मत')).toHaveValue('100');
  await page.getByLabel('भरत कुमार के मत').fill('110');
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('365');
  await page.getByLabel('संशोधन का कारण (अनिवार्य, 10–500 अक्षर)').fill('पुनर्गणना में बूथ 9 के मत बदले');
  await page.getByRole('button', { name: 'पूर्वावलोकन' }).click();
  await expect(page.getByRole('heading', { name: '3. पुष्टि — नया संस्करण 2' })).toBeVisible();
  await expect(page.getByText('विजेता: अमर सिंह · अंतर: 143')).toBeVisible();
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'संशोधन की पुष्टि करें' }).click();
  await expect(versions.locator('tbody tr')).toHaveCount(2);
});
