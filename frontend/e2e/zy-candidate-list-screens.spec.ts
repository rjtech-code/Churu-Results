import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, loginUi, test, world } from './support';

// The RO's candidate list page at 1920, 1366 and 768 (tablet), for visual review
// (frontend/screenshots/, git-ignored). Nothing is saved. When the full suite has already locked
// the list (admin.spec), the read-only view is captured instead.
const DIR = resolve(import.meta.dirname, '../screenshots');
const SIZES = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1366', width: 1366, height: 768 },
  { name: '768', width: 768, height: 1024 },
] as const;

async function shoot(page: Page, state: string, fullPage = true) {
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.waitForTimeout(150);
    const wide = await page.evaluate(() => {
      const max = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((el) => el.getBoundingClientRect().right > max + 1 && el.offsetParent !== null)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
        .slice(0, 6);
    });
    expect(wide, `overflow in "${state}" at ${s.name}`).toEqual([]);
    await page.screenshot({ path: resolve(DIR, `candidates-${state}-${s.name}.png`), fullPage });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test('RO candidate list: screenshots at 1920, 1366 and 768', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(DIR, { recursive: true });
  await loginUi(page, world().admin.ro);
  await expect(page.getByRole('navigation', { name: 'मुख्य मेनू' })).toBeVisible();
  await page.goto(`/candidates/${String(world().admin.wards[0]?.id ?? 0)}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('उम्मीदवार सूची');
  await shoot(page, '00-start');
  const add = page.getByRole('button', { name: '+ उम्मीदवार जोड़ें' });
  if ((await add.count()) === 0) return; // locked by an earlier spec: read-only view captured

  // Three filled cards (typed, never saved) to show a real list.
  const people = [
    ['भंवरलाल झाझड़िया', '62', '9180094180', 'गाँव आसलखेड़ी, पंचायत समिति चांदगोठी', 'ड्राइवर'],
    ['चंदा नायक', '44', '7293846529', 'गाँव ढाणी बड़ी, पंचायत समिति चांदगोठी', 'पशुपालक'],
    ['प्रेम वर्मा', '', '7112827154', '', ''],
  ] as const;
  for (const [i, [name, age, mobile, address, job]] of people.entries()) {
    const n = String(i + 1);
    if ((await page.getByLabel(`पंक्ति ${n} नाम`).count()) === 0) await add.click();
    await page.getByLabel(`पंक्ति ${n} नाम`).fill(name);
    if (age !== '') await page.getByLabel(`पंक्ति ${n} उम्र`).fill(age);
    await page.getByLabel(`पंक्ति ${n} मोबाइल`).fill(mobile);
    if (address !== '') await page.getByLabel(`पंक्ति ${n} पता`).fill(address);
    if (job !== '') await page.getByLabel(`पंक्ति ${n} व्यवसाय`).fill(job);
  }
  await page.getByLabel('पंक्ति 3 जन्म तिथि').fill('15/05');
  await page.getByLabel('पंक्ति 3 लिंग').selectOption('F');
  await shoot(page, '01-normal');

  // Unsaved changes + a new card with an empty name: the error is on the card itself.
  await add.click();
  await page.getByRole('button', { name: 'सूची सेव करें' }).click();
  await expect(page.getByText('उम्मीदवार का नाम लिखें')).toBeVisible();
  await shoot(page, '02-unsaved-error');

  // Remove asks first.
  const cards = page.getByTestId('cand-form').locator('li.cw-card:not(.cw-nota)');
  const last = await cards.count();
  await page.getByRole('button', { name: `पंक्ति ${String(last)} हटाएँ` }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '03-remove-confirm', false);
});
