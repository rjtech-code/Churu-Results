// Part 14: the PS RO types one booth's parchi — PS votes and ZP votes — on one screen.
import { request } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { RO_STATE, expect, giveReason, test, world } from './support';

test.use({ storageState: RO_STATE });
test.describe.configure({ mode: 'serial' });

const psPart = (page: Page) =>
  page.getByRole('region', { name: `पंचायत समिति — वार्ड ${world().combined.psWardNo}` });
const zpPart = (page: Page) =>
  page.getByRole('region', { name: `जिला परिषद — वार्ड ${world().combined.zpWardNo}` });

/** Candidate A, B, NOTA, then the part's own sheet total. */
async function typePart(
  part: Locator,
  names: [string, string],
  votes: [number, number, number],
  total: number,
) {
  await part.getByLabel(`${names[0]} के मत`).fill(String(votes[0]));
  await part.getByLabel(`${names[1]} के मत`).fill(String(votes[1]));
  await part.getByLabel('नोटा के मत').fill(String(votes[2]));
  await part.getByLabel('कुल योग (पर्ची के अनुसार)').fill(String(total));
}
const PS_NAMES: [string, string] = ['अमर सिंह', 'भरत कुमार'];
const ZP_NAMES: [string, string] = ['गीता देवी', 'राधा देवी'];

test('ward 9 → booth 21: both parts on one screen; a ZP mismatch blocks; one save stores both', async ({
  page,
}) => {
  const c = world().combined;
  await page.goto(`/wards/${c.psWardId}`);
  await page.getByRole('row', { name: /^21 / }).getByRole('link', { name: 'एंट्री करें' }).click();
  await expect(page).toHaveURL(new RegExp(`/booths/${c.booths['21'] ?? 0}/entry$`));
  await expect(page.getByText('बूथ संख्या 21 — राजकीय विद्यालय 21')).toBeVisible();
  await expect(psPart(page)).toBeVisible();
  await expect(zpPart(page)).toBeVisible();
  await expect(page.getByLabel('अमर सिंह के मत')).toBeFocused();
  await expect(page.getByRole('button', { name: 'आगे' })).toHaveCount(1);

  await typePart(psPart(page), PS_NAMES, [300, 200, 10], 510);
  await typePart(zpPart(page), ZP_NAMES, [250, 240, 9], 500); // sum 499
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByRole('alert')).toContainText('जिला परिषद: आपका जोड़ 499');

  await zpPart(page).getByLabel('कुल योग (पर्ची के अनुसार)').fill('499');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByText('पुष्टि करें — बूथ 21, राउंड 1')).toBeVisible();
  await expect(page.getByTestId('confirm-votes')).toHaveText(['300', '200', '10', '250', '240', '9']);
  await expect(page.getByTestId('confirm-total')).toHaveText(['510', '499']);
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).dblclick(); // double click saves once

  await expect(page).toHaveURL(new RegExp(`/wards/${c.psWardId}$`));
  await expect(page.getByText('बूथ 21 की एंट्री सेव हो गई')).toBeVisible();
  const row = page.getByRole('row', { name: /^21 / });
  await expect(row).toContainText('✓ दर्ज');

  // Back on the parchi: both parts are saved, each with its own edit/void.
  await row.getByRole('link', { name: 'पूरी पर्ची (पं.स. + जि.प.)' }).click();
  await expect(psPart(page)).toContainText('✓ दर्ज — राउंड 1');
  await expect(zpPart(page)).toContainText('✓ दर्ज — राउंड 1');
  await expect(zpPart(page).getByTestId('confirm-total')).toHaveText('499');
  await expect(page.getByRole('button', { name: 'आगे' })).toHaveCount(0);
});

test('the PS RO edits the ZP part (reason required) and comes back to the parchi', async ({ page }) => {
  const c = world().combined;
  await page.goto(`/booths/${c.booths['21'] ?? 0}/entry`);
  await zpPart(page).getByRole('link', { name: 'सुधारें' }).click();
  await expect(page.getByText(/एंट्री सुधार — बूथ संख्या 21/)).toBeVisible();
  await expect(page.getByText('मतपत्र: जिला परिषद')).toBeVisible();
  await page.getByLabel('गीता देवी के मत').fill('251');
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('500');
  await giveReason(page, 'सुधार का कारण (अनिवार्य)', 'टाइपिंग में गलती');
  await page.getByRole('button', { name: 'आगे' }).click();
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page).toHaveURL(new RegExp(`/booths/${c.booths['21'] ?? 0}/entry$`));
  await expect(page.getByText('बूथ 21 की एंट्री सुधार दी गई')).toBeVisible();
  await expect(zpPart(page).getByTestId('confirm-total')).toHaveText('500');
});

test('booth 22: ZP already entered by the ZP RO shows as saved; only the PS part is typed', async ({
  page,
}) => {
  const c = world().combined;
  // The ZP RO enters booth 22's ZP sheet in its own, cookie-free API context (a context that
  // carried the stored RO cookie would have the RO session replaced by this login).
  const zp = await request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const csrf = async () =>
    ((await (await zp.get('/api/auth/csrf')).json()) as { csrfToken: string }).csrfToken;
  const login = await zp.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': await csrf() },
    data: { username: world().users.zp, password: world().password },
  });
  expect(login.status()).toBe(200);
  const saved = await zp.post('/api/counting/entries', {
    headers: { 'X-CSRF-Token': await csrf() },
    data: {
      wardId: c.zpWardId,
      boothId: c.booths['22'],
      ballotFor: 'ZP',
      roundNo: 3,
      sheetTotal: 60,
      votes: [
        { candidateId: c.zp.A, votes: 30 },
        { candidateId: c.zp.B, votes: 25 },
        { candidateId: c.zp.NOTA, votes: 5 },
      ],
    },
  });
  expect(saved.status()).toBe(201);
  await zp.dispose();

  await page.goto(`/booths/${c.booths['22'] ?? 0}/entry`);
  await expect(zpPart(page)).toContainText('✓ दर्ज — राउंड 3');
  await expect(zpPart(page).getByLabel('कुल योग (पर्ची के अनुसार)')).toHaveCount(0);
  await typePart(psPart(page), PS_NAMES, [40, 30, 2], 72);
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByTestId('confirm-total')).toHaveText(['72']);
  await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
  await expect(page.getByText('बूथ 22 की एंट्री सेव हो गई')).toBeVisible();
});
