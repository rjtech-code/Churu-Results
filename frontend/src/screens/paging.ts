import { isQuiet, psShortName } from './format';
import type { PsBlock, Summary, WardCard } from './types';

export const DEFAULT_INTERVAL_S = 15;
export const MIN_INTERVAL_S = 5;
export const MAX_INTERVAL_S = 120;
export const PS_CARDS_PER_PAGE = 8; // 4 x 2: room for top 3 with two-line names at full size
export const ZP_CARDS_PER_PAGE = 6; // 3 x 2

/** ?interval=SECONDS -> seconds between pages (missing/invalid: 15; clamped to 5..120). */
export function parseInterval(search: string): number {
  const raw = new URLSearchParams(search).get('interval');
  if (raw === null || !/^\d+$/.test(raw.trim())) return DEFAULT_INTERVAL_S;
  return Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, Number(raw)));
}

/** Splits into the fewest pages of at most `perPage`, as evenly as possible (15 -> 8 + 7). */
export function splitEvenly<T>(items: readonly T[], perPage: number): T[][] {
  if (items.length === 0) return [[]];
  const pages = Math.ceil(items.length / perPage);
  const base = Math.floor(items.length / pages);
  const extra = items.length % pages; // the first `extra` pages get one more
  const out: T[][] = [];
  let at = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < extra ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

export interface Page {
  key: string;
  title: string;
  /** "1/2" when a block is split, else null. */
  sub: string | null;
  summary: Summary;
  wards: WardCard[];
  /** PS pages: the PS id (all pages of one PS share it). null on the ZP screen. */
  group: string | null;
  /** PS pages: the short Hindi PS name ("रतनगढ़") for the PS strip and the dot labels. */
  groupName: string | null;
}

/** One cycle of pages: every PS in layout order, each split evenly into sub-pages. */
export function psPages(blocks: readonly PsBlock[], perPage = PS_CARDS_PER_PAGE): Page[] {
  return blocks.flatMap((b) => {
    const parts = splitEvenly(b.wards, perPage);
    return parts.map((wards, i) => ({
      key: `${b.panchayatSamiti.id}-${i}`,
      title: b.panchayatSamiti.name,
      sub: parts.length > 1 ? `${i + 1}/${parts.length}` : null,
      summary: b.summary,
      wards,
      group: String(b.panchayatSamiti.id),
      groupName: psShortName(b.panchayatSamiti.name),
    }));
  });
}

export function zpPages(wards: readonly WardCard[], summary: Summary, perPage = ZP_CARDS_PER_PAGE): Page[] {
  const parts = splitEvenly(wards, perPage);
  return parts.map((w, i) => ({
    key: `zp-${i}`,
    title: 'ज़िला परिषद',
    sub: parts.length > 1 ? `${i + 1}/${parts.length}` : null,
    summary,
    wards: w,
    group: null,
    groupName: null,
  }));
}

export interface PageGroup {
  key: string;
  name: string;
  /** Index of the group's first page. */
  first: number;
}

/** The PS of a screen in page order, each with its first page (empty on the ZP screen). */
export function pageGroups(pages: readonly Pick<Page, 'group' | 'groupName'>[]): PageGroup[] {
  const out: PageGroup[] = [];
  pages.forEach((p, i) => {
    if (p.group !== null && !out.some((g) => g.key === p.group))
      out.push({ key: p.group, name: p.groupName ?? '', first: i });
  });
  return out;
}

/** Label of a page dot: "पेज 3 / 16 — रतनगढ़" (without the PS name on the ZP screen). */
export function dotLabel(page: Pick<Page, 'groupName'>, index: number, count: number): string {
  const base = `पेज ${String(index + 1)} / ${String(count)}`;
  return page.groupName === null ? base : `${base} — ${page.groupName}`;
}

export function pageLabel(p: Pick<Page, 'title' | 'sub'>): string {
  return p.sub === null ? p.title : `${p.title} ${p.sub}`;
}

export const QUIET_PAGE_S = 5;

/** Seconds a page stays: 5 s when every ward on it is not started / has no candidates, else the interval. */
export function pageDuration(page: Pick<Page, 'wards'>, intervalS: number): number {
  const quiet = page.wards.every((w) => isQuiet(w.status));
  return quiet ? Math.min(QUIET_PAGE_S, intervalS) : intervalS;
}

/** Header progress: declared (incl. lottery and unopposed) / all wards of the screen. */
export function screenProgress(cards: readonly WardCard[]): { declared: number; total: number } {
  const declared = cards.filter((c) => DECLARED_STATUSES.has(c.status)).length;
  return { declared, total: cards.length };
}
const DECLARED_STATUSES = new Set(['DECLARED', 'TIE_RESOLVED', 'UNOPPOSED']);

/** Rows a page's grid needs (1..3), so the rows stretch to fill the height. */
export function gridRows(cards: number, columns: number): number {
  return Math.max(1, Math.ceil(cards / columns));
}
