import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, fmt, istClock, psShort } from '../../screens/format';
import { FIXED_PARTY_COLOURS, INDEPENDENT_GREY, PALETTE, partyColour } from '../../screens/partyColours';
import { pieSlices } from '../../screens/pie';
import { parseInterval, psPages, splitEvenly } from '../../screens/paging';
import { PUBLIC_STATUSES } from '../../screens/types';
import type { PsBlock, WardCard } from '../../screens/types';

const row = (key: string, value: number) => ({ key, label: key, value, colour: '#000' });

describe('pie slices', () => {
  it('angles are contiguous and sum to exactly 360', () => {
    const s = pieSlices([row('a', 3), row('b', 2), row('c', 2)], 100, 100, 90);
    expect(s.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect(s[0]?.startAngle).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i]?.startAngle).toBe(s[i - 1]?.endAngle);
    expect(s.at(-1)?.endAngle).toBe(360);
    const sum = s.reduce((t, x) => t + (x.endAngle - x.startAngle), 0);
    expect(sum).toBeCloseTo(360, 9);
    expect(s[0]?.endAngle).toBeCloseTo((3 / 7) * 360, 9);
    expect(s.every((x) => !x.full && x.path.startsWith('M 100 100 L'))).toBe(true);
  });

  it('one party with seats = a full circle (no arc path)', () => {
    const s = pieSlices([row('a', 0), row('b', 5)], 100, 100, 90);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: 'b', full: true, path: '', startAngle: 0, endAngle: 360 });
  });

  it('zero seats = no slices (the screen shows the empty-state message)', () => {
    expect(pieSlices([], 100, 100, 90)).toEqual([]);
    expect(pieSlices([row('a', 0), row('b', 0)], 100, 100, 90)).toEqual([]);
  });

  it('a slice over half the circle uses the large-arc flag', () => {
    const [big, small] = pieSlices([row('a', 3), row('b', 1)], 100, 100, 90);
    expect(big?.path).toContain(' 0 1 1 ');
    expect(small?.path).toContain(' 0 0 1 ');
  });
});

describe('paging', () => {
  it('splits evenly into the fewest pages of at most N', () => {
    const sizes = (n: number, per: number) => splitEvenly([...Array(n).keys()], per).map((p) => p.length);
    expect(sizes(29, 12)).toEqual([10, 10, 9]);
    expect(sizes(15, 12)).toEqual([8, 7]);
    expect(sizes(12, 12)).toEqual([12]);
    expect(sizes(13, 12)).toEqual([7, 6]);
    expect(sizes(1, 12)).toEqual([1]);
    expect(sizes(0, 12)).toEqual([0]);
    expect(sizes(39, 9)).toEqual([8, 8, 8, 8, 7]);
    // order kept, nothing lost
    expect(splitEvenly([...Array(29).keys()], 12).flat()).toEqual([...Array(29).keys()]);
  });

  it('one cycle: every PS in layout order, sub-pages labelled "1/2"', () => {
    const card = (wardNo: number) => ({ wardId: wardNo, wardNo }) as WardCard;
    const block = (id: number, name: string, n: number): PsBlock => ({
      panchayatSamiti: { id, name },
      summary: { wardsTotal: n, declared: 0, unopposed: 0, counting: 0, notStarted: n },
      wards: [...Array(n).keys()].map((i) => card(i + 1)),
    });
    const pages = psPages([block(1, 'रतनगढ़', 29), block(2, 'चूरू', 5)], 12);
    expect(pages.map((p) => [p.title, p.sub, p.wards.length])).toEqual([
      ['रतनगढ़', '1/3', 10],
      ['रतनगढ़', '2/3', 10],
      ['रतनगढ़', '3/3', 9],
      ['चूरू', null, 5],
    ]);
  });

  it('?interval: default 15, clamped to 5..120, junk ignored', () => {
    expect(parseInterval('')).toBe(15);
    expect(parseInterval('?interval=30')).toBe(30);
    expect(parseInterval('?interval=3')).toBe(5);
    expect(parseInterval('?interval=500')).toBe(120);
    expect(parseInterval('?interval=abc')).toBe(15);
    expect(parseInterval('?interval=-5')).toBe(15);
    expect(parseInterval('?interval=7.5')).toBe(15);
  });
});

describe('formatting', () => {
  it('Western digits with Indian grouping', () => {
    expect(fmt(123456)).toBe('1,23,456');
    expect(fmt(1000000)).toBe('10,00,000');
    expect(fmt(999)).toBe('999');
    expect(fmt(0)).toBe('0');
  });

  it('time from the server IST timestamp (not the laptop clock)', () => {
    expect(istClock('2026-11-20T10:15:02.123+05:30')).toBe('10:15:02');
    expect(istClock('garbage')).toBe('—');
  });

  it('short PS name for page titles', () => {
    expect(psShort('पंचायत समिति रतनगढ़')).toBe('रतनगढ़');
    expect(psShort('CHURU')).toBe('CHURU');
  });

  it('the status label map covers every status the public API can send (read from the backend source)', () => {
    const repo = resolve(import.meta.dirname, '../../../..');
    const result = readFileSync(resolve(repo, 'backend/src/services/result.ts'), 'utf8');
    const views = readFileSync(resolve(repo, 'backend/src/services/public-views.ts'), 'utf8');
    const union = (text: string, start: RegExp) => {
      const from = text.search(start);
      const body = text.slice(from, text.indexOf(';', from));
      return [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? '');
    };
    const backend = new Set([
      ...union(result, /export type ResultStatus\s*=/),
      ...union(views, /export type PublicStatus\s*=/),
    ]);
    expect(backend.size).toBeGreaterThanOrEqual(9);
    expect([...backend].sort()).toEqual([...PUBLIC_STATUSES].sort());
    for (const s of backend) expect(STATUS_LABEL[s as keyof typeof STATUS_LABEL], s).toBeTruthy();
    expect(STATUS_LABEL).toMatchObject({
      NOT_STARTED: 'शुरू नहीं',
      COUNTING: 'मतगणना जारी',
      READY_TO_DECLARE: 'घोषणा बाकी',
      TIE_NEEDS_LOTTERY: 'बराबर — लॉटरी बाकी',
      DECLARED: 'विजयी',
      TIE_RESOLVED: 'विजयी (लॉटरी)',
      UNOPPOSED: 'निर्विरोध निर्वाचित',
      NO_CANDIDATES: 'उम्मीदवार सूची बाकी',
      UNAVAILABLE: 'उपलब्ध नहीं',
    });
  });
});

describe('party colours', () => {
  it('fixed map first; others by sorted short name; independents grey; same data -> same colours', () => {
    expect(partyColour('BJP', ['ZZZ', 'BJP'])).toBe(FIXED_PARTY_COLOURS.BJP);
    expect(partyColour(null, [])).toBe(INDEPENDENT_GREY);
    expect(partyColour('AAA', ['ZZZ', 'AAA', 'BJP'])).toBe(PALETTE[0]);
    expect(partyColour('ZZZ', ['ZZZ', 'AAA', 'BJP'])).toBe(PALETTE[1]);
    expect(partyColour('ZZZ', ['AAA', 'ZZZ'])).toBe(partyColour('ZZZ', ['ZZZ', 'AAA']));
    expect(Object.values(FIXED_PARTY_COLOURS)).not.toContain(INDEPENDENT_GREY);
  });
});
