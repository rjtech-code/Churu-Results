// Super Admin panel, the redesigned surface: every state at the three real widths (1440, 1024, 390)
// for visual review (frontend/screenshots/, git-ignored), and no element sticking out past the
// viewport at any of them — measured, not eyeballed.
//
// Everything this page reads — the logged-in user, /overview, the booth lists, the master-data dry
// run — is STUBBED with page.route, so each state is deterministic and this spec writes NOTHING: it
// never logs in (the suite's login rate limit is for the specs that test logging in), runs no reset,
// flips no lock and makes no backup. The behaviour of all of it is covered by zz-superadmin.spec.ts,
// which runs for real.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { Overview } from '../src/api/superadminTypes';
import { overview } from '../src/test/superadminFixture';
import { expect, test } from './support';

const DIR = resolve(import.meta.dirname, '../screenshots');
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844 },
] as const;

/** The panel with this /overview body, with nothing else stubbed. */
async function stubOverview(page: Page, ov: Overview, delayMs = 0): Promise<void> {
  await page.unroute('**/api/superadmin/overview');
  await page.route('**/api/superadmin/overview', async (route) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: ov });
  });
}

async function shoot(page: Page, state: string, fullPage = true) {
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.waitForTimeout(200);
    const wide = await page.evaluate(() => {
      const max = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > max + 1 && el.offsetParent !== null)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
        .slice(0, 8);
    });
    expect(wide, `horizontal overflow in "${state}" at ${v.name}px`).toEqual([]);
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, `horizontal page scrollbar in "${state}" at ${v.name}px`).toBe(false);
    await page.screenshot({ path: resolve(DIR, `sa-${state}-${v.name}.png`), fullPage });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** The Super Admin the panel is drawn for: a stubbed session, so this spec costs no login. */
async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      json: {
        id: 1,
        username: 'super_admin',
        fullName: 'सेटअप अधिकारी',
        role: 'SUPER_ADMIN',
        panchayatSamiti: null,
      },
    });
  });
}

/** The booths and wards the two booth cards list (read-only endpoints, stubbed for the picture). */
async function stubBoothLists(page: Page): Promise<void> {
  await page.route('**/api/superadmin/booths?*', async (route) => {
    await route.fulfill({
      json: {
        booths: [
          {
            id: 901,
            boothNo: '12',
            nameHindi: 'राजकीय प्राथमिक विद्यालय, सरदारशहर',
            psWardNo: 5,
            zpWardNo: 2,
            votersTotal: 1042,
            canDelete: true,
          },
          {
            id: 902,
            boothNo: '12A',
            nameHindi: 'राजकीय उच्च माध्यमिक विद्यालय (अतिरिक्त कक्ष)',
            psWardNo: 5,
            zpWardNo: 2,
            votersTotal: 318,
            canDelete: true,
          },
          {
            id: 903,
            boothNo: '13',
            nameHindi: 'ग्राम पंचायत भवन, ढाणी',
            psWardNo: 6,
            zpWardNo: 3,
            votersTotal: 866,
            canDelete: false,
          },
        ],
      },
    });
  });
  await page.route('**/api/superadmin/wards?*', async (route) => {
    await route.fulfill({
      json: {
        psWards: [5, 6, 7, 8].map((wardNo) => ({ wardNo, open: wardNo !== 6 })),
        zpWards: [2, 3, 4].map((wardNo) => ({ wardNo, open: wardNo !== 3 })),
      },
    });
  });
}

/** Opens a dialog, shoots it, and closes it with "रुकें" (nothing is ever submitted). */
async function shootDialog(page: Page, state: string, open: () => Promise<void>) {
  await open();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await shoot(page, state, false);
  await dialog.getByRole('button', { name: 'रुकें' }).click();
  await expect(dialog).toBeHidden();
}

