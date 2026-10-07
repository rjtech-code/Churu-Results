import { eachPage, layoutProblems } from './layout-check';
import { expect, test } from './support';

// Every page of every TV screen at both sizes: nothing overflows or overlaps, votes line up,
// no page scrollbars. (Zero CSP violations: the support fixture.)
for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  for (const screen of [1, 2, 3]) {
    test(`layout of /screen/${screen} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(viewport);
      let pages = 0;
      await eachPage(page, screen, async (title) => {
        pages++;
        expect(await layoutProblems(page), title).toEqual([]);
      });
      expect(pages).toBeGreaterThan(0);
    });
  }
}
