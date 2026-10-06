import { RO_STATE, expect, test, typeSheet, world } from './support';

test.use({ storageState: RO_STATE });
test.describe.configure({ mode: 'serial' });

test('ward list, then a booth: a mismatch blocks, the correct sheet saves and the status changes', async ({
  page,
}) => {
  const w = world().wards.entry;
  await page.goto('/');
  await expect(page).toHaveURL(/\/wards$/);
  await expect(page.getByRole('heading', { name: 'मेरे वार्ड' })).toBeVisible();
  await page.getByLabel('वार्ड संख्या से खोजें').fill('1');
  const row = page.getByRole('row', { name: /^वार्ड 1 / });
  await expect(row).toContainText('शुरू नहीं');
  await expect(row).toContainText('0/2');
  await row.getByRole('link', { name: 'खोलें' }).click();

  await page.getByRole('row', { name: /^1 / }).getByRole('link', { name: 'एंट्री करें' }).click();
  await expect(page.getByText('बूथ संख्या 1 — राजकीय विद्यालय 1')).toBeVisible();
  await expect(page.getByLabel('अमर सिंह के मत')).toBeFocused();

  // Wrong total: the live line says so and "आगे" is refused with both numbers.
  await typeSheet(page, [30, 20, 1], 52);
  await expect(page.getByTestId('entry-sumline')).toContainText('आपका जोड़: 51 | पर्ची का योग: 52');
  await expect(page.getByTestId('entry-sumline')).toContainText('✗ बराबर नहीं');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('आपका जोड़ 51');
  await expect(page.getByText('पुष्टि करें — बूथ 1')).toHaveCount(0);

  // Correct the total and use Enter (as an operator would) to reach the confirm screen.
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('51');
  await expect(page.getByTestId('entry-sumline')).toContainText('✓ बराबर');
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').press('Enter');
  await expect(page.getByText('पुष्टि करें — बूथ 1, राउंड 1')).toBeVisible();
  await expect(page.getByTestId('confirm-votes')).toHaveText(['30', '20', '1']);
  await expect(page.getByTestId('confirm-total')).toHaveText('51');
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).dblclick(); // double click saves once

  await expect(page).toHaveURL(new RegExp(`/wards/${w.id}$`));
  await expect(page.getByText('बूथ 1 की एंट्री सेव हो गई')).toBeVisible();
  await expect(page.getByRole('link', { name: 'अगला बूथ: एंट्री करें' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('मतगणना जारी');

  await page.getByRole('link', { name: '← मेरे वार्ड' }).click();
  await expect(page.getByRole('row', { name: /^वार्ड 1 / })).toContainText('1/2');
});

test('the same booth a second time is refused with ALREADY_ENTERED', async ({ page }) => {
  const w = world().wards.entry;
  await page.goto(`/wards/${w.id}/booths/${w.booths['1'] ?? 0}/entry`);
  await typeSheet(page, [1, 1, 1], 3);
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('यह बूथ पहले ही दर्ज हो चुका है');
});

test('leaving with typed numbers asks first', async ({ page }) => {
  const w = world().wards.entry;
  await page.goto(`/wards/${w.id}/booths/${w.booths['2'] ?? 0}/entry`);
  await page.getByLabel('अमर सिंह के मत').fill('12');
  await page.getByRole('link', { name: '← वार्ड 1' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'बिना सेव किए छोड़ें?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'रुकें, पेज पर रहें' }).click();
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveValue('12');
});
