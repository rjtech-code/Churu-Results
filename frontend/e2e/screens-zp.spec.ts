import type { Locator } from '@playwright/test';
import { apiLogin, expect, test, world } from './support';

interface SeatRow {
  party: { shortName: string | null; nameHindi: string };
  won: number;
  leading: number;
  total: number;
}

const fmt = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/** The rows a seat table must show: parties with a seat won or a lead, in API order. */
async function expectTable(table: Locator, rows: SeatRow[], withTotal: boolean) {
  const shown = rows.filter((r) => r.won + r.leading > 0);
  const expected = shown.map((r) => [
    r.party.nameHindi,
    fmt(r.won),
    fmt(r.leading),
    ...(withTotal ? [fmt(r.total)] : []),
  ]);
  const actual = await table
    .locator('tbody tr')
    .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  expect(actual).toEqual(expected.length === 0 ? [['—']] : expected);
}

test('screen 3: empty pie state; after a ZP declaration the pie, legend and tables match the API', async ({
  page,
  request,
}) => {
  await page.goto('/screen/3?interval=120');
  await expect(page.getByTestId('page-title')).toHaveText('ज़िला परिषद');
  await expect(page.getByTestId('pie-empty')).toHaveText('अभी कोई परिणाम घोषित नहीं');
  await expect(page.getByTestId('pie')).toHaveCount(0);

  let api = (await (await request.get('/api/public/screens/3')).json()) as {
    partySeats: SeatRow[];
    psPartySeats: SeatRow[];
  };
  await expectTable(page.getByTestId('zp-seats'), api.partySeats, true);
  await expectTable(page.getByTestId('ps-seats'), api.psPartySeats, false);

  // Declare ZP ward 2 as the ZP RO.
  const zp = await apiLogin(world().users.zp);
  const ward = world().screens.zpReady;
  const preview = (await zp.post(`/api/declare/wards/${ward.wardId}/preview`, {})) as {
    result: { leader: { candidateId: number }; totalValidVotes: number };
  };
  await zp.post(`/api/declare/wards/${ward.wardId}`, {
    password: world().password,
    confirmWinnerCandidateId: preview.result.leader.candidateId,
    confirmTotalValidVotes: preview.result.totalValidVotes,
  });
  await zp.dispose();

  await expect(page.getByTestId('pie')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('pie-empty')).toHaveCount(0);
  api = (await (await request.get('/api/public/screens/3')).json()) as {
    partySeats: SeatRow[];
    psPartySeats: SeatRow[];
  };
  const won = api.partySeats.filter((r) => r.won > 0);
  expect(won.map((r) => [r.party.shortName, r.won])).toEqual([['BJP', 1]]);
  // one party has every seat won: a full circle
  await expect(page.getByTestId('pie').locator('circle')).toHaveCount(1);
  await expect(page.getByTestId('legend').locator('li')).toHaveText(
    won.map((r) => new RegExp(`${r.party.nameHindi}\\s+${r.won}`)),
  );
  await expectTable(page.getByTestId('zp-seats'), api.partySeats, true);
  await expectTable(page.getByTestId('ps-seats'), api.psPartySeats, false);
  await expect(page.getByTestId('latest-winners').locator('li').first()).toContainText(
    'ज़िला परिषद · वार्ड 2',
  );
  await expect(page.getByTestId('latest-winners').locator('li').first()).toContainText('प्रेम सिंह');
  const card = page.locator('article.tv-card[data-status="DECLARED"]');
  await expect(card.locator('.tv-row-winner')).toContainText('प्रेम सिंह');
});
