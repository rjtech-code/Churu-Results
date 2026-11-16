import type { APIRequestContext, Page } from '@playwright/test';
import { RO_STATE, becomeDm, expect, loginUi, roApi, test, world } from './support';

// "विवरण सुधारें" after the ballot lock (Nov 2026: grown out of the name-only "नाम सुधारें", so this
// spec covers a name AND another detail in one correction): one PS_RO flow (own PS ward, a wrong
// password first, then the confirmation "पुराना → नया" per changed field, the new name on the
// counting ballot, the DM's history) and one ZP_RO flow.
// Later specs read the seeded names, so each test puts the old values back through the API at the
// end (that is a second, recorded correction: the history keeps both).

const REASON = 'नामांकन पत्र के अनुसार वर्तनी ठीक की';
/** The non-name detail this spec corrects as well (free text, empty in the seed). */
const OCCUPATION = 'कृषि';

/** Opens "विवरण सुधारें" for one row and fills the form up to the confirm step. */
async function correctDetails(
  page: Page,
  row: number,
  patch: { newName?: string; occupation?: string },
  password: string,
) {
  await page.getByRole('button', { name: `विवरण सुधारें — पंक्ति ${String(row)}` }).click();
  const dialog = page.getByRole('alertdialog');
  if (patch.newName !== undefined) await dialog.getByLabel('नाम (हिंदी)').fill(patch.newName);
  if (patch.occupation !== undefined) {
    await dialog.getByLabel('उम्मीदवार व्यवसाय').fill(patch.occupation);
  }
  await dialog.getByLabel(/कारण \(अनिवार्य/).fill(REASON);
  await dialog.getByLabel(/RO Password/).fill(password);
  await dialog.getByRole('button', { name: /आगे/ }).click();
  return dialog;
}

// Puts the seeded values back with a session that already exists (the login rate limit is shared
// by the whole e2e run, so this spec logs in only twice: the DM and the ZP RO).
async function putBack(
  request: APIRequestContext,
  wardId: number,
  candidateId: number,
  from: string,
  to: string,
  patch: Record<string, unknown> = {},
) {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await request.post(
    `/api/candidates/wards/${String(wardId)}/candidates/${String(candidateId)}/details`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        currentName: from,
        newName: to,
        reason: 'E2E: मूल विवरण वापस (परीक्षण)',
        password: world().password,
        ...patch,
      },
    },
  );
  if (res.status() !== 200) throw new Error(`put back: ${String(res.status())} ${await res.text()}`);
}

