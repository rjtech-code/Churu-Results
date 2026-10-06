import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './support';

// Screenshots of the three TV screens at 1920x1080 with the e2e data, for visual review
// (frontend/screenshots/, git-ignored). Runs last, after the other specs changed the data.
const DIR = resolve(import.meta.dirname, '../screenshots');

test('save screenshots of /screen/1, /screen/2 and /screen/3 at 1920x1080', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const n of [1, 2, 3]) {
    await page.goto(`/screen/${n}?interval=120`);
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(DIR, `screen-${n}.png`) });
  }
});
