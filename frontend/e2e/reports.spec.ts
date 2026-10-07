import { readFileSync } from 'node:fs';
import { reportLayoutProblems } from './layout-check';
import { RO_STATE, expect, loginUi, test, world } from './support';

// DM reports (Part 10). Runs after the declare/correction specs, before the TV-screen specs.

test.describe('as the DM', () => {
  test('home: alarms and every section; filter; ward detail; CSV download; print view; layout', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginUi(page, world().users.dm);
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId('report-updated')).toContainText(/अंतिम अपडेट/);

    // The declare spec declared a NOTA-highest ward: a district alarm.
    const alarms = page.getByTestId('alarms');
    await expect(alarms).toHaveAttribute('role', 'alert');
    await expect(alarms).toContainText('नोटा सर्वाधिक, फिर भी घोषित');
    for (const id of [
      'progress',
      'party-seats',
      'women',
      'nota',
      'turnout',
      'close',
      'lottery',
      'corrections',
    ]) {
      await expect(page.getByTestId(`section-${id}`), id).toBeVisible();
    }
    await expect(page.getByTestId('section-lottery')).toContainText('रिटर्निंग अधिकारी'); // Churu tie ward, from the declare spec

    // Filter: Sardarshahar -> the unopposed woman winner; ZP -> its own sections.
    await page.getByRole('button', { name: /SARDARSHAHAR|सरदारशहर/ }).click();
    await expect(page.getByTestId('section-women')).toContainText('हेमा देवी');
    await expect(page.getByTestId('section-corrections')).toContainText('पुनर्गणना में बूथ के मत बदले');
    await expect(page.getByTestId('section-lottery')).toContainText('गोपाल राम');

    // Ward detail from a link: the corrected ward shows both declaration versions.
    await page.getByTestId('section-corrections').locator('td a').first().click();
    await expect(page).toHaveURL(/\/reports\/wards\/\d+$/);
    await expect(page.getByTestId('ward-declarations').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('ward-declarations')).toContainText('पुनर्गणना में बूथ के मत बदले');
    await expect(page.getByTestId('ward-booths')).toBeVisible();
    for (const vp of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      expect(await reportLayoutProblems(page), `ward ${vp.width}`).toEqual([]);
    }
    await page.getByRole('link', { name: '← रिपोर्ट' }).click();

    await page.getByRole('button', { name: 'ज़िला परिषद' }).click();
    await expect(page.getByRole('button', { name: 'ज़िला परिषद' })).toHaveAttribute('aria-pressed', 'true');

    // CSV download: UTF-8 BOM, Hindi intact, IST file name.
    await page.getByRole('button', { name: /SARDARSHAHAR|सरदारशहर/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('section-women').getByRole('link', { name: 'CSV डाउनलोड' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^report-women-\d{8}-\d{6}-IST\.csv$/);
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toContain('हेमा देवी');

    // Layout at both sizes: no overflow or overlap.
    for (const vp of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      expect(await reportLayoutProblems(page), `home ${vp.width}`).toEqual([]);
    }

    // Print view: no buttons, no filter, no CSV links; the print footer is there.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'प्रिंट करें' })).toBeHidden();
    await expect(page.getByRole('group', { name: 'क्षेत्र चुनें' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'CSV डाउनलोड' }).first()).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('.rp-print-footer')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('as a PS_RO', () => {
  test.use({ storageState: RO_STATE });

  test('the DM report URLs show "not allowed"', async ({ page }) => {
    for (const url of ['/reports', `/reports/wards/${world().wards.ready.id}`, '/dm']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'अनुमति नहीं' }), url).toBeVisible();
    }
    // the API refuses too
    const res = await page.request.get('/api/reports/summary');
    expect(res.status()).toBe(403);
  });
});
