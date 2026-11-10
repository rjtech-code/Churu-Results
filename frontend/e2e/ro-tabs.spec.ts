// The PS RO's पंचायत समिति / जिला परिषद tabs on every RO page, with the leave question when something
// was typed. Screenshots at 360px and 1366x768 for review (frontend/screenshots/, git-ignored).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { RO_STATE, expect, test, world } from './support';

test.use({ storageState: RO_STATE });

const DIR = resolve(import.meta.dirname, '../screenshots');
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const entryUrl = () => {
  const c = world().combined;
  return `/zp/${String(c.zpWardId)}/booths/${String(c.booths['22'] ?? 0)}/entry`;
};

test('ZP booth entry -> PS tab: asks when typed (रुकें keeps it, छोड़कर जाएँ leaves); no question when clean', async ({
  page,
}) => {
  await page.goto(entryUrl());
  const votes = page.getByLabel('गीता देवी के मत');
  await expect(tab(page, 'जिला परिषद')).toHaveAttribute('aria-selected', 'true');
  await votes.fill('17');
  await tab(page, 'पंचायत समिति').click();
  const dialog = page.getByRole('alertdialog', { name: 'क्या आप सच में जाना चाहते हैं?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('सेव नहीं की गई जानकारी खो जाएगी।');
  await expect(dialog.getByRole('button', { name: 'रुकें' })).toBeFocused();
  await dialog.getByRole('button', { name: 'रुकें' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(votes).toHaveValue('17');
  await tab(page, 'पंचायत समिति').click();
  await dialog.getByRole('button', { name: 'छोड़कर जाएँ' }).click();
  await expect(page).toHaveURL(/\/wards$/);
  await expect(tab(page, 'पंचायत समिति')).toHaveAttribute('aria-selected', 'true');

  // The same switch without typing: straight through.
  await page.goto(entryUrl());
  await expect(page.getByLabel('गीता देवी के मत')).toBeVisible();
  await tab(page, 'पंचायत समिति').click();
  await expect(page).toHaveURL(/\/wards$/);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

for (const viewport of [
  { width: 360, height: 740 },
  { width: 1366, height: 768 },
]) {
  test(`tabs layout at ${String(viewport.width)}x${String(viewport.height)}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize(viewport);
    // The ZP ward page (booth list): the booth entry form itself is wider than a phone (as before).
    await page.goto(`/zp/${String(world().combined.zpWardId)}`);
    await expect(tab(page, 'जिला परिषद')).toBeVisible();
    // The bar never needs sideways scrolling (the tables below are the pages' own business).
    const bar = await page.locator('.ro-tabs').evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      right: el.getBoundingClientRect().right,
    }));
    expect(bar.overflow).toBeLessThanOrEqual(0);
    expect(bar.right).toBeLessThanOrEqual(viewport.width);
    for (const name of ['पंचायत समिति', 'जिला परिषद']) {
      const box = await tab(page, name).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${DIR}/ro-tabs-${String(viewport.width)}.png` });
    // Sticky: still on screen after scrolling down.
    await page.mouse.wheel(0, 2000);
    await expect(tab(page, 'पंचायत समिति')).toBeInViewport();
    await page.screenshot({ path: `${DIR}/ro-tabs-${String(viewport.width)}-scrolled.png` });
  });
}
