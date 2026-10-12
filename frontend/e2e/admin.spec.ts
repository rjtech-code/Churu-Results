import { request } from '@playwright/test';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { RO_STATE, STATE_DIR, backendScript, expect, test, world } from './support';

// Part 13 happy path, in one serial story on the Bidasar PS (no other spec uses it):
// DM uploads parties and candidates -> RO edits a candidate and marks the list ready -> DM downloads
// the ballot report and locks -> RO enters a booth; then DM resets the RO's password and replaces
// the RO. Every page is checked for CSP violations by the shared fixture.
// Logins are few on purpose (the login rate limit is 20 per 15 minutes for the whole e2e run): the DM
// and the Bidasar RO log in once, here, and the tests reuse those sessions.
test.describe.configure({ mode: 'serial' });

const PARTIES = join(STATE_DIR, 'parties.xlsx');
const CANDIDATES = join(STATE_DIR, 'candidates.xlsx');
const DM_STATE = join(STATE_DIR, 'admin-dm.json');
/** API clients start without any session (not the describe's stored one). */
const NO_SESSION = { cookies: [], origins: [] };
const BIDASAR_STATE = join(STATE_DIR, 'admin-ro-bidasar.json');

async function saveLogin(username: string, path: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3199', storageState: NO_SESSION });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await ctx.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { username, password: world().password },
  });
  if (res.status() !== 200) throw new Error(`login ${username}: ${res.status()}`);
  await ctx.storageState({ path });
  await ctx.dispose();
}

test.beforeAll(async () => {
  backendScript('make-xlsx.ts', [STATE_DIR]);
  await saveLogin(world().users.dm, DM_STATE);
  await saveLogin(world().admin.ro, BIDASAR_STATE);
});

async function confirmWithPassword(page: Page, button: string) {
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await dialog.getByRole('button', { name: button }).click();
}

test.describe(() => {
  test.use({ storageState: DM_STATE });

  test('DM uploads parties and the candidate list', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/reports$/);
    // The DM menu: 5 plain items.
    await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' }).getByRole('link')).toHaveText([
      'रिपोर्ट',
      'उम्मीदवार सूची',
      'RO सूची',
      'बूथ / वार्ड',
      'पार्टी सूची',
    ]);

    await page.getByRole('link', { name: 'पार्टी सूची' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('पार्टी सूची');
    const check = page.getByRole('button', { name: '2. जाँच करें' });
    await expect(check).toBeDisabled();
    await page.getByLabel('1. Excel फ़ाइल चुनें (.xlsx, अधिकतम 5 MB)').setInputFiles(PARTIES);
    await check.click();
    await expect(page.getByText('नई पार्टियाँ: 1')).toBeVisible();
    await page.getByRole('button', { name: '4. सेव करें' }).click();
    await confirmWithPassword(page, 'हाँ, सेव करें');
    await expect(page.getByText('सूची सेव हो गई')).toBeVisible();
    await expect(page.getByTestId('party-list')).toContainText('E2EJP');

    await page.getByRole('link', { name: 'उम्मीदवार सूची' }).click();
    await page.getByRole('link', { name: 'अपलोड पर जाएँ' }).click();
    await page.getByLabel('1. Excel फ़ाइल चुनें (.xlsx, अधिकतम 5 MB)').setInputFiles(CANDIDATES);
    await page.getByRole('button', { name: '2. जाँच करें' }).click();
    await expect(page.getByTestId('upload-totals')).toHaveText(
      'वार्ड 2 · उम्मीदवार 4 · निर्विरोध 0 · बदले जाने वाले वार्ड 0',
    );
    await expect(page.getByText('इनमें से कोई नहीं (नोटा) — अपने आप जुड़ेगा').first()).toBeVisible();
    await page.getByRole('button', { name: '4. सेव करें' }).click();
    await confirmWithPassword(page, 'हाँ, सेव करें');
    await expect(page.getByText('सूची सेव हो गई')).toBeVisible();
  });
});

test.describe(() => {
  test.use({ storageState: BIDASAR_STATE });

  test('RO edits a candidate and marks the list ready', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'मुख्य मेनू' })
      .getByRole('link', { name: 'उम्मीदवार' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('उम्मीदवार');
    await page
      .getByRole('row', { name: /^वार्ड 1 / })
      .getByRole('link', { name: 'खोलें' })
      .click();
    await page.getByLabel('पंक्ति 2 नाम').fill('सीता देवी');
    await page.getByRole('button', { name: 'सूची सेव करें' }).click();
    await expect(page.getByText('सूची सेव हो गई')).toBeVisible();
    await page.getByRole('button', { name: 'सूची तैयार है' }).click();
    await confirmWithPassword(page, 'हाँ, सूची तैयार है');
    await expect(page.getByText('सूची तैयार बता दी गई')).toBeVisible();
    await expect(page.getByLabel('पंक्ति 2 नाम')).toHaveValue('सीता देवी');
  });
});

test.describe(() => {
  test.use({ storageState: DM_STATE });

  test('DM downloads the ballot report and locks the PS', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'उम्मीदवार सूची' }).click();
    await page.getByRole('link', { name: 'जाँच पर जाएँ' }).click();
    const row = page.getByRole('row', { name: /^बीदासर पंचायत समिति / });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'खोलें' }).click();

    const download = page.waitForEvent('download');
    await page.getByTestId('ballot-report').click();
    expect((await download).suggestedFilename()).toBe(`ballot-report-ps${world().admin.psId}.xlsx`);

    await page.getByRole('button', { name: 'इस पंचायत समिति को लॉक करें' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('2 वार्ड लॉक होंगे');
    const lock = dialog.getByRole('button', { name: 'लॉक करें' });
    await expect(lock).toBeDisabled(); // LOCK not typed yet
    await dialog.getByLabel('पुष्टि के लिए अंग्रेज़ी में LOCK लिखें').fill('LOCK');
    await confirmWithPassword(page, 'लॉक करें');
    await expect(page.getByText('2 वार्ड लॉक हो गए')).toBeVisible();
    await expect(page.getByTestId('ward-table')).not.toContainText('सूची बाकी');
  });
});

