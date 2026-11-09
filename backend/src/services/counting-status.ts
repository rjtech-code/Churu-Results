// The DM's Counting Status Report: a PURE builder from one consistent read (counting-status.data.ts).
// The UI (JSON), the PDF and both CSVs are all rendered from the ONE object built here, so they can
// never disagree. Nothing here adds votes: ward status, booths entered and margins come from
// result.ts; a booth's "total votes" is its saved sheet_total (checked by result.ts against its votes).
// Before a ward is declared nothing about its candidates leaves this file (no leader, no votes).
import { istIso } from './public-views.js';
import type { ResultStatus, WardResult } from './result.js';

/** A ward in counting with no new entry for this long is "Stalled". */
export const STALLED_AFTER_MINUTES = 30;

export const REPORT_TITLE = 'Churu District - Counting Status Report';
export const ELECTION_NAME =
  'Panchayati Raj General Election 2026 – Zila Parishad & Panchayat Samiti';

export type WardKind = 'PS' | 'ZP';
export type CountingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'DECLARED';

export const STATUS_LABEL: Readonly<Record<CountingStatus, string>> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'Counting In Progress',
  READY: 'Ready To Declare',
  DECLARED: 'Declared',
};
export const KIND_LABEL: Readonly<Record<WardKind, string>> = {
  PS: 'Panchayat Samiti',
  ZP: 'Zila Parishad',
};

// ---------------------------------------------------------------- input

export interface UserRef {
  username: string;
  role: string;
  /** The user's PS (English, as stored); PS_RO only. */
  psName: string | null;
}

export interface CountingStatusRaw {
  /** DB clock (NOW(3)) inside the same snapshot as the data. */
  asOf: Date;
  /** app_settings election date (YYYY-MM-DD) or null when not set. */
  electionDate: string | null;
  ps: { id: number; nameEnglish: string }[];
  wards: {
    id: number;
    kind: WardKind;
    wardNo: number;
    psId: number | null;
    isUnopposed: boolean;
  }[];
  booths: {
    id: number;
    psId: number;
    boothNo: number;
    name: string;
    psWardId: number;
    zpWardId: number;
  }[];
  /** Live (not voided) booth entries. */
  entries: {
    boothId: number;
    ballotFor: WardKind;
    roundNo: number;
    sheetTotal: number;
    enteredAt: Date;
    updatedAt: Date | null;
    enteredBy: UserRef;
  }[];
  postal: { wardId: number; enteredAt: Date; updatedAt: Date | null }[];
  /** zp_ward_postal_assignment: the PS whose PS_RO enters a ZP ward's postal ballots. */
  postalAssignments: { wardId: number; psId: number }[];
  /** Latest declaration version per ward. */
  declarations: { wardId: number; winnerCandidateId: number; margin: number }[];
  candidates: { id: number; name: string; partyShortName: string | null }[];
  /** Wards with candidates: the engine result, or UNAVAILABLE when its data broke a rule. */
  results: ReadonlyMap<number, WardResult | 'UNAVAILABLE'>;
}

// ---------------------------------------------------------------- output

export interface WardRow {
  wardId: number;
  kind: WardKind;
  psId: number | null;
  /** Display PS name (" PANCHAYAT SAMITI" trimmed); null for ZP wards. */
  psName: string | null;
  /** PS name exactly as stored (CSV); null for ZP wards. */
  psNameFull: string | null;
  wardNo: number;
  status: CountingStatus;
  statusLabel: string;
  unopposed: boolean;
  noCandidates: boolean;
  tieNeedsLottery: boolean;
  /** The engine refused the ward's data, a declaration no longer matches, or counts disagree. */
  checkData: boolean;
  stalled: boolean;
  /** null for an unopposed ward (no counting needed). */
  boothsDone: number | null;
  boothsTotal: number | null;
  boothsPending: number | null;
  /** Booths done %, rounded DOWN to 1 decimal; null for an unopposed ward (or no booths). */
  boothsPercent: number | null;
  /** PS wards only. A ZP ward is counted by several PS ROs, each in its own rounds: see the
   *  per-PS rows (zpPsProgress); rounds of different PS are never merged into one number. */
  latestRound: number | null;
  /** null for an unopposed ward. */
  postalDone: boolean | null;
  lastEntryAt: string | null;
  lastEntryText: string | null;
  /** Declared (or unopposed) wards only; always null before declaration. */
  winner: { name: string; party: string } | null;
  margin: number | null;
  /** Pending booth numbers, compact ("3, 7, 12–15"; ZP: grouped by PS). '' when none. */
  pendingBooths: string;
}