test('Super Admin panel: every state at 1440, 1024 and 390', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });

  // 1. Loading: the shape of the page, never a blank screen.
  await stubSession(page);
  await stubOverview(page, overview(), 4000);
  await stubBoothLists(page);
  await page.goto('/superadmin');
  await expect(page.getByTestId('sa-loading')).toBeVisible();
  await shoot(page, '01-loading');
  await expect(page.getByTestId('sa-lock')).toBeVisible({ timeout: 15_000 });

  // 2. The panel with data, Counting Lock OFF.
  await stubOverview(page, overview());
  await page.reload();
  await expect(page.getByTestId('sa-lock')).toContainText('OFF');
  await shoot(page, '02-panel');

  // 3. Every confirm dialog (summary + typed word + password; never submitted).
  await shootDialog(page, '03-dialog-counting-reset', () =>
    page.getByRole('button', { name: 'मतगणना डेटा हटाएँ' }).click(),
  );
  await shootDialog(page, '04-dialog-test-reset', () =>
    page.getByRole('button', { name: 'परीक्षण डेटा साफ़ करें' }).click(),
  );
  await shootDialog(page, '05-dialog-lock-on', () =>
    page.getByRole('button', { name: 'Lock ON करें' }).click(),
  );
  await shootDialog(page, '06-dialog-dm-password', () =>
    page.getByRole('button', { name: 'नया password बनाएँ' }).click(),
  );

  // The booth list comes from the real API (read only); its dialog asks for the booth number.
  const del = page.getByTestId('card-booth-delete');
  await del.scrollIntoViewIfNeeded();
  const booth = del.locator('.sa-booth').first();
  await expect(booth).toBeVisible();
  await booth.click();
  await shootDialog(page, '07-dialog-booth-delete', () =>
    del.getByRole('button', { name: /^Booth .* हटाएँ$/ }).click(),
  );

  // 4. An error inside a dialog: a wrong password, in plain words, on the form.
  await page.route('**/api/superadmin/test-data/reset', async (route) => {
    await route.fulfill({ status: 401, json: { error: 'REAUTH_FAILED' } });
  });
  await page.getByRole('button', { name: 'परीक्षण डेटा साफ़ करें' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel(/टाइप करें/).fill('RESET');
  await dialog.getByLabel(/Password/).fill('definitely-wrong-123');
  await dialog.getByRole('button', { name: 'डेटा साफ़ करें' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await shoot(page, '08-dialog-error', false);
  await dialog.getByRole('button', { name: 'रुकें' }).click();
  await page.unroute('**/api/superadmin/test-data/reset');

  // 5. The master-data dialog, after a stubbed dry run says the files are fine.
  const master = page.getByTestId('card-master-data');
  await master.scrollIntoViewIfNeeded();
  const xlsx = { name: 'geography.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') };
  for (let i = 0; i < 2; i++) {
    const chooser = page.waitForEvent('filechooser');
    await master.getByRole('button', { name: 'File चुनें' }).first().click();
    await (await chooser).setFiles(xlsx);
  }
  await page.route('**/api/superadmin/master-data/check', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        counts: { panchayatSamitis: 13, psWards: 231, zpWards: 39, booths: 1359 },
        totalVoters: 1_204_583,
        problems: [],
        warnings: ['Booth 15A: name में extra space है'],
      },
    });
  });
  await master.getByRole('button', { name: 'जाँच करें (dry-run)' }).click();
  await expect(master.getByTestId('sa-check-result')).toBeVisible();
  await shoot(page, '09-dry-run-ok');
  await shootDialog(page, '10-dialog-master-data', () =>
    master.getByRole('button', { name: 'मास्टर डेटा बदलें' }).click(),
  );
  await page.unroute('**/api/superadmin/master-data/check');

  // 6. Counting Lock ON: every destructive action is disabled and says why.
  const LOCKED = 'Counting Lock ON है — पहले Lock OFF करें';
  await stubOverview(
    page,
    overview({
      countingLocked: true,
      testData: { ...overview().testData, allowed: false, reason: LOCKED },
      countingData: { ...overview().countingData, allowed: false, reason: LOCKED },
      masterData: { ...overview().masterData, allowed: false, reason: LOCKED },
      booths: { allowed: false, reason: LOCKED },
    }),
  );
  await page.reload();
  await expect(page.getByTestId('sa-lock')).toContainText('ON');
  await expect(page.getByText(LOCKED).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'परीक्षण डेटा साफ़ करें' }).isDisabled()).toBe(true);
  await shoot(page, '11-lock-on');

  // 7. Nothing left to clear: a disabled action for a reason of its own.
  await stubOverview(
    page,
    overview({
      testData: {
        allowed: false,
        reason: 'साफ़ करने के लिए कोई test data नहीं है',
        deletes: {
          candidates: 0,
          boothEntries: 0,
          postalEntries: 0,
          declaredWards: 0,
          voidedEntries: 0,
          nameChanges: 0,
          lockedWards: 0,
        },
      },
      countingExport: {
        rows: { boothEntries: 0, postalEntries: 0, declarations: 0, voidedEntries: 0 },
      },
    }),
  );
  await page.reload();
  await expect(page.getByText('साफ़ करने के लिए कोई test data नहीं है')).toBeVisible();
  await shoot(page, '12-disabled');

  // 8. A failed /overview: a calm panel with a way back, never a blank screen.
  await page.unroute('**/api/superadmin/overview');
  await page.route('**/api/superadmin/overview', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'Internal error' } });
  });
  await page.reload();
  await expect(page.getByTestId('panel-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'फिर से कोशिश करें' })).toBeVisible();
  await shoot(page, '13-overview-error');

  // 9. The Guide, in the same shell.
  await page.unroute('**/api/superadmin/overview');
  await page.goto('/guide');
  await expect(page.getByRole('heading', { name: 'मार्गदर्शिका / Guide' })).toBeVisible();
  await shoot(page, '14-guide');
});
