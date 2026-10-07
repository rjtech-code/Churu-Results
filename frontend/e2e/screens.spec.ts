import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { STATE_DIR, apiLogin, backendTool, expect, test, world } from './support';

// Media-room TV screens: public, no login, no cookies. (Every test also fails on CSP violations.)
// Serial: the second test switches the Sardarshahar PS to its Hindi name for the tests after it.
test.describe.configure({ mode: 'serial' });

const SARDAR = 'सरदारशहर पंचायत समिति';

const cardOf = (page: Page, wardNo: number) =>
  page
    .locator('article.tv-card')
    .filter({ has: page.locator('.tv-card-title', { hasText: new RegExp(`^वार्ड ${wardNo}$`) }) });

test('/screen/1 works with no login and no cookies, never calls /api/auth, shows no dashboard header', async ({
  page,
  context,
}) => {
  const auth: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/auth')) auth.push(r.url());
  });
  await page.goto('/screen/1');
  await expect(page.getByTestId('page-title')).toHaveText('चूरू पंचायत समिति');
  await expect(page.getByTestId('progress')).toHaveText(/^घोषित \d+ \/ 8$/);
  await expect(page.locator('.tv-header')).toContainText('चूरू पंचायत चुनाव 2026 — परिणाम');
  await expect(page.locator('.tv-header')).toContainText('स्क्रीन 1');
  await expect(page.locator('.tv-header')).toContainText('लाइव');
  await expect(page.locator('.tv-header')).toContainText(/अंतिम अपडेट \d{2}:\d{2}:\d{2}/);
  await expect(page.getByTestId('ticker')).toContainText('अभी बदला');
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page).toHaveURL(/\/screen\/1$/); // never redirected to /login
  await page.waitForTimeout(1500);
  expect(auth).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test('Hindi PS names after ps:set-hindi-names; an entry still updates its card within ~5 s', async ({
  page,
}) => {
  const s = world().screens;
  await page.goto('/screen/2?interval=120');
  // Imported without a Hindi name: the English name is shown.
  await expect(page.getByTestId('page-title')).toHaveText('SARDARSHAHAR PANCHAYAT SAMITI 1/2');
  const live = cardOf(page, s.live.wardNo);
  await expect(live).toHaveAttribute('data-status', 'NOT_STARTED');

  const file = resolve(STATE_DIR, 'ps-names-e2e.json');
  writeFileSync(file, JSON.stringify({ 'SARDARSHAHAR PANCHAYAT SAMITI': 'सरदारशहर' }));
  expect(backendTool('scripts/ps-set-hindi-names.ts', ['--file', file, '--commit'])).toContain('saved');

  // A counting entry (the snapshot rebuilds at once; the script alone is picked up within 60 s).
  const ro = await apiLogin(s.roSardar);
  await ro.post('/api/counting/entries', {
    wardId: s.live.wardId,
    boothId: s.live.boothId,
    ballotFor: 'PS',
    roundNo: 1,
    sheetTotal: 901,
    votes: [
      { candidateId: s.live.candidates.A, votes: 500 },
      { candidateId: s.live.candidates.B, votes: 400 },
      { candidateId: s.live.candidates.NOTA, votes: 1 },
    ],
  });
  await ro.dispose();
  await expect(live).toHaveAttribute('data-status', 'COUNTING', { timeout: 5000 });
  await expect(live).toHaveClass(/tv-card-changed/);
  await expect(live).toContainText('अजय सिंह');
  await expect(live).toContainText('आगे 100 मत');
  await expect(page.getByTestId('page-title')).toHaveText(`${SARDAR} 1/2`);
  await expect(page.getByTestId('ticker')).toContainText(
    'सरदारशहर · वार्ड 5 · मतगणना जारी — आगे: अजय सिंह (BJP)',
  );
  await expect(live).not.toHaveClass(/tv-card-changed/, { timeout: 5000 }); // the highlight ends after ~3 s
});

test('pages rotate (?interval=5): PS sub-pages "1/2", "2/2", then the next PS', async ({ page }) => {
  await page.goto('/screen/2?interval=5');
  const title = page.getByTestId('page-title');
  await expect(title).toHaveText(`${SARDAR} 1/2`);
  await expect(page.locator('.tv-next')).toHaveText(`अगला: ${SARDAR} 2/2`);
  await expect(page.locator('article.tv-card')).toHaveCount(7); // 14 wards split evenly 7 + 7
  await expect(title).toHaveText(`${SARDAR} 2/2`, { timeout: 8000 });
  await expect(page.locator('article.tv-card')).toHaveCount(7);
  await expect(title).toHaveText('राजगढ़ पंचायत समिति', { timeout: 8000 });
});

test('a page where every ward is not started stays only 5 s; others keep ?interval', async ({ page }) => {
  test.setTimeout(45_000);
  // Sardarshahar 1/2 has results (10 s with ?interval=10); 2/2 and Rajgarh have only not-started wards.
  await page.goto('/screen/2?interval=10');
  const title = page.getByTestId('page-title');
  await expect(title).toHaveText(`${SARDAR} 1/2`);
  const t0 = Date.now();
  await expect(title).toHaveText(`${SARDAR} 2/2`, { timeout: 14_000 });
  const busy = Date.now() - t0;
  const t1 = Date.now();
  await expect(title).toHaveText('राजगढ़ पंचायत समिति', { timeout: 9000 });
  const quiet = Date.now() - t1;
  expect(busy).toBeGreaterThan(8000);
  expect(quiet).toBeLessThan(7500);
  expect(quiet).toBeGreaterThan(3500);
});

