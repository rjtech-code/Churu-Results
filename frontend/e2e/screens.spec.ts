import type { Page } from '@playwright/test';
import { apiLogin, expect, test, world } from './support';

// Media-room TV screens: public, no login, no cookies. (Every test also fails on CSP violations.)

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
  await expect(page.getByTestId('page-title')).toHaveText('चूरू');
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

test('pages rotate (?interval=5): PS sub-pages "1/2", "2/2", then the next PS', async ({ page }) => {
  await page.goto('/screen/2?interval=5');
  const title = page.getByTestId('page-title');
  await expect(title).toHaveText('सरदारशहर 1/2');
  await expect(page.locator('.tv-next')).toHaveText('अगला: सरदारशहर 2/2');
  await expect(page.locator('article.tv-card')).toHaveCount(7); // 14 wards split evenly 7 + 7
  await expect(title).toHaveText('सरदारशहर 2/2', { timeout: 8000 });
  await expect(page.locator('article.tv-card')).toHaveCount(7);
  await expect(title).toHaveText('राजगढ़', { timeout: 8000 });
});

test('cards: NOT_STARTED no names; declared winner; corrected; unopposed; lottery winner marked by id', async ({
  page,
}) => {
  const s = world().screens;
  await page.goto('/screen/2?interval=120');
  await expect(page.getByTestId('page-title')).toHaveText('सरदारशहर 1/2');

  const notStarted = cardOf(page, 6);
  await expect(notStarted).toHaveAttribute('data-status', 'NOT_STARTED');
  await expect(notStarted).toContainText('मतगणना शुरू नहीं');
  await expect(notStarted.locator('.tv-row')).toHaveCount(0);
  expect((await notStarted.innerText()).replace(/वार्ड 6/, '')).not.toMatch(/\d/);

  const declared = cardOf(page, s.declaredWardNo);
  await expect(declared.locator('.tv-row-winner')).toHaveCount(1);
  await expect(declared.locator('.tv-row-winner')).toContainText('सुरेश कुमार');
  await expect(declared.locator('.tv-row-winner')).toContainText('विजयी');
  await expect(declared).toContainText('अंतर 100 मत');

  await expect(cardOf(page, s.correctedWardNo)).toContainText('संशोधित');

  const unopposed = cardOf(page, s.unopposedWardNo);
  await expect(unopposed).toContainText('निर्विरोध निर्वाचित');
  await expect(unopposed).toContainText('हरि राम');

  // Two tied candidates with the same name: the row marked as winner is the lottery winner's id.
  const lottery = cardOf(page, s.lottery.wardNo);
  await expect(lottery.locator('.tv-row')).toHaveCount(2);
  await expect(lottery.locator('.tv-row-winner')).toHaveCount(1);
  await expect(lottery.locator('.tv-row-winner')).toHaveAttribute(
    'data-candidate-id',
    String(s.lottery.winnerId),
  );
  await expect(lottery.locator('.tv-row-winner')).toContainText('विजयी (लॉटरी)');
  await expect(lottery.locator(`.tv-row[data-candidate-id="${s.lottery.loserId}"]`)).not.toHaveClass(
    /tv-row-winner/,
  );
});

test('an entry made through the counting API appears within ~5 s and its card is highlighted', async ({
  page,
}) => {
  const s = world().screens;
  await page.goto('/screen/2?interval=120');
  const live = cardOf(page, s.live.wardNo);
  await expect(live).toHaveAttribute('data-status', 'NOT_STARTED');
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
  await expect(page.getByTestId('ticker')).toContainText('सरदारशहर · वार्ड 5');
  await expect(live).not.toHaveClass(/tv-card-changed/, { timeout: 5000 }); // the highlight ends after ~3 s
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

test('an unknown screen number shows a Hindi message', async ({ page }) => {
  await page.goto('/screen/7');
  await expect(page.locator('.tv-message')).toContainText('यह स्क्रीन मौजूद नहीं है');
});
