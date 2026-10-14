// Part 14.1: the PS RO's two tabs — "पंचायत समिति" (as before) and "जिला परिषद" (own-PS booths only).
import type { Page } from '@playwright/test';
import { RO_STATE, expect, giveReason, test, world } from './support';

test.use({ storageState: RO_STATE });
test.describe.configure({ mode: 'serial' });

const SAVE = 'पुष्टि करें और सेव करें';
const TOTAL = 'कुल योग (पर्ची के अनुसार)';
const tab = (page: Page, name: string) => page.getByRole('tab', { name });

test('PS tab is the default and works as before: ward 9 → booth 21 → save', async ({ page }) => {
  const c = world().combined;
  await page.goto('/wards');
  await expect(tab(page, 'पंचायत समिति')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'जिला परिषद')).toHaveAttribute('aria-selected', 'false');
  await page
    .getByRole('row', { name: /^वार्ड 9 / })
    .getByRole('link', { name: 'खोलें' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/wards/${c.psWardId}$`));
  await page.getByRole('row', { name: /^21 / }).getByRole('link', { name: 'एंट्री करें' }).click();
  await expect(page).toHaveURL(new RegExp(`/wards/${c.psWardId}/booths/${c.booths['21'] ?? 0}/entry$`));
  await expect(page.getByText('मतपत्र: पंचायत समिति')).toBeVisible();
  await page.getByLabel('अमर सिंह के मत').fill('300');
  await page.getByLabel('भरत कुमार के मत').fill('200');
  await page.getByLabel('नोटा के मत').fill('10');
  await page.getByLabel(TOTAL).fill('510');
  await page.getByRole('button', { name: 'आगे' }).click();
  await page.getByRole('button', { name: SAVE }).click();
  await expect(page).toHaveURL(new RegExp(`/wards/${c.psWardId}$`));
  await expect(page.getByText('बूथ 21 की एंट्री सेव हो गई')).toBeVisible();
});

test('ZP tab: the tab is in the URL and survives refresh; only own-PS booths; no postal/declare', async ({
  page,
}) => {
  const c = world().combined;
  await page.goto('/wards');
  await tab(page, 'जिला परिषद').click();
  await expect(page).toHaveURL(/\/wards\?ballot=ZP$/);
  await page.reload();
  await expect(tab(page, 'जिला परिषद')).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('row', { name: /^वार्ड 4 / });
  await expect(row).toContainText('0/2');
  await row.getByRole('link', { name: 'खोलें' }).click();
  await expect(page).toHaveURL(new RegExp(`/zp/${c.zpWardId}$`));
  await expect(page.getByRole('row', { name: /^21 / })).toBeVisible();
  await expect(page.getByRole('row', { name: /^22 / })).toBeVisible();
  const text = await page.locator('main, body').first().innerText();
  for (const hidden of ['डाक मत', 'घोषणा', 'लॉटरी', 'संशोधन', 'कुल योग', 'आगे चल रहे'])
    expect(text).not.toContain(hidden);
  await page.getByRole('link', { name: /← मेरे वार्ड/ }).click();
  await expect(page).toHaveURL(/\/wards\?ballot=ZP$/);
});

test('ZP save: same form for the ZP ballot, no ward totals on the confirm screen, back to the ZP ward', async ({
  page,
}) => {
  const c = world().combined;
  await page.goto(`/zp/${c.zpWardId}`);
  await page.getByRole('row', { name: /^21 / }).getByRole('link', { name: 'एंट्री करें' }).click();
  await expect(page).toHaveURL(new RegExp(`/zp/${c.zpWardId}/booths/${c.booths['21'] ?? 0}/entry$`));
  await expect(page.getByText('मतपत्र: जिला परिषद')).toBeVisible();
  await expect(page.getByLabel('अमर सिंह के मत')).toHaveCount(0); // PS candidates are not on this ballot
  await page.getByLabel('गीता देवी के मत').fill('250');
  await page.getByLabel('राधा देवी के मत').fill('240');
  await page.getByLabel('नोटा के मत').fill('9');
  await page.getByLabel(TOTAL).fill('499');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByText('पुष्टि करें — बूथ 21, राउंड 1')).toBeVisible();
  await expect(page.getByText('वार्ड का कुल योग')).toHaveCount(0);
  await page.getByRole('button', { name: SAVE }).dblclick(); // double click saves once
  await expect(page).toHaveURL(new RegExp(`/zp/${c.zpWardId}$`));
  await expect(page.getByText('बूथ 21 की एंट्री सेव हो गई')).toBeVisible();
  await expect(page.getByRole('row', { name: /^21 / })).toContainText('✓ दर्ज');
  await page.goto('/wards?ballot=ZP');
  await expect(page.getByRole('row', { name: /^वार्ड 4 / })).toContainText('1/2');
});

test('ZP edit (reason required) and void return to the ZP ward', async ({ page }) => {
  const c = world().combined;
  await page.goto(`/zp/${c.zpWardId}`);
  await page.getByRole('row', { name: /^21 / }).getByRole('link', { name: 'सुधारें' }).click();
  await expect(page.getByText('मतपत्र: जिला परिषद')).toBeVisible();
  await page.getByLabel('गीता देवी के मत').fill('251');
  await page.getByLabel(TOTAL).fill('500');
  await giveReason(page, 'सुधार का कारण (अनिवार्य)', 'टाइपिंग में गलती');
  await page.getByRole('button', { name: 'आगे' }).click();
  await expect(page.getByText('वार्ड का कुल योग')).toHaveCount(0);
  await page.getByRole('button', { name: SAVE }).click();
  await expect(page).toHaveURL(new RegExp(`/zp/${c.zpWardId}$`));
  await expect(page.getByText('बूथ 21 की एंट्री सुधार दी गई')).toBeVisible();

  await page.getByRole('row', { name: /^21 / }).getByRole('link', { name: 'रद्द करें' }).click();
  await page.getByRole('button', { name: 'एंट्री रद्द करें' }).click();
  await giveReason(page, 'रद्द करने का कारण (अनिवार्य)', 'गलत बूथ चुना गया');
  await page.getByRole('button', { name: 'एंट्री रद्द करें' }).click();
  await page
    .getByRole('alertdialog', { name: 'पक्का रद्द करें?' })
    .getByRole('button', { name: 'हाँ, रद्द करें' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/zp/${c.zpWardId}$`));
  await expect(page.getByRole('row', { name: /^21 / })).toContainText('बाकी');
});
