import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenPager } from '../../screens/hooks';
import { dotLabel, pageDuration, pageGroups, pageLabel, psPages } from '../../screens/paging';
import type { Page } from '../../screens/paging';
import { PageDots, PsStrip } from '../../screens/ScreenParts';
import type { PsBlock, WardCard } from '../../screens/types';

const INTERVAL_S = 15;

const ward = (wardId: number): WardCard => ({
  wardId,
  wardNo: wardId,
  status: 'COUNTING',
  boothsEntered: 1,
  boothsTotal: 2,
  latestRound: 1,
  postalEntered: false,
  top3: [],
  margin: null,
  topTied: false,
  notaVotes: 0,
  winner: null,
  declarationVersion: null,
  isCorrected: false,
  isUnopposed: false,
  reservationCategory: null,
});

const block = (id: number, name: string, wards: number): PsBlock => ({
  panchayatSamiti: { id, name },
  summary: { wardsTotal: wards, declared: 0, unopposed: 0, counting: wards, notStarted: 0 },
  wards: Array.from({ length: wards }, (_, i) => ward(id * 100 + i)),
});

// 4 cards a page: रतनगढ़ 1/3..3/3, चूरू, सरदारशहर 1/2..2/2 = 6 pages
const PAGES: Page[] = psPages([block(1, 'रतनगढ़', 10), block(2, 'चूरू', 3), block(3, 'सरदारशहर', 6)], 4);

/** The screen's navigation as ScreenApp wires it: the real hook, PS strip and dots. */
function Nav({ pages }: { pages: Page[] }) {
  const { index, goTo } = useScreenPager(pages.map((p) => pageDuration(p, INTERVAL_S)));
  const page = pages[index];
  return (
    <>
      <PsStrip groups={pageGroups(pages)} current={page?.group ?? null} onPick={goTo} />
      <h2 data-testid="page-title">{page === undefined ? '' : pageLabel(page)}</h2>
      <PageDots pages={pages} index={index} onPick={goTo} />
    </>
  );
}

