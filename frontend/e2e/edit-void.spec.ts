import { RO_STATE, expect, giveReason, roApi, test, typeSheet, world } from './support';

test.use({ storageState: RO_STATE });
test.describe.configure({ mode: 'serial' });

const EDIT_REASON = 'सुधार का कारण (अनिवार्य)';

test('an edit with nothing changed is blocked (no confirm screen)', async ({ page }) => {
  const w = world().wards.edit;
  await page.goto(`/entries/${w.entries['3'] ?? 0}/edit`);
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveValue('100');
  await giveReason(page, EDIT_REASON, 'टाइपिंग में गलती');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('कोई बदलाव नहीं — सुधार की ज़रूरत नहीं');
  await expect(page.getByText('पुष्टि करें — पहले और अब')).toHaveCount(0);
});

test('edit with a reason shows before/after and saves', async ({ page }) => {
  const w = world().wards.edit;
  await page.goto(`/entries/${w.entries['3'] ?? 0}/edit`);
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveValue('100');
  await page.getByLabel('अमर सिंह के मत').fill('101');
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('156');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('कारण'); // reason is required
  await giveReason(page, EDIT_REASON, 'पर्ची पढ़ने में गलती', 'उम्मीदवार 1 का अंक 0 को 1 पढ़ा');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByText('पुष्टि करें — पहले और अब')).toBeVisible();
  await expect(page.getByText('पर्ची पढ़ने में गलती — उम्मीदवार 1 का अंक 0 को 1 पढ़ा')).toBeVisible();
  await expect(page.getByTestId('confirm-votes')).toHaveText(['101', '50', '5']);
  await expect(page.getByTestId('confirm-total')).toHaveText('156');
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page.getByText('बूथ 3 की एंट्री सुधार दी गई')).toBeVisible();
});

test('an edit after someone else changed the entry gets the STALE message', async ({ page }) => {
  const w = world().wards.edit;
  const entryId = w.entries['4'] ?? 0;
  await page.goto(`/entries/${entryId}/edit`);
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveValue('80');

  // Meanwhile, the same entry is changed through the API.
  const { ctx, token } = await roApi();
  const current = (await (await ctx.get(`/api/counting/entries/${entryId}`)).json()) as {
    entry: { rowVersion: number };
  };
  const put = await ctx.put(`/api/counting/entries/${entryId}`, {
    headers: { 'X-CSRF-Token': token },
    data: {
      rowVersion: current.entry.rowVersion,
      roundNo: 1,
      sheetTotal: 123,
      votes: [
        { candidateId: w.candidates.A, votes: 80 },
        { candidateId: w.candidates.B, votes: 40 },
        { candidateId: w.candidates.NOTA, votes: 3 },
      ],
      reason: 'पृष्ठभूमि में बदलाव (परीक्षण)',
    },
  });
  expect(put.status()).toBe(200);
  await ctx.dispose();

  await page.getByLabel('भरत कुमार के मत').fill('41');
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('123');
  await giveReason(page, EDIT_REASON, 'टाइपिंग में गलती');
  await page.getByRole('button', { name: 'आगे' }).click();
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page.getByRole('alert')).toContainText('किसी और ने इसे बदल दिया है, पेज दोबारा खोलें');
});

test('void with a reason; the booth can be entered again', async ({ page }) => {
  const w = world().wards.edit;
  await page.goto(`/entries/${w.entries['4'] ?? 0}/void`);
  await page.getByRole('button', { name: 'एंट्री रद्द करें' }).click();
  await expect(page.getByRole('alert')).toContainText('कारण');
  await giveReason(page, 'रद्द करने का कारण (अनिवार्य)', 'गलत बूथ चुना गया');
  await page.getByRole('button', { name: 'एंट्री रद्द करें' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'पक्का रद्द करें?' });
  await dialog.getByRole('button', { name: 'हाँ, रद्द करें' }).click();
  await expect(page.getByText('की एंट्री रद्द कर दी गई — अब दोबारा दर्ज की जा सकती है')).toBeVisible();
  await expect(
    page.getByRole('row', { name: /^4 / }).getByRole('link', { name: 'एंट्री करें' }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /^4 / })).toContainText('बाकी');
});

test('re-created booth: its whole history shows created, updated, voided, created (oldest first)', async ({
  page,
}) => {
  const w = world().wards.edit;
  await page.goto(`/wards/${w.id}`);
  await page.getByRole('row', { name: /^4 / }).getByRole('link', { name: 'एंट्री करें' }).click();
  await typeSheet(page, [70, 30, 1], 101);
  await page.getByRole('button', { name: 'आगे' }).click();
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page.getByText('बूथ 4 की एंट्री सेव हो गई')).toBeVisible();
  await page.getByRole('row', { name: /^4 / }).getByRole('link', { name: 'इतिहास' }).click();
  const rows = page.getByTestId('story').locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('td:nth-child(3)')).toHaveText([
    'दर्ज की गई',
    'सुधारी गई',
    'रद्द की गई',
    'दर्ज की गई',
  ]);
  await expect(rows.nth(2)).toContainText('(रद्द)');
  await expect(rows.nth(3)).not.toContainText('(रद्द)');
  await expect(rows.nth(2)).toContainText('गलत बूथ चुना गया');
});