test.describe(() => {
  test.use({ storageState: BIDASAR_STATE });

  test('RO enters a booth of the locked ward', async ({ page }) => {
    const a = world().admin;
    const w = a.wards[0];
    if (w === undefined) throw new Error('no admin ward');
    await page.goto(`/wards/${w.id}/booths/${w.boothId}/entry`);
    await page.getByLabel('राधा कुमारी के मत').fill('40');
    await page.getByLabel('सीता देवी के मत').fill('30');
    await page.getByLabel('इनमें से कोई नहीं के मत').fill('2');
    await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill('72');
    await page.getByRole('button', { name: 'आगे' }).click();
    await page.getByRole('button', { name: 'पुष्टि करें और सेव करें' }).click();
    await expect(page.getByText('बूथ 1 की एंट्री सेव हो गई')).toBeVisible();
    // The list is now frozen for the RO too.
    await page.goto(`/candidates/${w.id}`);
    await expect(page.getByText('यह सूची लॉक है।')).toBeVisible();
    await expect(page.getByRole('button', { name: 'सूची सेव करें' })).toHaveCount(0);
  });
});

async function canLogin(username: string, password: string): Promise<number> {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3199', storageState: NO_SESSION });
  try {
    const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
    const res = await ctx.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { username, password },
    });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

test.describe(() => {
  test.use({ storageState: DM_STATE });

  test('DM resets the RO password, then replaces the RO', async ({ page }) => {
    const a = world().admin;
    await page.goto('/');
    await page.getByRole('link', { name: 'RO सूची' }).click();
    await page
      .getByRole('row', { name: /^बीदासर पंचायत समिति / })
      .getByRole('link', { name: 'खोलें' })
      .click();

    await page.getByRole('button', { name: 'पासवर्ड बदलें' }).click();
    await confirmWithPassword(page, 'पासवर्ड बदलें');
    await expect(page.getByText('यह पासवर्ड दोबारा नहीं दिखेगा', { exact: false })).toBeVisible();
    await expect(page.getByTestId('otp-username')).toHaveText(a.ro);
    const reset = (await page.getByTestId('otp-password').getAttribute('data-password')) ?? '';
    expect(reset).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(await canLogin(a.ro, reset)).toBe(200); // old password refused: covered by the backend tests
    await page.getByRole('button', { name: 'हो गया' }).click();
    await expect(page.getByTestId('otp-box')).toHaveCount(0);

    await page.getByRole('button', { name: 'RO बदलें' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('पुराना खाता बंद होगा');
    await dialog.getByLabel('नए RO का पूरा नाम').fill('नया बीदासर अधिकारी');
    await confirmWithPassword(page, 'RO बदलें');
    const username = (await page.getByTestId('otp-username').textContent()) ?? '';
    const password = (await page.getByTestId('otp-password').getAttribute('data-password')) ?? '';
    expect(username).toMatch(/^ro_bid_[a-z2-9]{4}$/);
    expect(await canLogin(username, password)).toBe(200); // old account disabled: shown below and in backend tests
    await page.getByRole('button', { name: 'हो गया' }).click();
    await expect(page.getByTestId('seat-state')).toHaveText('चालू');
    await expect(page.getByText(/1 पुराने \(बंद\) खाते/)).toBeVisible();
  });
});

/** No horizontal scroll at 1366x768, and body text at least 18px. */
async function fits(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
    font: parseFloat(getComputedStyle(document.body).fontSize),
  }));
  expect([path, m.scroll <= m.width, m.font >= 18]).toEqual([path, true, true]);
}

test.describe('at 1366x768 (DM pages)', () => {
  test.use({ storageState: DM_STATE, viewport: { width: 1366, height: 768 } });
  test('every new DM page fits without horizontal scroll; text is at least 18px', async ({ page }) => {
    const a = world().admin;
    const w = a.wards[0];
    if (w === undefined) throw new Error('no admin ward');
    for (const [path, heading] of [
      ['/admin/parties', 'पार्टी सूची'],
      ['/admin/candidates', 'उम्मीदवार सूची'],
      ['/admin/candidates/upload', 'उम्मीदवार सूची अपलोड'],
      ['/admin/candidates/check', 'उम्मीदवार जाँच'],
      [`/admin/candidates/check/PS:${a.psId}`, 'उम्मीदवार जाँच'],
      ['/admin/users', 'RO सूची'],
      [`/admin/users/PS:${a.psId}`, 'RO खाता'],
      [`/admin/booths?ps=${a.psId}`, 'बूथ / वार्ड'],
      [`/admin/booths/${a.psId}/${w.boothId}`, 'बूथ 1'],
      [`/admin/wards/${a.psId}`, 'आरक्षण वर्ग'],
    ] as const)
      await fits(page, path, heading);
  });
});

test.describe('at 1366x768 (RO pages)', () => {
  test.use({ storageState: RO_STATE, viewport: { width: 1366, height: 768 } });
  test('the RO candidate pages fit without horizontal scroll', async ({ page }) => {
    await fits(page, '/candidates', 'उम्मीदवार');
    await fits(page, `/candidates/${world().wards.entry.id}`, 'उम्मीदवार सूची');
  });
});
