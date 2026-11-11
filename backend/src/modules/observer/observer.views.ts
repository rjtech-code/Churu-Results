// PURE projections of the ObserverBuild for the observer API. Everything here SELECTS fields of
// the DM report objects; nothing adds, recomputes or re-aggregates a vote number. Privacy: an
// observer response carries only result-level data — ward, PS, candidate name, party, votes,
// status, progress, winner, margin. Never officer names/usernames, phone numbers, dates of birth,
// addresses, correction or lottery reasons, audit rows or keys.
import { COUNTING_DATE } from '../../config/election.js';
import type {
  CountingStatusReport,
  KindSummary,
  PsRow,
  WardRow,
  ZpWardPsProgress,
} from '../../services/counting-status.js';
import type { ReportSummary, ScopeSections, WinnerRow } from '../../services/reports.js';
import type { SeatRow } from '../../services/public-views.js';
import type { DeclarationFeedItem, ObserverBuild, StructureCounts } from './observer.cache.js';

export type CountingPhase = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface KindKpis {
  wardsTotal: number;
  declared: number;
  unopposed: number;
  counting: number;
  notStarted: number;
  boothsEntered: number;
  boothsTotal: number;
  postalEntered: number;
  postalTotal: number;
}

export interface ObserverOverview {
  generatedAt: string;
  countingDate: string;
  phase: CountingPhase;
  structure: StructureCounts;
  kpis: { ps: KindKpis; zp: KindKpis };
  /** Party position exactly as the DM reports show it: seats won plus (not tied) leading. */
  partySeats: { ps: SeatRow[]; zp: SeatRow[] };
  /** Latest declarations, newest first. */
  feed: DeclarationFeedItem[];
}

const kpisOf = (s: ScopeSections | undefined): KindKpis => ({
  wardsTotal: s?.progress.wardsTotal ?? 0,
  declared: s?.progress.declared ?? 0,
  unopposed: s?.progress.unopposed ?? 0,
  counting: s?.progress.counting ?? 0,
  notStarted: s?.progress.notStarted ?? 0,
  boothsEntered: s?.progress.boothsEntered ?? 0,
  boothsTotal: s?.progress.boothsTotal ?? 0,
  postalEntered: s?.progress.postalEntered ?? 0,
  postalTotal: s?.progress.postalTotal ?? 0,
});

