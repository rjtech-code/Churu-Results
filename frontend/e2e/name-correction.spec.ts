import type { APIRequestContext, Page } from '@playwright/test';
import { RO_STATE, expect, loginUi, roApi, test, world } from './support';

// "नाम सुधारें" after the ballot lock: one PS_RO flow (own PS ward, a wrong password first, then
// the confirmation "पुराना → नया", the new name on the counting ballot, the DM's history) and one
// ZP_RO flow. Later specs read the seeded names, so each test puts the old name back through the
// API at the end (that is a second, recorded correction: the history keeps both).

const REASON = 'नामांकन पत्र के अनुसार वर्तनी ठीक की';

async function correctName(page: Page, row: number, newName: string, password: string) {
  await page.getByRole('button', { name: `नाम सुधारें — पंक्ति ${String(row)}` }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('नया नाम (हिंदी)').fill(newName);
  await dialog.getByLabel(/कारण \(अनिवार्य/).fill(REASON);
  await dialog.getByLabel(/RO Password/).fill(password);
  await dialog.getByRole('button', { name: /आगे/ }).click();
  return dialog;
}

// Puts the seeded name back with a session that already exists (the login rate limit is shared
// by the whole e2e run, so this spec logs in only twice: the DM and the ZP RO).
async function putBack(
  request: APIRequestContext,
  wardId: number,
  candidateId: number,
  from: string,
  to: string,
) {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await request.post(
    `/api/candidates/wards/${String(wardId)}/candidates/${String(candidateId)}/name`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        currentName: from,
        newName: to,
        reason: 'E2E: मूल नाम वापस (परीक्षण)',
        password: world().password,
      },
    },
  );
  if (res.status() !== 200) throw new Error(`put back: ${String(res.status())} ${await res.text()}`);
}

test.describe('PS_RO (stored login)', () => {
  test.use({ storageState: RO_STATE });

  test('PS_RO corrects a name in a locked ward of its own PS; the DM sees the history', async ({ page }) => {
    test.setTimeout(90_000);
    const c = world().combined;
    const OLD = 'भरत कुमार';
    const NEW = 'भरत कुमार शर्मा';
    try {
      await page.goto(`/candidates/${String(c.psWardId)}`);
      await expect(page.getByText(/अब केवल उम्मीदवार का नाम सुधारा जा सकता है/)).toBeVisible();
      // Party / gender stay frozen.
      await expect(page.getByLabel('पंक्ति 2 पार्टी')).toBeDisabled();
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);

      // A wrong password: clear message, nothing saved, back on the form.
      let dialog = await correctName(page, 2, NEW, 'galat-password-1');
      await expect(dialog.getByTestId('name-confirm')).toContainText(OLD);
      await expect(dialog.getByTestId('name-confirm')).toContainText(NEW);
      await dialog.getByRole('button', { name: 'नाम बदलें' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Incorrect password');
      await dialog.getByRole('button', { name: 'रुकें' }).click();
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);

      dialog = await correctName(page, 2, NEW, world().password);
      await dialog.getByRole('button', { name: 'नाम बदलें' }).click();
      await expect(page.getByText(`नाम बदल दिया गया: ${OLD} → ${NEW}`)).toBeVisible();
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(NEW);
      await expect(page.getByRole('button', { name: /नाम बदला गया/ })).toHaveCount(1);
      await page.getByRole('button', { name: /नाम बदला गया/ }).click();
      await expect(page.getByTestId('name-history')).toContainText(REASON);
      await page.getByRole('alertdialog').getByRole('button', { name: 'बंद करें' }).click();

      // The counting ballot reads the same candidate row: the entry form shows the new name.
      // (Booth 22: no other spec enters it.)
      await page.goto(`/wards/${String(c.psWardId)}/booths/${String(c.booths['22'] ?? 0)}/entry`);
      await expect(page.getByLabel(`${NEW} के मत`)).toBeVisible();

      // DM: read-only history with the CSV button.
      await page.context().clearCookies();
      await loginUi(page, world().users.dm);
      await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeVisible();
      await page.goto('/admin/candidates/name-changes');
      const list = page.getByTestId('name-history');
      await expect(list).toContainText(OLD);
      await expect(list).toContainText(NEW);
      await expect(list).toContainText(REASON);
      await expect(page.getByRole('button', { name: 'CSV डाउनलोड करें' })).toBeEnabled();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'CSV डाउनलोड करें' }).click();
      expect((await download).suggestedFilename()).toMatch(/^candidate-name-changes-.+\.csv$/);
    } finally {
      const ro = await roApi();
      await putBack(ro.ctx, c.psWardId, c.ps.B, NEW, OLD).finally(() => ro.ctx.dispose());
    }
  });
});

test('ZP_RO corrects a ZP ward name; a PS ward stays without the button', async ({ page }) => {
  test.setTimeout(60_000);
  const c = world().combined;
  const OLD = 'राधा देवी';
  const NEW = 'राधा देवी मीणा';
  try {
    await loginUi(page, world().users.zp);
    await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeVisible();
    await page.goto(`/candidates/${String(c.zpWardId)}`);
    await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);
    const dialog = await correctName(page, 2, NEW, world().password);
    await dialog.getByRole('button', { name: 'नाम बदलें' }).click();
    await expect(page.getByText(`नाम बदल दिया गया: ${OLD} → ${NEW}`)).toBeVisible();
    await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(NEW);

    // A PS ward is not the ZP RO's: the page is refused (server 403), no button anywhere.
    await page.goto(`/candidates/${String(c.psWardId)}`);
    await expect(page).toHaveURL(/not-allowed/);
    await expect(page.getByRole('button', { name: /नाम सुधारें/ })).toHaveCount(0);
  } finally {
    await putBack(page.request, c.zpWardId, c.zp.B, NEW, OLD);
  }
});
