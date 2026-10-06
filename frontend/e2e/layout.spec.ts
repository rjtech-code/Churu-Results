import type { Page } from '@playwright/test';
import { RO_STATE, expect, test, world } from './support';

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
    await page.getByLabel('भरत कुमार के मत').focus();
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

  test('a total above the registered voters: the server error is shown next to "आगे", focused, never green', async ({
    page,
  }) => {
    await page.goto(entryUrl());
    for (const name of WIDE_NAMES) await page.getByLabel(`${name} के मत`).fill('150');
    await page.getByLabel('नोटा के मत').fill('0');
    await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('1200');
    await expect(page.getByTestId('entry-sumline')).toContainText('✓ बराबर'); // sum = total, so locally fine
    await page.getByRole('button', { name: 'आगे' }).click();

    const panel = page.getByRole('complementary', { name: 'योग और आगे' });
    const error = panel.getByRole('alert');
    await expect(error).toContainText('योग (1200) बूथ के पंजीकृत मतदाताओं (1000) से अधिक है');
    await expect(error).toBeFocused();
    await expect(error).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: 'आगे' })).toBeInViewport({ ratio: 1 });
    // next to the button: the error ends right above it
    const errBox = await error.boundingBox();
    const btnBox = await panel.getByRole('button', { name: 'आगे' }).boundingBox();
    expect(errBox && btnBox && btnBox.y - (errBox.y + errBox.height)).toBeLessThan(40);
    // the live sum line no longer says "equal" while the error stands
    await expect(page.getByTestId('entry-sumline')).not.toHaveClass(/sum-ok/);
    await expect(page.getByTestId('entry-sumline')).toContainText('✗');
    await expect(page.getByText('पुष्टि करें — बूथ 10')).toHaveCount(0);
  });
});
