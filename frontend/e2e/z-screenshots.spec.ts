import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { eachPage, layoutProblems } from './layout-check';
import { expect, test } from './support';

// Screenshots of every page of the three TV screens at 1920x1080 and 1366x768 with the e2e data,
// for visual review (frontend/screenshots/, git-ignored). Runs last, after the other specs changed
// the data (a live entry, Hindi PS name, a ZP declaration).
const DIR = resolve(import.meta.dirname, '../screenshots');

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test(`screenshots at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize(viewport);
    for (const n of [1, 2, 3]) {
      await eachPage(page, n, async (_title, i) => {
        await page.mouse.move(5, 5);
        await page.screenshot({
          path: resolve(DIR, `screen-${n}-${viewport.width}${i === 0 ? '' : `-p${i + 1}`}.png`),
        });
        expect(await layoutProblems(page)).toEqual([]);
      });
    }
  });
}