export type EnteredFlag = 'YES' | 'NO' | 'NA';

export interface BoothRow {
  wardId: number;
  kind: WardKind;
  boothId: number;
  /** The booth's PS (id, display name, name as stored). */
  psId: number;
  psName: string;
  psNameFull: string;
  wardNo: number;
  boothNo: number;
  boothName: string;
  /** NA = the ward is unopposed (no entry is ever made). */
  entered: EnteredFlag;
  round: number | null;
  enteredBy: string | null;
  enteredAt: string | null;
  enteredAtText: string | null;
  lastEditedAt: string | null;
  lastEditedAtText: string | null;
  totalVotes: number | null;
}

export interface KindSummary {
  wardsTotal: number;
  notStarted: number;
  inProgress: number;
  ready: number;
  /** Includes unopposed wards. */
  declared: number;
  unopposed: number;
  stalled: number;
  checkData: number;
  noCandidates: number;
  boothsDone: number;
  boothsTotal: number;
  boothsPending: number;
  /** Booths done %, rounded DOWN to 1 decimal (never shows 100 before all are done). */
  boothsPercent: number | null;
  postalDone: number;
  postalTotal: number;
  lastEntryAt: string | null;
  lastEntryText: string | null;
}

export interface PsRow {
  psId: number;
  psName: string;
  psNameFull: string;
  wardsTotal: number;
  declared: number;
  psBoothsDone: number;
  psBoothsTotal: number;
  psBoothsPending: number;
  psBoothsPercent: number | null;
  /** ZP-ballot booths located in this PS (of ZP wards that need counting). */
  zpBoothsDone: number;
  zpBoothsTotal: number;
  zpBoothsPending: number;
}

/** One contributing PS of a ZP ward (ZP-ballot booths located in that PS only). */
export interface ZpPsRow {
  psId: number;
  psName: string;
  boothsDone: number;
  boothsTotal: number;
  /** Highest round_no of THIS PS's entries in this ward (a label only, never used in any sum). */
  latestRound: number | null;
  lastEntryAt: string | null;
  lastEntryText: string | null;
}

/** The postal ballots of a ZP ward: one entry, made by the assigned PS's RO. */
export interface ZpPostalRow {
  assignedPsId: number | null;
  assignedPsName: string | null;
  /** "Assigned to SUJANGARH" / "Not assigned". */
  label: string;
  /** null for an unopposed ward (nothing to enter). */
  entered: boolean | null;
  lastEntryAt: string | null;
  lastEntryText: string | null;
}

/** A ZP ward's progress by Panchayat Samiti: THE one builder for the RO pages, the UI, PDF and CSV. */
export interface ZpWardPsProgress {
  wardId: number;
  wardNo: number;
  unopposed: boolean;
  rows: ZpPsRow[];
  postal: ZpPostalRow;
}

/** What buildZpPsProgress needs (CountingStatusRaw has all of it; RO pages read just this). */
export interface ZpPsProgressInput {
  ps: readonly { id: number; nameEnglish: string }[];
  wards: readonly { id: number; kind: WardKind; wardNo: number; isUnopposed: boolean }[];
  booths: readonly { id: number; psId: number; zpWardId: number }[];
  /** Live booth entries (only ballotFor ZP is used). */
  entries: readonly {
    boothId: number;
    ballotFor: WardKind;
    roundNo: number;
    enteredAt: Date;
    updatedAt: Date | null;
  }[];
  postal: readonly { wardId: number; enteredAt: Date; updatedAt: Date | null }[];
  postalAssignments: readonly { wardId: number; psId: number }[];
}

