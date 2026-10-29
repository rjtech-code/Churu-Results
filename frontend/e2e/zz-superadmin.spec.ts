import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, world } from './support';

// Super Admin panel: every state at 1366x768 and 360px, for visual review (frontend/screenshots/,
// git-ignored), and no horizontal scroll anywhere. Runs LAST: it clears the e2e test data.
const DIR = resolve(import.meta.dirname, '../screenshots');
const REAL_FILE = resolve(import.meta.dirname, '../../docs/polling-stations.xlsx');
const VIEWPORTS = [
  { name: '1366', width: 1366, height: 768 },
  { name: '360', width: 360, height: 780 },
] as const;

async function shoot(page: Page, state: string, fullPage = true) {
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.waitForTimeout(150);
    // Elements sticking out on the right (the dashboard header included): none allowed.
    const wide = await page.evaluate(() => {
      const max = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > max + 1 && el.offsetParent !== null)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
        .slice(0, 8);
    });
    expect(wide, `horizontal overflow in "${state}" at ${v.name}px`).toEqual([]);
    await page.screenshot({ path: resolve(DIR, `superadmin-${state}-${v.name}.png`), fullPage });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test('Super Admin panel: every state at 1366x768 and 360px', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  const { superAdmin } = world().users;
  const password = world().password;

  // Login through the small "Super Admin" link.
  await page.goto('/login');
  await page.getByRole('link', { name: 'Super Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Super Admin Login' })).toBeVisible();
  await shoot(page, '00-login');
  await page.getByLabel('यूज़रनेम').fill(superAdmin);
  await page.getByLabel('पासवर्ड', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
  await expect(page.getByTestId('sa-lock')).toBeVisible();

  // 1. Normal.
  await shoot(page, '01-normal');

  // 2. Impact summary + modal (test-data reset), then a wrong password (error in the modal).
  await page.getByRole('button', { name: 'परीक्षण डेटा साफ़ करें' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await shoot(page, '02-modal', false);
  await dialog.getByLabel(/टाइप करें/).fill('RESET');
  await dialog.getByLabel(/Password/).fill('wrong-password-123');
  await dialog.getByRole('button', { name: 'डेटा साफ़ करें' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await shoot(page, '03-modal-error', false);

  // 3. Progress (the answer is held back for a moment), then success with the backup name.
  await page.route('**/api/superadmin/test-data/reset', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await dialog.getByLabel(/Password/).fill(password);
  await dialog.getByRole('button', { name: 'डेटा साफ़ करें' }).click();
  await expect(dialog.getByTestId('sa-working')).toBeVisible();
  await shoot(page, '04-progress', false);
  await expect(dialog.getByTestId('sa-done')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/churu-test-data-.+\.sql\.gz/)).toBeVisible();
  await shoot(page, '05-success', false);
  await dialog.getByRole('button', { name: 'ठीक है' }).click();
  await page.unroute('**/api/superadmin/test-data/reset');

  // 4. Nothing left to clear: the button is disabled and says why.
  await expect(page.getByText('साफ़ करने के लिए कोई test data नहीं है')).toBeVisible();

  // 5. Master data: a sample file (EXAMPLE rows) → problems in plain words.
  const master = page.getByTestId('card-master-data');
  const sample = await page.request.get('/api/superadmin/samples/geography');
  const sampleFile = {
    name: 'geography-sample.xlsx',
    mimeType: 'application/octet-stream',
    buffer: await sample.body(),
  };
  const pick = async (index: number, file: string | typeof sampleFile) => {
    const chooser = page.waitForEvent('filechooser');
    await master.getByRole('button', { name: 'File चुनें' }).nth(index).click();
    await (await chooser).setFiles(file);
  };
  await pick(0, sampleFile);
  await pick(0, sampleFile); // the voters slot is now the first empty one
  await master.getByRole('button', { name: 'जाँच करें (dry-run)' }).click();
  await expect(master.getByTestId('sa-check-result')).toBeVisible({ timeout: 30_000 });
  await master.scrollIntoViewIfNeeded();
  await shoot(page, '06-dry-run-error');

  // 6. Master data with the real files: count cards (13 / 231 / 39 / 1,359), impact summary.
  await master.getByRole('button', { name: 'बदलें' }).first().click();
  await master.getByRole('button', { name: 'बदलें' }).first().click();
  await pick(0, REAL_FILE);
  await pick(0, REAL_FILE);
  // The real file has one booth with two ZP ward numbers; a dry-run-only fix (Advanced) settles it.
  await master.getByText('उन्नत (Advanced)').click();
  const fix = [
    {
      panchayat_samiti: 'RAJGARH PANCHAYAT SAMITI',
      booth_no: 69,
      field: 'zp_ward_no',
      value: 23,
      reason: 'E2E screenshot only (dry run, nothing saved)',
      approved_by: 'E2E',
      approved_on: '2026-10-01',
    },
  ];
  await pick(1, {
    name: 'fixes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fix)),
  });
  await master.getByRole('button', { name: 'जाँच करें (dry-run)' }).click();
  await expect(master.getByText('Files सही हैं')).toBeVisible({ timeout: 60_000 });
  await shoot(page, '07-dry-run-ok');

  // 7. Counting Lock ON: everything dangerous is disabled with the reason.
  await page.getByRole('button', { name: 'Lock ON करें' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Lock ON करें' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ठीक है' }).click();
  await expect(page.getByTestId('sa-lock')).toContainText('ON');
  await expect(page.getByText('Counting Lock ON है — पहले Lock OFF करें').first()).toBeVisible();
  await shoot(page, '08-locked');

  // 8. Unlock dialog (password is not asked again inside the 15-minute window).
  await page.getByRole('button', { name: 'Lock OFF करें' }).click();
  await expect(page.getByRole('alertdialog').getByLabel(/Password/)).toHaveCount(0);
  await shoot(page, '09-unlock', false);
  await page
    .getByRole('alertdialog')
    .getByLabel(/टाइप करें/)
    .fill('UNLOCK');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Lock OFF करें' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ठीक है' }).click();
  await expect(page.getByTestId('sa-lock')).toContainText('OFF');

  // 9. Guide.
  await page.getByRole('link', { name: 'Guide खोलें' }).click();
  await expect(page.getByRole('heading', { name: 'मार्गदर्शिका / Guide' })).toBeVisible();
  await shoot(page, '10-guide');
});
