import type { Page } from '@playwright/test';
import { RO_STATE, expect, roApi, test, world } from './support';

// The one-screen forms, on the widest ballot the form must fit: 8 candidates + NOTA.
test.use({ storageState: RO_STATE });

const WIDE_NAMES = [
  'अमर सिंह',
  'भरत कुमार',
  'चंदन लाल',
  'दिनेश शर्मा',
  'ईश्वर प्रसाद',
  'फतेह सिंह',
  'गणेश राम',
  'हरि ओम',
];

async function noPageScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
}

function entryUrl(): string {
  const w = world().wards.wide;
  return `/wards/${w.id}/booths/${w.booths['10'] ?? 0}/entry`;
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('booth entry with 8 candidates + NOTA fits on one screen: total and "आगे" visible', async ({
      page,
    }) => {
      await page.goto(entryUrl());
      await expect(page.getByLabel('कुल योग (पर्ची के अनुसार)')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'आगे' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('entry-sumline')).toBeInViewport({ ratio: 1 });
      for (const name of [...WIDE_NAMES, 'नोटा']) {
        await expect(page.getByLabel(`${name} के मत`)).toBeInViewport({ ratio: 1 });
      }
      expect(await noPageScroll(page)).toBe(true);
    });

    test('postal form with 8 candidates + NOTA fits on one screen', async ({ page }) => {
      await page.goto(`/wards/${world().wards.wide.id}/postal`);
      await expect(page.getByLabel('कुल योग (पर्ची के अनुसार)')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'आगे' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByLabel('नोटा के मत')).toBeInViewport({ ratio: 1 });
      expect(await noPageScroll(page)).toBe(true);
    });
  });
}

test.describe('at 1366x768', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the row being typed is highlighted', async ({ page }) => {
    await page.goto(entryUrl());
    // A click (not .focus()): the "अंतिम बूथ" popup may open first and is dismissed by the fixture.
    await page.getByLabel('भरत कुमार के मत').click();
    const row = page.getByRole('row').filter({ has: page.getByLabel('भरत कुमार के मत') });
    const other = page.getByRole('row').filter({ has: page.getByLabel('हरि ओम के मत') });
    const bg = (r: typeof row) =>
      r
        .locator('td')
        .first()
        .evaluate((td) => getComputedStyle(td).boxShadow);
    expect(await bg(row)).toContain('inset');
    expect(await bg(other)).toBe('none');
  });

  test('a total that does not match the votes is refused next to "आगे" (also by the server); a total above the registered voters is accepted', async ({
    page,
  }) => {
    await page.goto(entryUrl());
    for (const name of WIDE_NAMES) await page.getByLabel(`${name} के मत`).fill('150');
    await page.getByLabel('नोटा के मत').fill('0');
    const total = page.getByLabel('कुल योग (पर्ची के अनुसार)');
    const sumline = page.getByTestId('entry-sumline');
    const panel = page.getByRole('complementary', { name: 'योग और आगे' });
    const next = panel.getByRole('button', { name: 'आगे' });

    // Votes add up to 1200, the slip says 1201: refused, shown next to "आगे", focused, never green.
    await total.fill('1201');
    await expect(sumline).toContainText('✗ बराबर नहीं');
    await next.click();
    const error = panel.getByRole('alert');
    await expect(error).toContainText('आपका जोड़ 1200 है, पर पर्ची का योग 1201 है');
    await expect(error).toBeFocused();
    await expect(error).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });
    // next to the button: the error ends right above it
    const errBox = await error.boundingBox();
    const btnBox = await next.boundingBox();
    expect(errBox && btnBox && btnBox.y - (errBox.y + errBox.height)).toBeLessThan(40);
    await expect(sumline).not.toHaveClass(/sum-ok/);
    await expect(page.getByText('पुष्टि करें — बूथ 10', { exact: true })).toHaveCount(0);

    // The server refuses the same sheet by itself (SUM_MISMATCH), whatever the client does.
    const w = world().wards.wide;
    const ids = [w.candidates.A, w.candidates.B, ...w.extraCandidates];
    const { ctx, token } = await roApi();
    const res = await ctx.post('/api/counting/entries/preview', {
      headers: { 'X-CSRF-Token': token },
      data: {
        wardId: w.id,
        boothId: w.booths['10'] ?? 0,
        ballotFor: 'PS',
        sheetTotal: 1201,
        votes: [
          ...ids.map((candidateId) => ({ candidateId, votes: 150 })),
          { candidateId: w.candidates.NOTA, votes: 0 },
        ],
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('SUM_MISMATCH');
    await ctx.dispose();

    // 1200 on a booth with 1000 registered voters: accepted (official order: voters are never
    // checked). The confirm screen opens; nothing is saved here.
    await total.fill('1200');
    await expect(sumline).toContainText('✓ बराबर');
    await next.click();
    await expect(page.getByText('पुष्टि करें — बूथ 10', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('confirm-total')).toHaveText('1200');
  });
});