test('cards: NOT_STARTED no names; declared winner; corrected; unopposed; lottery winner marked by id', async ({
  page,
}) => {
  const s = world().screens;
  await page.goto('/screen/2?interval=120');
  await expect(page.getByTestId('page-title')).toHaveText(`${SARDAR} 1/2`);
  await expect(page.locator('.tv-chip')).toHaveText([
    'घोषित 3',
    'निर्विरोध 1',
    'मतगणना जारी 1',
    'शुरू नहीं 9',
  ]);

  const notStarted = cardOf(page, 6);
  await expect(notStarted).toHaveAttribute('data-status', 'NOT_STARTED');
  await expect(notStarted).toContainText('मतगणना शुरू नहीं');
  await expect(notStarted.locator('.tv-row')).toHaveCount(0);
  await expect(notStarted).toHaveClass(/tv-card-quiet/);
  expect((await notStarted.innerText()).replace(/वार्ड 6/, '')).not.toMatch(/\d/);

  const declared = cardOf(page, s.declaredWardNo);
  await expect(declared.locator('.tv-row-winner')).toHaveCount(1);
  await expect(declared.locator('.tv-row-winner')).toContainText('सुरेश कुमार');
  await expect(declared.locator('.tv-row-winner .tv-name')).toHaveText('✓ सुरेश कुमार');
  await expect(declared.locator('.tv-row-winner .tv-party')).toHaveText('BJP'); // its own line
  await expect(declared.locator('.tv-row-winner .tv-badge')).toHaveCount(0); // no badge inside the row
  await expect(declared.locator('.tv-badge-status')).toHaveText('विजयी');
  await expect(declared).toContainText('अंतर 100 मत');
  // the winner's full name is visible: the name box is not cut
  const cut = await declared
    .locator('.tv-row-winner .tv-name')
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  expect(cut).toBe(false);

  await expect(cardOf(page, s.correctedWardNo)).toContainText('संशोधित');

  const unopposed = cardOf(page, s.unopposedWardNo);
  await expect(unopposed.getByText('निर्विरोध निर्वाचित')).toHaveCount(1); // once: the badge
  await expect(unopposed).toContainText('✓ हेमा देवी');

  // Two tied candidates with the same name: the row marked as winner is the lottery winner's id.
  const lottery = cardOf(page, s.lottery.wardNo);
  await expect(lottery.locator('.tv-row')).toHaveCount(2);
  await expect(lottery.locator('.tv-row-winner')).toHaveCount(1);
  await expect(lottery.locator('.tv-row-winner')).toHaveAttribute(
    'data-candidate-id',
    String(s.lottery.winnerId),
  );
  await expect(lottery.locator('.tv-row-winner .tv-name')).toContainText('✓ गोपाल राम');
  await expect(lottery.locator('.tv-badge-status')).toHaveText('विजयी (लॉटरी)');
  await expect(lottery.locator(`.tv-row[data-candidate-id="${s.lottery.loserId}"]`)).not.toHaveClass(
    /tv-row-winner/,
  );
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`no scrollbars at ${viewport.width}x${viewport.height} on all three screens`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const n of [1, 2, 3]) {
      await page.goto(`/screen/${n}?interval=120`);
      await expect(page.getByTestId('page-title')).toBeVisible();
      const fits = await page.evaluate(() => {
        const d = document.documentElement;
        return (
          d.scrollHeight <= window.innerHeight &&
          d.scrollWidth <= window.innerWidth &&
          getComputedStyle(d).overflow === 'hidden'
        );
      });
      expect(fits, `screen ${n}`).toBe(true);
      // the 1920x1080 stage is scaled to fit inside the window
      const box = await page.locator('.tv-stage').boundingBox();
      expect(box && box.width <= viewport.width + 1 && box.height <= viewport.height + 1, `screen ${n}`).toBe(
        true,
      );
    }
  });
}

test('the card grid fills the height down to the footer on all three screens (no big gap)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const n of [1, 2, 3]) {
    await page.goto(`/screen/${n}?interval=120`);
    await expect(page.getByTestId('page-title')).toBeVisible();
    const gap = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('article.tv-card')].map(
        (c) => c.getBoundingClientRect().bottom,
      );
      const footer = document.querySelector('.tv-footer')?.getBoundingClientRect().top ?? 0;
      return footer - Math.max(...cards);
    });
    expect(gap, `screen ${n}`).toBeGreaterThanOrEqual(0);
    expect(gap, `screen ${n}`).toBeLessThan(40);
  }
});

test('an unknown screen number shows a Hindi message', async ({ page }) => {
  await page.goto('/screen/7');
  await expect(page.locator('.tv-message')).toContainText('यह स्क्रीन मौजूद नहीं है');
});