test.describe('PS_RO (stored login)', () => {
  test.use({ storageState: RO_STATE });

  test('PS_RO corrects a name and a detail in a locked ward of its own PS; the DM sees the history', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const c = world().combined;
    const OLD = 'भरत कुमार';
    const NEW = 'भरत कुमार शर्मा';
    try {
      await page.goto(`/candidates/${String(c.psWardId)}`);
      await expect(page.getByText(/अब केवल उम्मीदवार का विवरण सुधारा जा सकता है/)).toBeVisible();
      // The list itself stays frozen: nothing is editable in place, and the ballot order and the
      // list (adding / removing a candidate) have no controls at all.
      await expect(page.getByLabel('पंक्ति 2 नाम')).toBeDisabled();
      await expect(page.getByLabel('पंक्ति 2 पार्टी')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'पंक्ति 2 हटाएँ' })).toHaveCount(0);
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);

      // A wrong password: clear message, nothing saved, back on the form.
      let dialog = await correctDetails(
        page,
        2,
        { newName: NEW, occupation: OCCUPATION },
        'galat-password-1',
      );
      const confirm = dialog.getByTestId('name-confirm');
      // The confirm step lists every changed field as "पुराना → नया".
      await expect(confirm).toContainText(OLD);
      await expect(confirm).toContainText(NEW);
      await expect(confirm).toContainText('व्यवसाय');
      await expect(confirm).toContainText(OCCUPATION);
      await expect(confirm).toContainText(REASON);
      await dialog.getByRole('button', { name: 'विवरण बदलें' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Incorrect password');
      await dialog.getByRole('button', { name: 'रुकें' }).click();
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);
      await expect(page.getByLabel('पंक्ति 2 व्यवसाय')).toHaveValue('');

      dialog = await correctDetails(page, 2, { newName: NEW, occupation: OCCUPATION }, world().password);
      await dialog.getByRole('button', { name: 'विवरण बदलें' }).click();
      await expect(page.getByText(/विवरण सुधार दिया गया/)).toContainText(`${OLD} → ${NEW}`);
      await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(NEW);
      await expect(page.getByLabel('पंक्ति 2 व्यवसाय')).toHaveValue(OCCUPATION);
      await expect(page.getByRole('button', { name: /विवरण बदला गया/ })).toHaveCount(1);
      await page.getByRole('button', { name: /विवरण बदला गया/ }).click();
      const wardHistory = page.getByTestId('name-history');
      await expect(wardHistory).toContainText(REASON);
      await expect(wardHistory).toContainText('नाम');
      await expect(wardHistory).toContainText('व्यवसाय');
      await page.getByRole('alertdialog').getByRole('button', { name: 'बंद करें' }).click();

      // The counting ballot reads the same candidate row: the entry form shows the new name.
      // (Booth 22: no other spec enters it.)
      await page.goto(`/wards/${String(c.psWardId)}/booths/${String(c.booths['22'] ?? 0)}/entry`);
      await expect(page.getByLabel(`${NEW} के मत`)).toBeVisible();

      // DM: read-only history with the CSV button. (The DM session comes from global setup; this
      // spec adds no login of its own beyond the ZP RO's below.)
      await becomeDm(page);
      await page.goto('/admin/candidates/name-changes');
      await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeVisible();
      const list = page.getByTestId('name-history');
      await expect(list).toContainText(OLD);
      await expect(list).toContainText(NEW);
      await expect(list).toContainText(REASON);
      await expect(list).toContainText(OCCUPATION);
      await expect(page.getByRole('button', { name: 'CSV डाउनलोड करें' })).toBeEnabled();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'CSV डाउनलोड करें' }).click();
      expect((await download).suggestedFilename()).toMatch(/^candidate-name-changes-.+\.csv$/);
    } finally {
      const ro = await roApi();
      await putBack(ro.ctx, c.psWardId, c.ps.B, NEW, OLD, { occupation: '' }).finally(() => ro.ctx.dispose());
    }
  });
});

test('ZP_RO corrects a ZP ward detail; a PS ward stays without the button', async ({ page }) => {
  test.setTimeout(60_000);
  const c = world().combined;
  const OLD = 'राधा देवी';
  const NEW = 'राधा देवी मीणा';
  try {
    await loginUi(page, world().users.zp);
    await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeVisible();
    await page.goto(`/candidates/${String(c.zpWardId)}`);
    await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(OLD);
    const dialog = await correctDetails(page, 2, { newName: NEW, occupation: OCCUPATION }, world().password);
    await dialog.getByRole('button', { name: 'विवरण बदलें' }).click();
    await expect(page.getByText(/विवरण सुधार दिया गया/)).toContainText(`${OLD} → ${NEW}`);
    await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue(NEW);
    await expect(page.getByLabel('पंक्ति 2 व्यवसाय')).toHaveValue(OCCUPATION);

    // A PS ward is not the ZP RO's: the page is refused (server 403), no button anywhere.
    await page.goto(`/candidates/${String(c.psWardId)}`);
    await expect(page).toHaveURL(/not-allowed/);
    await expect(page.getByRole('button', { name: /विवरण सुधारें/ })).toHaveCount(0);
  } finally {
    await putBack(page.request, c.zpWardId, c.zp.B, NEW, OLD, { occupation: '' });
  }
});
