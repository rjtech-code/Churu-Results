import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STATUS_TONE, TONES, fitWords, isQuiet, tickerText } from '../../screens/format';
import { gridRows, pageDuration, parseInterval, screenProgress } from '../../screens/paging';
import { CardGrid, WardCardView } from '../../screens/WardCardView';
import { PUBLIC_STATUSES } from '../../screens/types';
import type { PublicStatus, RecentItem, WardCard } from '../../screens/types';

const css = readFileSync(resolve(import.meta.dirname, '../../styles/screens.css'), 'utf8');
/** The colour variables of :root in screens.css. */
const vars = new Map(
  [...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
const v = (name: string): string => {
  const value = vars.get(name);
  if (value === undefined) throw new Error(`--${name} missing in screens.css`);
  return value;
};

const card = (status: PublicStatus, over: Partial<WardCard> = {}): WardCard => ({
  wardId: 1,
  wardNo: 1,
  status,
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
  ...over,
});

describe('status colours', () => {
  it('every status the API can send has a tone, as specified', () => {
    expect(Object.keys(STATUS_TONE).sort()).toEqual([...PUBLIC_STATUSES].sort());
    expect(STATUS_TONE).toEqual({
      NOT_STARTED: 'grey',
      NO_CANDIDATES: 'grey',
      COUNTING: 'blue',
      READY_TO_DECLARE: 'blue',
      TIE_NEEDS_LOTTERY: 'amber',
      DECLARED: 'green',
      TIE_RESOLVED: 'purple',
      UNOPPOSED: 'teal',
      UNAVAILABLE: 'red',
    });
  });

  it('every tone has its stripe, badge background and ink variables, and a CSS class', () => {
    for (const t of TONES) {
      for (const name of [`st-${t}`, `st-${t}-bg`, `st-${t}-ink`]) expect(vars.has(name), name).toBe(true);
      expect(css).toContain(`.tone-${t}`);
    }
  });

  it('text contrast is at least WCAG AA (4.5:1)', () => {
    const pairs: [string, string][] = [
      ['tv-text', 'tv-bg'],
      ['tv-text', 'tv-card'],
      ['tv-muted', 'tv-card'],
      ['tv-muted', 'tv-quiet'],
      ['tv-ticker-ink', 'tv-ticker-bg'],
      ['tv-winner-ink', 'tv-winner-bg'],
      ...TONES.map((t): [string, string] => [`st-${t}-ink`, `st-${t}-bg`]),
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(v(fg), v(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    // white text on the header and the ticker label
    expect(contrast('#ffffff', v('tv-header'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', v('tv-ticker-label'))).toBeGreaterThanOrEqual(4.5);
  });

  it('cards carry the tone class; NOT_STARTED / NO_CANDIDATES are quiet cards', () => {
    for (const s of PUBLIC_STATUSES) {
      const { container, unmount } = render(<WardCardView card={card(s)} changed={false} />);
      const el = container.querySelector('article');
      expect(el?.classList.contains(`tone-${STATUS_TONE[s]}`), s).toBe(true);
      expect(el?.classList.contains('tv-card-quiet'), s).toBe(isQuiet(s));
      unmount();
    }
  });
});

describe('ticker text', () => {
  const item = (over: Partial<RecentItem>): RecentItem => ({
    wardId: 1,
    kind: 'PS',
    psName: 'राजगढ़',
    wardNo: 9,
    status: 'DECLARED',
    leaderOrWinner: { candidateId: 1, name: 'रामलाल', party: { shortName: 'BJP', nameHindi: 'x' } },
    changedAt: '',
    ...over,
  });

  it('short sentences with the short Hindi PS name, or ज़िला परिषद', () => {
    expect(tickerText(item({}))).toBe('राजगढ़ · वार्ड 9 · विजयी: रामलाल (BJP)');
    expect(
      tickerText(
        item({ psName: 'पंचायत समिति चूरू', wardNo: 8, status: 'NOT_STARTED', leaderOrWinner: null }),
      ),
    ).toBe('चूरू · वार्ड 8 · शुरू नहीं');
    expect(
      tickerText(item({ status: 'COUNTING', leaderOrWinner: { candidateId: 2, name: 'सीता', party: null } })),
    ).toBe('राजगढ़ · वार्ड 9 · मतगणना जारी — आगे: सीता (निर्दलीय)');
    expect(tickerText(item({ kind: 'ZP', psName: null, wardNo: 2, status: 'TIE_RESOLVED' }))).toBe(
      'ज़िला परिषद · वार्ड 2 · विजयी (लॉटरी): रामलाल (BJP)',
    );
    expect(tickerText(item({ psName: 'RAJGARH PANCHAYAT SAMITI', status: 'UNOPPOSED' }))).toBe(
      'RAJGARH · वार्ड 9 · निर्विरोध निर्वाचित: रामलाल (BJP)',
    );
  });

  it('never cuts inside a word', () => {
    const long = 'तारानगर पश्चिम (भालेरी) · वार्ड 12 · विजयी: रामेश्वर लाल मेघवाल चौधरी साहब (राष्ट्रीय)';
    const out = fitWords(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith(' …')).toBe(true);
    const kept = out.slice(0, -2).split(' ');
    const words = long.split(' ');
    expect(kept).toEqual(
      words
        .slice(0, kept.length)
        .map((w, i) => (i === kept.length - 1 ? w.replace(/[·—:]+$/u, '') : w))
        .filter(Boolean),
    );
    expect(fitWords('छोटा पाठ', 60)).toBe('छोटा पाठ');
    expect(
      tickerText(
        item({
          psName: 'तारानगर पश्चिम (भालेरी)',
          leaderOrWinner: { candidateId: 1, name: 'रामेश्वर लाल मेघवाल चौधरी साहब', party: null },
        }),
      ).length,
    ).toBeLessThanOrEqual(60);
  });
});

describe('rotation, progress and grid', () => {
  const quietPage = { wards: [card('NOT_STARTED'), card('NO_CANDIDATES')] };
  const busyPage = { wards: [card('NOT_STARTED'), card('COUNTING')] };

  it('a page where every ward is not started / has no candidates stays 5 s; others the interval', () => {
    expect(pageDuration(quietPage, 15)).toBe(5);
    expect(pageDuration(busyPage, 15)).toBe(15);
    expect(pageDuration(busyPage, parseInterval('?interval=40'))).toBe(40);
    expect(pageDuration(quietPage, parseInterval('?interval=40'))).toBe(5);
    expect(pageDuration({ wards: [card('UNOPPOSED')] }, 15)).toBe(15);
  });

  it('header progress: DECLARED + TIE_RESOLVED + UNOPPOSED out of all wards', () => {
    const cards = [
      'DECLARED',
      'TIE_RESOLVED',
      'UNOPPOSED',
      'COUNTING',
      'READY_TO_DECLARE',
      'NOT_STARTED',
      'NO_CANDIDATES',
      'TIE_NEEDS_LOTTERY',
      'UNAVAILABLE',
    ].map((s) => card(s as PublicStatus));
    expect(screenProgress(cards)).toEqual({ declared: 3, total: 9 });
    expect(screenProgress([])).toEqual({ declared: 0, total: 0 });
  });

  it('the grid gets as many rows as needed (1..3) so they stretch to the full height', () => {
    expect(gridRows(12, 4)).toBe(3);
    expect(gridRows(8, 4)).toBe(2);
    expect(gridRows(7, 4)).toBe(2);
    expect(gridRows(1, 4)).toBe(1);
    expect(gridRows(0, 4)).toBe(1);
    expect(gridRows(9, 3)).toBe(3);
    const { container } = render(
      <CardGrid
        cards={[card('COUNTING'), card('DECLARED', { wardId: 2 })]}
        changed={new Set()}
        className="x"
      />,
    );
    expect(container.querySelector('.tv-grid')?.getAttribute('data-rows')).toBe('1');
    expect(css).toMatch(/\.tv-grid\[data-rows='2'\]/);
  });
});