/** The status pill: not started = no booth, postal or declaration yet (unopposed wards aside). */
export function countingPhase(ps: KindKpis, zp: KindKpis): CountingPhase {
  const total = ps.wardsTotal + zp.wardsTotal;
  const decided = ps.declared + ps.unopposed + zp.declared + zp.unopposed;
  if (total > 0 && decided === total) return 'COMPLETED';
  const touched =
    ps.boothsEntered + zp.boothsEntered + ps.postalEntered + zp.postalEntered + ps.declared + zp.declared;
  return touched > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export function overviewView(build: ObserverBuild, feedLimit = 15): ObserverOverview {
  const ps = kpisOf(build.summary.sections.ALL_PS);
  const zp = kpisOf(build.summary.sections.ZP);
  return {
    generatedAt: build.builtAt,
    countingDate: COUNTING_DATE,
    phase: countingPhase(ps, zp),
    structure: build.structure,
    kpis: { ps, zp },
    partySeats: {
      ps: build.summary.sections.ALL_PS?.partySeats ?? [],
      zp: build.summary.sections.ZP?.partySeats ?? [],
    },
    feed: build.declarationsFeed.slice(0, feedLimit),
  };
}

// ---------------------------------------------------------------- ward rows (sanitized)

/** A ward row for lists: the DM Counting Status row minus operational detail. */
export interface ObserverWardRow {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  status: WardRow['status'];
  unopposed: boolean;
  noCandidates: boolean;
  tieNeedsLottery: boolean;
  boothsDone: number | null;
  boothsTotal: number | null;
  boothsPercent: number | null;
  postalDone: boolean | null;
  winner: { name: string; party: string } | null;
  margin: number | null;
}

export const wardRowView = (w: WardRow): ObserverWardRow => ({
  wardId: w.wardId,
  kind: w.kind,
  wardNo: w.wardNo,
  psName: w.psName,
  status: w.status,
  unopposed: w.unopposed,
  noCandidates: w.noCandidates,
  tieNeedsLottery: w.tieNeedsLottery,
  boothsDone: w.boothsDone,
  boothsTotal: w.boothsTotal,
  boothsPercent: w.boothsPercent,
  postalDone: w.postalDone,
  winner: w.winner,
  margin: w.margin,
});

// ---------------------------------------------------------------- Panchayat Samitis

export interface ObserverPsCard {
  psId: number;
  psName: string;
  wardsTotal: number;
  declared: number;
  boothsDone: number;
  boothsTotal: number;
  boothsPercent: number | null;
  /** ZP-ballot booths located in this PS. */
  zpBoothsDone: number;
  zpBoothsTotal: number;
}

const psCard = (p: PsRow): ObserverPsCard => ({
  psId: p.psId,
  psName: p.psName,
  wardsTotal: p.wardsTotal,
  declared: p.declared,
  boothsDone: p.psBoothsDone,
  boothsTotal: p.psBoothsTotal,
  boothsPercent: p.psBoothsPercent,
  zpBoothsDone: p.zpBoothsDone,
  zpBoothsTotal: p.zpBoothsTotal,
});

export function psListView(status: CountingStatusReport): {
  generatedAt: string;
  summary: KindSummary;
  list: ObserverPsCard[];
} {
  return {
    generatedAt: status.asOf,
    summary: status.summary.PS,
    list: status.psTable.map(psCard),
  };
}

export function psDetailView(
  status: CountingStatusReport,
  psId: number,
): { ps: ObserverPsCard; wards: ObserverWardRow[] } | null {
  const ps = status.psTable.find((p) => p.psId === psId);
  if (ps === undefined) return null;
  return {
    ps: psCard(ps),
    wards: status.wards
      .filter((w) => w.kind === 'PS' && w.psId === psId)
      .map(wardRowView),
  };
}

// ---------------------------------------------------------------- Zila Parishad

/** A ZP ward's progress by contributing PS (names and counts only). */
export interface ObserverZpPsProgress {
  wardId: number;
  rows: { psName: string; boothsDone: number; boothsTotal: number }[];
  postalEntered: boolean | null;
}

export function zpView(status: CountingStatusReport): {
  generatedAt: string;
  summary: KindSummary;
  wards: ObserverWardRow[];
  byPs: ObserverZpPsProgress[];
} {
  const byPs = status.zpPsProgress.map(
    (z: ZpWardPsProgress): ObserverZpPsProgress => ({
      wardId: z.wardId,
      rows: z.rows.map((r) => ({
        psName: r.psName,
        boothsDone: r.boothsDone,
        boothsTotal: r.boothsTotal,
      })),
      postalEntered: z.postal.entered,
    }),
  );
  return {
    generatedAt: status.asOf,
    summary: status.summary.ZP,
    wards: status.wards.filter((w) => w.kind === 'ZP').map(wardRowView),
    byPs,
  };
}

// ---------------------------------------------------------------- winners

export interface ObserverWinner {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  winner: { name: string; party: string };
  margin: number | null;
  unopposed: boolean;
  tieResolved: boolean;
  isWoman: boolean;
  isCorrected: boolean;
}

/** Winner ward ids of the DM "women winners" section (both scopes). */
function womenWardIds(summary: ReportSummary): Set<number> {
  const ids = new Set<number>();
  for (const key of ['ALL_PS', 'ZP']) {
    for (const row of summary.sections[key]?.women.list ?? []) ids.add(row.ward.id);
  }
  return ids;
}

export function winnersView(build: ObserverBuild): { generatedAt: string; list: ObserverWinner[] } {
  const women = womenWardIds(build.summary);
  const corrected = new Set(build.declarationsFeed.filter((d) => d.isCorrection).map((d) => d.wardId));
  const tieResolved = new Set(
    build.declarationsFeed.filter((d) => d.status === 'TIE_RESOLVED').map((d) => d.wardId),
  );
  const list = build.status.wards
    .filter((w): w is WardRow & { winner: { name: string; party: string } } => w.winner !== null)
    .map(
      (w): ObserverWinner => ({
        wardId: w.wardId,
        kind: w.kind,
        wardNo: w.wardNo,
        psName: w.psName,
        winner: w.winner,
        margin: w.margin,
        unopposed: w.unopposed,
        tieResolved: tieResolved.has(w.wardId),
        isWoman: women.has(w.wardId),
        isCorrected: corrected.has(w.wardId),
      }),
    );
  return { generatedAt: build.status.asOf, list };
}

// ---------------------------------------------------------------- ward detail (sanitized)

/** The DM ward detail (wardDetail()), reduced to its result-level fields. */
export interface DmWardDetailLike {
  ward: {
    id: number;
    kind: 'PS' | 'ZP';
    wardNo: number;
    psName: string | null;
    reservationCategory: string | null;
    isUnopposed: boolean;
    status: string;
    totalValidVotes: number;
    notaVotes: number;
    rejectedPostal: number | null;
    boothsEntered: number;
    boothsTotal: number;
    postalEntered: boolean;
    margin: number | null;
    unavailable: boolean;
  };
  candidates: {
    id: number;
    ballotPosition: number;
    name: string;
    party: { shortName: string; nameHindi: string } | null;
    isNota: boolean;
    boothVotes: number;
    postalVotes: number;
    totalVotes: number;
    rank: number | null;
    isWinner: boolean;
  }[];
  booths: { boothNo: string; name: string; psName: string; entered: boolean }[];
  postal: { entered: boolean };
  declarations: {
    version: number;
    status: string;
    winner: { id: number; name: string };
    margin: number;
    totalValidVotes: number | null;
    declaredAt: string;
  }[];
}

/**
 * Copies ONLY the allowed fields out of the DM ward detail. Live candidate votes appear exactly as
 * the DM sees them (visible while counting); officer names, reasons, lottery notes, edit counts and
 * voter counts never leave this function.
 */
export function wardDetailView(detail: {
  ward: Omit<DmWardDetailLike['ward'], 'kind'> & { kind: string };
  candidates: (DmWardDetailLike['candidates'][number] & Record<string, unknown>)[];
  booths: (DmWardDetailLike['booths'][number] & Record<string, unknown>)[];
  postal: { entered: boolean } & Record<string, unknown>;
  declarations: (DmWardDetailLike['declarations'][number] & Record<string, unknown>)[];
}): DmWardDetailLike {
  const w = detail.ward;
  return {
    ward: {
      id: w.id,
      kind: w.kind === 'ZP' ? 'ZP' : 'PS',
      wardNo: w.wardNo,
      psName: w.psName,
      reservationCategory: w.reservationCategory,
      isUnopposed: w.isUnopposed,
      status: w.status,
      totalValidVotes: w.totalValidVotes,
      notaVotes: w.notaVotes,
      rejectedPostal: w.rejectedPostal,
      boothsEntered: w.boothsEntered,
      boothsTotal: w.boothsTotal,
      postalEntered: w.postalEntered,
      margin: w.margin,
      unavailable: w.unavailable,
    },
    candidates: detail.candidates.map((c) => ({
      id: c.id,
      ballotPosition: c.ballotPosition,
      name: c.name,
      party: c.party,
      isNota: c.isNota,
      boothVotes: c.boothVotes,
      postalVotes: c.postalVotes,
      totalVotes: c.totalVotes,
      rank: c.rank,
      isWinner: c.isWinner,
    })),
    booths: detail.booths.map((b) => ({
      boothNo: b.boothNo,
      name: b.name,
      psName: b.psName,
      entered: b.entered,
    })),
    postal: { entered: detail.postal.entered },
    declarations: detail.declarations.map((d) => ({
      version: d.version,
      status: d.status,
      winner: d.winner,
      margin: d.margin,
      totalValidVotes: d.totalValidVotes,
      declaredAt: d.declaredAt,
    })),
  };
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  status: WardRow['status'];
  winner: { name: string; party: string } | null;
  /** Candidate names on this ward's ballot that matched the query. */
  matchedCandidates: { name: string; party: string | null }[];
}

export const SEARCH_LIMIT = 25;

/** Case-insensitive contains-search over ward numbers, PS names and candidate names. */
export function searchView(build: ObserverBuild, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const rows = new Map(build.status.wards.map((w) => [w.wardId, w]));
  const byWard = new Map<number, SearchHit>();
  const hit = (wardId: number): SearchHit | null => {
    const existing = byWard.get(wardId);
    if (existing !== undefined) return existing;
    const row = rows.get(wardId);
    if (row === undefined) return null;
    const fresh: SearchHit = {
      wardId,
      kind: row.kind,
      wardNo: row.wardNo,
      psName: row.psName,
      status: row.status,
      winner: row.winner,
      matchedCandidates: [],
    };
    byWard.set(wardId, fresh);
    return fresh;
  };
  const isNumber = /^\d+$/.test(q);
  // PS names match in Hindi (the stored name) and in the report's English display name.
  const hindiPs = new Map(build.searchIndex.wards.map((w) => [w.id, w.psName]));
  for (const row of build.status.wards) {
    const matchesNo = isNumber && String(row.wardNo) === q;
    const matchesPs =
      !isNumber &&
      ((row.psName?.toLowerCase().includes(q) ?? false) ||
        (hindiPs.get(row.wardId)?.toLowerCase().includes(q) ?? false));
    if (matchesNo || matchesPs) hit(row.wardId);
  }
  if (!isNumber && q.length >= 2) {
    for (const c of build.searchIndex.candidates) {
      if (!c.name.toLowerCase().includes(q)) continue;
      const h = hit(c.wardId);
      if (h !== null && h.matchedCandidates.length < 5)
        h.matchedCandidates.push({ name: c.name, party: c.party });
    }
  }
  return [...byWard.values()]
    .sort((a, b) => (a.kind === b.kind ? a.wardNo - b.wardNo : a.kind === 'ZP' ? -1 : 1))
    .slice(0, SEARCH_LIMIT);
}

// ---------------------------------------------------------------- women winners (DM section)

export interface ObserverWomenSection {
  generatedAt: string;
  ps: { total: number; byParty: { party: WinnerRow['party']; count: number }[]; list: WinnerRow[] };
  zp: { total: number; byParty: { party: WinnerRow['party']; count: number }[]; list: WinnerRow[] };
}

export function womenView(build: ObserverBuild): ObserverWomenSection {
  const empty = { total: 0, byParty: [], list: [] };
  return {
    generatedAt: build.builtAt,
    ps: build.summary.sections.ALL_PS?.women ?? empty,
    zp: build.summary.sections.ZP?.women ?? empty,
  };
}