export interface CountingStatusReport {
  title: string;
  electionName: string;
  electionDateText: string;
  asOf: string;
  asOfText: string;
  stalledAfterMinutes: number;
  summary: Record<WardKind, KindSummary>;
  psTable: PsRow[];
  wards: WardRow[];
  booths: BoothRow[];
  /** Every ZP ward, by contributing PS (ward-no order). */
  zpPsProgress: ZpWardPsProgress[];
}

// ---------------------------------------------------------------- formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "06 Nov 2026, 04:32 PM IST" (IST is UTC+05:30, no daylight saving). */
export function istText(date: Date): string {
  const d = new Date(date.getTime() + 330 * 60_000);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${String(d.getUTCFullYear())}, ${pad2(h12)}:${pad2(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'} IST`;
}

/** "Counting date: 20 Nov 2026" or "Counting date: not set". */
export function electionDateText(date: string | null): string {
  const m = date === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return 'Counting date: not set';
  return `Counting date: ${m[3] ?? ''} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1] ?? ''}`;
}

/** 1359 -> "1,359". */
export const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** "SUJANGARH PANCHAYAT SAMITI" -> "SUJANGARH" (display only; never empty). */
export function displayPsName(stored: string): string {
  const short = stored.replace(/\s*PANCHAYAT\s+SAMITI\s*$/iu, '').trim();
  return short === '' ? stored.trim() : short;
}

/** Floor to one decimal: 99.99 -> 99.9, so 100 means every booth is done. */
export function percentDown(done: number, total: number): number | null {
  return total === 0 ? null : Math.floor((done * 1000) / total) / 10;
}

/** [1,2,3,5,7,8] -> "1–3, 5, 7–8". */
export function compactNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && (sorted[j + 1] ?? 0) === (sorted[j] ?? 0) + 1) j++;
    const a = sorted[i] ?? 0;
    const b = sorted[j] ?? 0;
    parts.push(a === b ? String(a) : `${String(a)}–${String(b)}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** "PS RO (SUJANGARH) · username", "ZP RO · username". */
export function userLabel(u: UserRef): string {
  if (u.role === 'PS_RO') return `PS RO (${displayPsName(u.psName ?? '')}) · ${u.username}`;
  if (u.role === 'ZP_RO') return `ZP RO · ${u.username}`;
  return `${u.role.replace('_', ' ')} · ${u.username}`;
}

const latest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>(
    (max, d) => (d !== null && (max === null || d.getTime() > max.getTime()) ? d : max),
    null,
  );

const ENGINE_STATUS: Readonly<Record<ResultStatus, CountingStatus>> = {
  UNOPPOSED: 'DECLARED',
  NOT_STARTED: 'NOT_STARTED',
  COUNTING: 'IN_PROGRESS',
  READY_TO_DECLARE: 'READY',
  TIE_NEEDS_LOTTERY: 'READY',
  DECLARED: 'DECLARED',
  TIE_RESOLVED: 'DECLARED',
};

/**
 * The summary of a list of ward rows (all of one kind). THE one place summary counts are made: the
 * full report and every scoped report (counting-status.scope.ts) use it.
 */
export function summarizeWards(list: readonly WardRow[]): KindSummary {
  const count = (pred: (w: WardRow) => boolean) => list.filter(pred).length;
  const sum = (pick: (w: WardRow) => number | null) => list.reduce((s, w) => s + (pick(w) ?? 0), 0);
  const boothsDone = sum((w) => w.boothsDone);
  const boothsTotal = sum((w) => w.boothsTotal);
  const lastDate = latest(
    list.map((w) => (w.lastEntryAt === null ? null : new Date(w.lastEntryAt))),
  );
  return {
    wardsTotal: list.length,
    notStarted: count((w) => w.status === 'NOT_STARTED'),
    inProgress: count((w) => w.status === 'IN_PROGRESS'),
    ready: count((w) => w.status === 'READY'),
    declared: count((w) => w.status === 'DECLARED'),
    unopposed: count((w) => w.unopposed),
    stalled: count((w) => w.stalled),
    checkData: count((w) => w.checkData),
    noCandidates: count((w) => w.noCandidates),
    boothsDone,
    boothsTotal,
    boothsPending: boothsTotal - boothsDone,
    boothsPercent: percentDown(boothsDone, boothsTotal),
    postalDone: count((w) => w.postalDone === true),
    postalTotal: count((w) => w.postalDone !== null),
    lastEntryAt: lastDate === null ? null : istIso(lastDate),
    lastEntryText: lastDate === null ? null : istText(lastDate),
  };
}

// ---------------------------------------------------------------- builder

export function buildCountingStatus(raw: CountingStatusRaw): CountingStatusReport {
  const asOfMs = raw.asOf.getTime();
  const psById = new Map(raw.ps.map((p) => [p.id, p.nameEnglish]));
  const candidates = new Map(raw.candidates.map((c) => [c.id, c]));
  const declarations = new Map(raw.declarations.map((d) => [d.wardId, d]));
  const postalByWard = new Map(raw.postal.map((p) => [p.wardId, p]));
  const entryOf = new Map(raw.entries.map((e) => [`${String(e.boothId)}:${e.ballotFor}`, e]));
  const fullPs = (id: number | null) => (id === null ? '' : (psById.get(id) ?? ''));

  const boothRows: BoothRow[] = [];
  const wardRows: WardRow[] = raw.wards.map((w) => {
    const booths = raw.booths
      .filter((b) => (w.kind === 'PS' ? b.psWardId : b.zpWardId) === w.id)
      .sort(
        (a, b) =>
          displayPsName(fullPs(a.psId)).localeCompare(displayPsName(fullPs(b.psId)), 'en') ||
          a.boothNo - b.boothNo,
      );
    const entries = booths.flatMap((b) => {
      const e = entryOf.get(`${String(b.id)}:${w.kind}`);
      return e === undefined ? [] : [e];
    });
    for (const b of booths) {
      const e = entryOf.get(`${String(b.id)}:${w.kind}`);
      const psFull = fullPs(b.psId);
      boothRows.push({
        wardId: w.id,
        kind: w.kind,
        boothId: b.id,
        psId: b.psId,
        psName: displayPsName(psFull),
        psNameFull: psFull,
        wardNo: w.wardNo,
        boothNo: b.boothNo,
        boothName: b.name,
        entered: w.isUnopposed ? 'NA' : e === undefined ? 'NO' : 'YES',
        round: e?.roundNo ?? null,
        enteredBy: e === undefined ? null : userLabel(e.enteredBy),
        enteredAt: e === undefined ? null : istIso(e.enteredAt),
        enteredAtText: e === undefined ? null : istText(e.enteredAt),
        lastEditedAt: e?.updatedAt == null ? null : istIso(e.updatedAt),
        lastEditedAtText: e?.updatedAt == null ? null : istText(e.updatedAt),
        totalVotes: e?.sheetTotal ?? null,
      });
    }

    const done = entries.length;
    const total = booths.length;
    const postal = postalByWard.get(w.id);
    const last = latest([
      ...entries.flatMap((e) => [e.enteredAt, e.updatedAt]),
      postal?.enteredAt ?? null,
      postal?.updatedAt ?? null,
    ]);
    const r = raw.results.get(w.id);
    const result = r === undefined || r === 'UNAVAILABLE' ? null : r;
    const declaration = declarations.get(w.id);

    let status: CountingStatus;
    let checkData = r === 'UNAVAILABLE';
    if (result !== null) {
      status = ENGINE_STATUS[result.status];
      // The engine and the booth list must agree; any difference is shown, never hidden.
      checkData =
        result.declarationMismatch ||
        result.boothsEntered !== done ||
        result.boothsTotal !== total ||
        result.postalEntered !== (postal !== undefined);
    } else if (w.isUnopposed) {
      status = 'DECLARED';
      checkData = true; // an unopposed ward always has its one candidate
    } else if (declaration !== undefined) {
      status = 'DECLARED';
    } else if (done === 0 && postal === undefined) {
      status = 'NOT_STARTED';
    } else if (done === total && postal !== undefined) {
      status = 'READY';
    } else {
      status = 'IN_PROGRESS';
    }
    if (r === undefined && (done > 0 || postal !== undefined)) checkData = true;

    let winnerId: number | null = null;
    let margin: number | null = null;
    if (status === 'DECLARED') {
      winnerId = result?.winnerCandidateId ?? declaration?.winnerCandidateId ?? null;
      margin = w.isUnopposed ? null : (result?.margin ?? declaration?.margin ?? null);
    }
    const winnerCandidate = winnerId === null ? undefined : candidates.get(winnerId);

    const pendingByPs = new Map<string, number[]>();
    for (const b of booths) {
      if (entryOf.has(`${String(b.id)}:${w.kind}`)) continue;
      const key = displayPsName(fullPs(b.psId));
      pendingByPs.set(key, [...(pendingByPs.get(key) ?? []), b.boothNo]);
    }
    const pendingBooths = w.isUnopposed
      ? ''
      : w.kind === 'PS'
        ? compactNumbers([...pendingByPs.values()].flat())
        : [...pendingByPs.entries()].map(([ps, nos]) => `${ps}: ${compactNumbers(nos)}`).join('; ');

    const psFull = w.kind === 'PS' ? fullPs(w.psId) : null;
    return {
      wardId: w.id,
      kind: w.kind,
      psId: w.kind === 'PS' ? w.psId : null,
      psName: psFull === null ? null : displayPsName(psFull),
      psNameFull: psFull,
      wardNo: w.wardNo,
      status,
      statusLabel: STATUS_LABEL[status],
      unopposed: w.isUnopposed,
      noCandidates: r === undefined && !w.isUnopposed,
      tieNeedsLottery: result?.status === 'TIE_NEEDS_LOTTERY',
      checkData,
      stalled:
        status === 'IN_PROGRESS' &&
        last !== null &&
        asOfMs - last.getTime() >= STALLED_AFTER_MINUTES * 60_000,
      boothsDone: w.isUnopposed ? null : done,
      boothsTotal: w.isUnopposed ? null : total,
      boothsPending: w.isUnopposed ? null : total - done,
      boothsPercent: w.isUnopposed ? null : percentDown(done, total),
      latestRound:
        w.kind === 'ZP' || entries.length === 0 ? null : Math.max(...entries.map((e) => e.roundNo)),
      postalDone: w.isUnopposed ? null : postal !== undefined,
      lastEntryAt: last === null ? null : istIso(last),
      lastEntryText: last === null ? null : istText(last),
      winner:
        winnerCandidate === undefined
          ? null
          : { name: winnerCandidate.name, party: winnerCandidate.partyShortName ?? 'Independent' },
      margin,
      pendingBooths,
    };
  });

  // Order: PS wards by PS (display name) then ward no; then ZP wards by ward no. Booths follow.
  const wardOrder = (a: WardRow, b: WardRow) =>
    (a.kind === b.kind ? 0 : a.kind === 'PS' ? -1 : 1) ||
    (a.psName ?? '').localeCompare(b.psName ?? '', 'en') ||
    a.wardNo - b.wardNo;
  wardRows.sort(wardOrder);
  const rank = new Map(wardRows.map((w, i) => [w.wardId, i]));
  boothRows.sort((a, b) => (rank.get(a.wardId) ?? 0) - (rank.get(b.wardId) ?? 0));

  const psTable: PsRow[] = raw.ps
    .map((p) => {
      const wards = wardRows.filter((w) => w.kind === 'PS' && w.psId === p.id);
      const psDone = wards.reduce((s, w) => s + (w.boothsDone ?? 0), 0);
      const psTotal = wards.reduce((s, w) => s + (w.boothsTotal ?? 0), 0);
      const zpBooths = boothRows.filter(
        (b) => b.kind === 'ZP' && b.psId === p.id && b.entered !== 'NA',
      );
      const zpDone = zpBooths.filter((b) => b.entered === 'YES').length;
      return {
        psId: p.id,
        psName: displayPsName(p.nameEnglish),
        psNameFull: p.nameEnglish,
        wardsTotal: wards.length,
        declared: wards.filter((w) => w.status === 'DECLARED').length,
        psBoothsDone: psDone,
        psBoothsTotal: psTotal,
        psBoothsPending: psTotal - psDone,
        psBoothsPercent: percentDown(psDone, psTotal),
        zpBoothsDone: zpDone,
        zpBoothsTotal: zpBooths.length,
        zpBoothsPending: zpBooths.length - zpDone,
      };
    })
    .sort((a, b) => a.psName.localeCompare(b.psName, 'en'));

  return {
    title: REPORT_TITLE,
    electionName: ELECTION_NAME,
    electionDateText: electionDateText(raw.electionDate),
    asOf: istIso(raw.asOf),
    asOfText: istText(raw.asOf),
    stalledAfterMinutes: STALLED_AFTER_MINUTES,
    summary: {
      PS: summarizeWards(wardRows.filter((w) => w.kind === 'PS')),
      ZP: summarizeWards(wardRows.filter((w) => w.kind === 'ZP')),
    },
    psTable,
    wards: wardRows,
    booths: boothRows,
    zpPsProgress: buildZpPsProgress(raw),
  };
}

const istPair = (d: Date | null) => ({
  lastEntryAt: d === null ? null : istIso(d),
  lastEntryText: d === null ? null : istText(d),
});

/**
 * Every ZP ward of the input, with one row per PS that has booths in it (booths done / total of
 * the ZP ballot, that PS's own latest round and last entry) and the postal row (assigned PS,
 * entered or pending). Counts booths and entries only; never adds votes.
 */
export function buildZpPsProgress(input: ZpPsProgressInput): ZpWardPsProgress[] {
  const psName = new Map(input.ps.map((p) => [p.id, displayPsName(p.nameEnglish)]));
  const zpEntry = new Map(
    input.entries.filter((e) => e.ballotFor === 'ZP').map((e) => [e.boothId, e]),
  );
  const postalByWard = new Map(input.postal.map((p) => [p.wardId, p]));
  const assigned = new Map(input.postalAssignments.map((a) => [a.wardId, a.psId]));

  return input.wards
    .filter((w) => w.kind === 'ZP')
    .sort((a, b) => a.wardNo - b.wardNo)
    .map((w) => {
      const byPs = new Map<
        number,
        { total: number; entries: ZpPsProgressInput['entries'][number][] }
      >();
      for (const b of input.booths) {
        if (b.zpWardId !== w.id) continue;
        const slot = byPs.get(b.psId) ?? { total: 0, entries: [] };
        slot.total++;
        const e = zpEntry.get(b.id);
        if (e !== undefined) slot.entries.push(e);
        byPs.set(b.psId, slot);
      }
      const rows: ZpPsRow[] = [...byPs.entries()]
        .map(([psId, slot]) => ({
          psId,
          psName: psName.get(psId) ?? '',
          boothsDone: slot.entries.length,
          boothsTotal: slot.total,
          latestRound:
            slot.entries.length === 0 ? null : Math.max(...slot.entries.map((e) => e.roundNo)),
          ...istPair(latest(slot.entries.flatMap((e) => [e.enteredAt, e.updatedAt]))),
        }))
        .sort((a, b) => a.psName.localeCompare(b.psName, 'en'));

      const psId = assigned.get(w.id) ?? null;
      const name = psId === null ? null : (psName.get(psId) ?? null);
      const postal = postalByWard.get(w.id);
      return {
        wardId: w.id,
        wardNo: w.wardNo,
        unopposed: w.isUnopposed,
        rows,
        postal: {
          assignedPsId: psId,
          assignedPsName: name,
          label: name === null ? 'Not assigned' : `Assigned to ${name}`,
          entered: w.isUnopposed ? null : postal !== undefined,
          ...istPair(postal === undefined ? null : latest([postal.enteredAt, postal.updatedAt])),
        },
      };
    });
}

/** Wards whose pending booths are listed in the PDF: in progress (stalled ones included). */
export const listsPendingInPdf = (w: WardRow): boolean => w.status === 'IN_PROGRESS';
