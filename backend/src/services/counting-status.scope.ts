// A scope on the Counting Status Report: the DM picks what to see (whole district, all PS wards, all ZP
// wards, one PS, one ward, one booth; optionally a status). PURE: it only SELECTS rows of the one full
// report (buildCountingStatus); a summary for a part of it is made by the same summarizeWards(), and
// a PS row is the full report's own row. So a scoped number always equals that part of the full report.
import { STATUS_LABEL, summarizeWards } from './counting-status.js';
import type { CountingStatus, CountingStatusReport, WardKind, WardRow } from './counting-status.js';

export const SCOPE_LEVELS = ['DISTRICT', 'ALL_PS', 'ALL_ZP', 'PS', 'WARD', 'BOOTH'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];
export const STATUS_FILTERS = [
  'ALL',
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY',
  'DECLARED',
  'STALLED',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type ReportScope =
  | { level: 'DISTRICT' | 'ALL_PS' | 'ALL_ZP'; status: StatusFilter }
  | { level: 'PS'; psId: number; status: StatusFilter }
  | { level: 'WARD'; wardId: number }
  | { level: 'BOOTH'; boothId: number };

export interface ScopeInfo {
  level: ScopeLevel;
  psId: number | null;
  wardId: number | null;
  boothId: number | null;
  status: StatusFilter;
  /** "SUJANGARH - Ward 5", "Whole District · Status: Stalled", … */
  label: string;
}

export interface ScopedReport extends CountingStatusReport {
  scope: ScopeInfo;
  /** The summary bands that belong to this scope (none for one booth). */
  kinds: WardKind[];
}

/** The PS, ward or booth of the scope does not exist (404). */
export class ScopeNotFoundError extends Error {
  override readonly name = 'ScopeNotFoundError';
}

const LEVEL_LABEL: Readonly<Record<'DISTRICT' | 'ALL_PS' | 'ALL_ZP', string>> = {
  DISTRICT: 'Whole District',
  ALL_PS: 'All Panchayat Samiti wards',
  ALL_ZP: 'All Zila Parishad wards',
};
export const STATUS_FILTER_LABEL: Readonly<Record<StatusFilter, string>> = {
  ALL: 'All',
  ...STATUS_LABEL,
  STALLED: 'Stalled',
};

/** Status filter: a list filter only (the summary describes the whole scope). */
export function matchesStatus(w: WardRow, status: StatusFilter): boolean {
  if (status === 'ALL') return true;
  if (status === 'STALLED') return w.stalled;
  return w.status === (status satisfies CountingStatus);
}

const wardLabel = (w: WardRow) =>
  `${w.kind === 'PS' ? (w.psName ?? '') : 'Zila Parishad'} - Ward ${String(w.wardNo)}`;

export function scopeReport(full: CountingStatusReport, scope: ReportScope): ScopedReport {
  const empty = summarizeWards([]);
  let levelWards: WardRow[];
  let kinds: WardKind[];
  let summary = full.summary;
  let psTable = full.psTable;
  let booths = full.booths;
  let label: string;
  const status = 'status' in scope ? scope.status : 'ALL';

  switch (scope.level) {
    case 'DISTRICT':
    case 'ALL_PS':
    case 'ALL_ZP': {
      kinds =
        scope.level === 'DISTRICT' ? ['PS', 'ZP'] : scope.level === 'ALL_PS' ? ['PS'] : ['ZP'];
      levelWards = full.wards.filter((w) => kinds.includes(w.kind));
      if (scope.level === 'ALL_ZP') psTable = [];
      label = LEVEL_LABEL[scope.level];
      break;
    }
    case 'PS': {
      const row = full.psTable.find((p) => p.psId === scope.psId);
      if (row === undefined) throw new ScopeNotFoundError(`PS ${String(scope.psId)}`);
      kinds = ['PS'];
      levelWards = full.wards.filter((w) => w.kind === 'PS' && w.psId === scope.psId);
      summary = { PS: summarizeWards(levelWards), ZP: empty };
      psTable = [row];
      label = `${row.psName} (Panchayat Samiti)`;
      break;
    }
    case 'WARD': {
      const ward = full.wards.find((w) => w.wardId === scope.wardId);
      if (ward === undefined) throw new ScopeNotFoundError(`ward ${String(scope.wardId)}`);
      kinds = [ward.kind];
      levelWards = [ward];
      summary =
        ward.kind === 'PS'
          ? { PS: summarizeWards([ward]), ZP: empty }
          : { PS: empty, ZP: summarizeWards([ward]) };
      psTable = [];
      booths = full.booths.filter((b) => b.wardId === ward.wardId);
      label = wardLabel(ward);
      break;
    }
    case 'BOOTH': {
      booths = full.booths.filter((b) => b.boothId === scope.boothId);
      const first = booths[0];
      if (first === undefined) throw new ScopeNotFoundError(`booth ${String(scope.boothId)}`);
      const wardIds = new Set(booths.map((b) => b.wardId));
      kinds = [];
      levelWards = full.wards.filter((w) => wardIds.has(w.wardId));
      summary = { PS: empty, ZP: empty };
      psTable = [];
      label = `${first.psName} - Booth ${String(first.boothNo)}`;
      break;
    }
  }

  const wards = levelWards.filter((w) => matchesStatus(w, status));
  if (scope.level !== 'WARD' && scope.level !== 'BOOTH') {
    const listed = new Set(wards.map((w) => w.wardId));
    booths = full.booths.filter((b) => listed.has(b.wardId));
  }
  // "By Panchayat Samiti" of the listed ZP wards (a PS scope, a booth: none).
  const listedZp = new Set(
    scope.level === 'PS' || scope.level === 'BOOTH' ? [] : wards.map((w) => w.wardId),
  );
  if (status !== 'ALL') label = `${label} · Status: ${STATUS_FILTER_LABEL[status]}`;

  return {
    ...full,
    summary,
    psTable,
    wards,
    booths,
    zpPsProgress: full.zpPsProgress.filter((z) => listedZp.has(z.wardId)),
    kinds,
    scope: {
      level: scope.level,
      psId: scope.level === 'PS' ? scope.psId : null,
      wardId: scope.level === 'WARD' ? scope.wardId : null,
      boothId: scope.level === 'BOOTH' ? scope.boothId : null,
      status,
      label,
    },
  };
}

/** Levels a ZP_RO may ask for; no level means All ZP wards. */
export const ZP_RO_LEVELS: readonly ScopeLevel[] = ['ALL_ZP', 'WARD', 'BOOTH'];

/**
 * The ZP_RO's report: Zila Parishad data only, whatever was asked. Removes every PS-ward row, PS
 * summary and PS table (a booth scope keeps only that booth's ZP ballot). The caller refuses a
 * scope outside ZP_RO_LEVELS or a PS ward before this.
 */
export function restrictToZp(r: ScopedReport): ScopedReport {
  return {
    ...r,
    summary: { PS: summarizeWards([]), ZP: r.summary.ZP },
    psTable: [],
    wards: r.wards.filter((w) => w.kind === 'ZP'),
    booths: r.booths.filter((b) => b.kind === 'ZP'),
    kinds: r.kinds.filter((k) => k === 'ZP'),
  };
}