const title = () => screen.getByTestId('page-title').textContent;
const marked = () => screen.getByTestId('ps-strip').querySelector('[aria-current="true"]')?.textContent;
const advance = (s: number) => {
  act(() => {
    vi.advanceTimersByTime(s * 1000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('screen navigation', () => {
  it('rotation without clicks is unchanged: one page per interval, wrapping around', () => {
    render(<Nav pages={PAGES} />);
    expect(title()).toBe('रतनगढ़ 1/3');
    advance(INTERVAL_S - 1);
    expect(title()).toBe('रतनगढ़ 1/3');
    advance(1);
    expect(title()).toBe('रतनगढ़ 2/3');
    for (let i = 0; i < 5; i++) advance(INTERVAL_S); // one page per step: each timer is set after its render
    expect(title()).toBe('रतनगढ़ 1/3');
  });

  it('every dot is a button labelled "पेज n / total — PS"; the page on show is marked', () => {
    render(<Nav pages={PAGES} />);
    const dots = screen.getAllByRole('button', { name: /^पेज / });
    expect(dots).toHaveLength(6);
    expect(dots[3]?.getAttribute('aria-label')).toBe('पेज 4 / 6 — चूरू');
    expect(dots[3]?.getAttribute('title')).toBe('पेज 4 / 6 — चूरू');
    expect(dots[0]?.getAttribute('aria-current')).toBe('page');
    expect(dots.filter((d) => d.hasAttribute('aria-current'))).toHaveLength(1);
    expect(dotLabel({ groupName: null }, 1, 7)).toBe('पेज 2 / 7');
  });

  it('clicking a dot shows that page; the next page comes one full interval later', () => {
    render(<Nav pages={PAGES} />);
    advance(10); // part-way through page 1
    fireEvent.click(screen.getByRole('button', { name: 'पेज 5 / 6 — सरदारशहर' }));
    expect(title()).toBe('सरदारशहर 1/2');
    expect(screen.getByRole('button', { name: 'पेज 5 / 6 — सरदारशहर' }).getAttribute('aria-current')).toBe(
      'page',
    );
    advance(INTERVAL_S - 1);
    expect(title()).toBe('सरदारशहर 1/2');
    advance(1);
    expect(title()).toBe('सरदारशहर 2/2');
    advance(INTERVAL_S);
    expect(title()).toBe('रतनगढ़ 1/3');
  });

  it('clicking the page already on show restarts its turn', () => {
    render(<Nav pages={PAGES} />);
    advance(10);
    fireEvent.click(screen.getByRole('button', { name: 'पेज 1 / 6 — रतनगढ़' }));
    advance(INTERVAL_S - 1);
    expect(title()).toBe('रतनगढ़ 1/3');
    advance(1);
    expect(title()).toBe('रतनगढ़ 2/3');
  });

  it('the PS strip lists each PS once, in page order; a click shows its FIRST page', () => {
    render(<Nav pages={PAGES} />);
    const strip = screen.getByTestId('ps-strip');
    const names = [...strip.querySelectorAll('button')].map((b) => b.textContent.replace('▸ ', ''));
    expect(names).toEqual(['रतनगढ़', 'चूरू', 'सरदारशहर']);
    fireEvent.click(screen.getByRole('button', { name: 'सरदारशहर' }));
    expect(title()).toBe('सरदारशहर 1/2');
    advance(INTERVAL_S);
    expect(title()).toBe('सरदारशहर 2/2');
    fireEvent.click(screen.getByRole('button', { name: 'रतनगढ़' })); // from another PS's later page
    expect(title()).toBe('रतनगढ़ 1/3');
  });

  it('the marked PS always matches the page on show (with a ▸ marker, not colour only)', () => {
    render(<Nav pages={PAGES} />);
    const expected = ['रतनगढ़', 'रतनगढ़', 'रतनगढ़', 'चूरू', 'सरदारशहर', 'सरदारशहर'];
    for (const ps of expected) {
      expect(marked()).toBe(`▸ ${ps}`);
      expect(screen.getByTestId('ps-strip').querySelectorAll('[aria-current]')).toHaveLength(1);
      advance(INTERVAL_S);
    }
    expect(marked()).toBe('▸ रतनगढ़');
  });

  it('Left/Right arrow keys move to the previous/next page (wrapping) and restart the turn', () => {
    render(<Nav pages={PAGES} />);
    advance(10);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(title()).toBe('रतनगढ़ 2/3');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(title()).toBe('सरदारशहर 2/2');
    expect(marked()).toBe('▸ सरदारशहर');
    advance(INTERVAL_S - 1);
    expect(title()).toBe('सरदारशहर 2/2');
    advance(1);
    expect(title()).toBe('रतनगढ़ 1/3');
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true }); // browser shortcuts left alone
    expect(title()).toBe('रतनगढ़ 1/3');
  });

  it('the strip and dots are real buttons, so Enter/Space and focus work like any button', () => {
    render(<Nav pages={PAGES} />);
    const chip = screen.getByRole('button', { name: 'चूरू' });
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('type')).toBe('button');
    chip.focus();
    expect(document.activeElement).toBe(chip);
    for (const d of screen.getAllByRole('button', { name: /^पेज / })) expect(d.tagName).toBe('BUTTON');
  });

  it('the ZP screen has no PS strip entries and dot labels without a PS name', () => {
    const zp: Page[] = [0, 1].map((i) => ({
      key: `zp-${String(i)}`,
      title: 'ज़िला परिषद',
      sub: `${String(i + 1)}/2`,
      summary: { wardsTotal: 0, declared: 0, unopposed: 0, counting: 0, notStarted: 0 },
      wards: [ward(i)],
      group: null,
      groupName: null,
    }));
    expect(pageGroups(zp)).toEqual([]);
    render(<PageDots pages={zp} index={0} onPick={() => undefined} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'पेज 1 / 2',
      'पेज 2 / 2',
    ]);
  });
});
