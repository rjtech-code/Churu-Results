import type { Page } from '@playwright/test';

/**
 * Checks the TV layout in the page and returns every problem found (empty = clean):
 *  - no element inside a card, the header, ticker, page header, panels or footer overflows its box
 *    (names clamped on purpose to 2 lines, data-clamp, are the only exception; never the winner's)
 *  - siblings inside a candidate row, a card head and the header groups do not overlap
 *  - all vote numbers in a card (and in one grid column) share the same right edge
 *  - no page scrollbars
 */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const name = (el: Element) => {
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      const text = el.textContent.trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${text}"`;
    };
    const roots = document.querySelectorAll(
      'article.tv-card, .tv-header, .tv-ticker, .tv-page-head, .tv-panel, .tv-footer, .tv-stale',
    );
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement)) continue; // SVG drawing
        const display = getComputedStyle(el).display;
        if (display === 'inline' || display === 'contents' || display === 'none') continue;
        if (el.matches('[data-clamp]')) continue;
        if (el.scrollWidth > el.clientWidth + 1)
          problems.push(`overflows width: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
        if (el.scrollHeight > el.clientHeight + 1)
          problems.push(`overflows height: ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`);
      }
    }
    const overlap = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    for (const parent of document.querySelectorAll(
      '.tv-row, .tv-row-text, .tv-card-head, .tv-header, .tv-header-group',
    )) {
      const kids = [...parent.children]
        .map((k) => [k, k.getBoundingClientRect()] as const)
        .filter(([, r]) => r.width > 0 && r.height > 0);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const [a, ra] = kids[i] ?? [];
          const [b, rb] = kids[j] ?? [];
          if (a && b && ra && rb && overlap(ra, rb))
            problems.push(`overlap in ${name(parent)}: ${name(a)} / ${name(b)}`);
        }
      }
    }
    const columns = new Map<number, number[]>();
    for (const card of document.querySelectorAll('article.tv-card')) {
      const rights = [...card.querySelectorAll('.tv-votes')].map((v) => v.getBoundingClientRect().right);
      if (rights.length === 0) continue;
      if (Math.max(...rights) - Math.min(...rights) > 1) problems.push(`votes not aligned in ${name(card)}`);
      const left = Math.round(card.getBoundingClientRect().left);
      columns.set(left, [...(columns.get(left) ?? []), ...rights]);
    }
    for (const [left, rights] of columns) {
      if (Math.max(...rights) - Math.min(...rights) > 1)
        problems.push(`votes not aligned in the grid column at x=${left}`);
    }
    for (const w of document.querySelectorAll<HTMLElement>('.tv-row-winner .tv-name')) {
      if (w.scrollHeight > w.clientHeight + 1 || w.scrollWidth > w.clientWidth + 1)
        problems.push(`winner name cut: ${name(w)}`);
    }
    const d = document.documentElement;
    if (d.scrollHeight > window.innerHeight || d.scrollWidth > window.innerWidth)
      problems.push('page scrollbars');
    return problems;
  });
}

/** Visits every page of a screen (rotating with ?interval=5) and calls `each` on each page. */
export async function eachPage(
  page: Page,
  screen: number,
  each: (title: string, index: number) => Promise<void>,
): Promise<void> {
  await page.goto(`/screen/${screen}?interval=5`);
  const title = page.getByTestId('page-title');
  await title.waitFor();
  const dots = await page.locator('.tv-page-dot').count();
  for (let i = 0; i < Math.max(1, dots); i++) {
    const text = await title.innerText();
    await page.waitForTimeout(400);
    await each(text, i);
    if (i < dots - 1) {
      await page.waitForFunction(
        (t) => document.querySelector('[data-testid="page-title"]')?.textContent !== t,
        text,
        {
          timeout: 8000,
        },
      );
    }
  }
}

/**
 * The same checks for the DM report pages: nothing inside a panel, the alarm box, the title row or
 * the filter overflows its box (the booth table's own horizontal scroll box is intentional and
 * skipped), and title-row / filter / panel-head items never overlap. No page-width overflow.
 */
export async function reportLayoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0] ?? ''} "${el.textContent.trim().slice(0, 30)}"`;
    const roots = document.querySelectorAll(
      '.rp-panel, .rp-alarms, .rp-ok, .rp-title-row, .rp-filter, .rp-stats',
    );
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.closest('.rp-scroll') !== null && !el.classList.contains('rp-scroll')) continue;
        if (el.classList.contains('rp-scroll')) continue;
        const display = getComputedStyle(el).display;
        if (
          display === 'inline' ||
          display === 'contents' ||
          display === 'none' ||
          display === 'table-cell' ||
          display === 'table-row'
        )
          continue;
        if (el.scrollWidth > el.clientWidth + 1)
          problems.push(`overflows width: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
        if (el.scrollHeight > el.clientHeight + 1)
          problems.push(`overflows height: ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`);
      }
    }
    const overlap = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    for (const parent of document.querySelectorAll(
      '.rp-title-row, .rp-filter, .rp-panel-head, .rp-stats, .topbar',
    )) {
      const kids = [...parent.children]
        .map((k) => [k, k.getBoundingClientRect()] as const)
        .filter(([, r]) => r.width > 0 && r.height > 0);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const [a, ra] = kids[i] ?? [];
          const [b, rb] = kids[j] ?? [];
          if (a && b && ra && rb && overlap(ra, rb))
            problems.push(`overlap in ${name(parent)}: ${name(a)} / ${name(b)}`);
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth) problems.push('horizontal page scrollbar');
    return problems;
  });
}
