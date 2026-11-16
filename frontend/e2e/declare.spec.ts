import type { Page } from '@playwright/test';
import { RO_STATE, expect, test, world } from './support';

test.use({ storageState: RO_STATE });

/**
 * Everything that would make the declare form unusable on a 1366x768 screen: a form that runs past
 * the fold, a field or button that is cut off, covered by something else or pushed out of view, or
 * a page that scrolls sideways. Empty = the officer can read and complete the form as it stands.
 * Anything below the fold must be the site footer and nothing else.
 */
async function declareFormProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const view = window.innerHeight;
    const main = document.querySelector('main.page');
    if (main === null) return ['the declare page has no main.page'];
    const name = (el: Element) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`;
    const formBottom = Math.round(main.getBoundingClientRect().bottom);
    if (formBottom > view) problems.push(`the form ends below the fold (${formBottom} > ${view})`);
    for (const el of main.querySelectorAll<HTMLElement>('input, select, textarea, button, label, h1')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered (e.g. a hidden input)
      if (r.bottom > view || r.top < 0) problems.push(`out of view: ${name(el)}`);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        problems.push(`cut off: ${name(el)}`);
      }
    }
    // The two controls the officer must use are really clickable where they are drawn.
    for (const el of main.querySelectorAll<HTMLElement>('input[type="password"], button[type="submit"]')) {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top !== el && !el.contains(top)) problems.push(`covered by something else: ${name(el)}`);
    }
    // Below the fold there may be the footer, nothing else. (The shells that WRAP the footer are
    // tall for that reason alone, so they are not content reaching past the fold.)
    const footer = document.querySelector('footer');
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.bottom <= view) continue;
      if (footer !== null && (el === footer || footer.contains(el) || el.contains(footer))) continue;
      problems.push(`below the fold but not the footer: ${name(el)}`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth) {
      problems.push('the page scrolls sideways');
    }
    return problems;
  });
}

test('declare a ready ward (a wrong password is refused first)', async ({ page }) => {
  const w = world().wards.ready;
  await page.goto(`/wards/${w.id}`);
  await page.getByRole('link', { name: 'घोषणा करें' }).click();
  await expect(page.getByTestId('declare-winner')).toContainText('विजेता: अमर सिंह · अंतर: 102');
  await expect(page.getByTestId('total-valid')).toHaveText('519');
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill('wrong-password-123');
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect password. कृपया पुनः प्रयास करें।');
  await expect(page.getByLabel('RO Password (सत्यापन हेतु)')).toHaveValue(''); // not kept
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता अमर सिंह, अंतर 102')).toBeVisible();
  await page.getByRole('link', { name: 'वार्ड पर वापस' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('घोषित');
});

test('a tied ward needs the lottery result', async ({ page }) => {
  const w = world().wards.tie;
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/wards/${w.id}/declare`);
  await expect(page.getByText('शीर्ष पर बराबरी — लॉटरी आवश्यक')).toBeVisible();
  // The tallest declare form (lottery + password) must still be usable without scrolling: the whole
  // form ends above the fold, every field and button is fully visible, unclipped and not covered by
  // anything. Only the site-wide footer — a normal block at the end of EVERY page since Part 10.1 —
  // may reach past the fold (here by 4 px); the form itself may not.
  await expect(page.getByLabel('RO Password (सत्यापन हेतु)')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'घोषणा की पुष्टि करें' })).toBeInViewport({ ratio: 1 });
  expect(await declareFormProblems(page)).toEqual([]);
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('लॉटरी');
  await page.getByRole('radio', { name: /भरत कुमार/ }).check();
  await page.getByLabel('लॉटरी किसने कराई (3–100 अक्षर)').fill('रिटर्निंग अधिकारी');
  await page.getByLabel('लॉटरी का विवरण (10–500 अक्षर)').fill('दोनों उम्मीदवारों के सामने पर्ची निकाली गई');
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता भरत कुमार, अंतर 0 (लॉटरी से)')).toBeVisible();
});

test('NOTA highest: the acknowledgement checkbox is required', async ({ page }) => {
  const w = world().wards.nota;
  await page.goto(`/wards/${w.id}/declare`);
  await expect(page.getByText('नोटा को सबसे अधिक मत (401)')).toBeVisible();
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('नोटा');
  await page.getByRole('checkbox', { name: /मैंने नोटा के सर्वाधिक मत देख लिए हैं/ }).check();
  await page.getByLabel('RO Password (सत्यापन हेतु)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता भरत कुमार, अंतर 20')).toBeVisible();
});
