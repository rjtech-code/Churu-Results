// State Election Commission "ST. FORMAT" returns, shared by the ZP and the PS files: PURE logic from
// the DM report read. Nothing here adds votes inside a ward: every vote number of a ward comes from
// result.ts (WardResult); this file only picks the elected members, counts them, and adds ward
// totals across wards, like reports.ts does.
// Only wards with an elected member are used: DECLARED / TIE_RESOLVED, and UNOPPOSED (elected,
// without votes). A declared ward whose numbers the engine flags (declaration mismatch, or data it
// refuses) is LEFT OUT and named in the warnings. Unknown information is null (an empty cell), never
// a guess.
import {
  EDUCATIONS,
  EDUCATION_EN,
  NO_DETAILS,
  candidateAge,
} from './master-data/candidate-details.js';
import type {
  CandidateCategory,
  CandidateDetails,
  Education,
} from './master-data/candidate-details.js';
import type { ReportRaw } from './reports.js';
import type { WardResult } from './result.js';

export const DISTRICT_NAME = 'CHURU';

/** The party columns of the format; any other party is counted as IND. */
export const ST_PARTIES = [
  'AAP',
  'BSP',
  'BJP',
  'CPI(M)',
  'INC',
  'NPP',
  'RLP',
  'BAP',
  'IND',
] as const;
export type StParty = (typeof ST_PARTIES)[number];
export type StGender = 'M' | 'F' | 'TG';
export const ST_CATEGORIES = [
  'GEN',
  'SC',
  'ST',
  'OBC',
] as const satisfies readonly CandidateCategory[];

export const AGE_BUCKETS = [
  { label: 'Up to 25', min: 0, max: 25 },
  { label: '26 to 35', min: 26, max: 35 },
  { label: '36 to 50', min: 36, max: 50 },
  { label: '51 to 60', min: 51, max: 60 },
  { label: 'Above 60', min: 61, max: Number.MAX_SAFE_INTEGER },
] as const;

// ---------------------------------------------------------------- reservation text

export interface Reservation {
  category: CandidateCategory;
  women: boolean;
}

const nfc = (s: string) => s.normalize('NFC');
const squash = (s: string) =>
  nfc(s)
    .toLowerCase()
    .replace(/[\s.\-_,()[\]/]+/gu, '');
// Hindi phrases, matched with spaces and punctuation removed. ST is checked before SC (जनजाति).
const PHRASES = (
  [
    ['अनुसूचितजनजाति', 'ST'],
    ['अनुसूचितजाति', 'SC'],
    ['अन्यपिछड़ावर्ग', 'OBC'],
    ['पिछड़ावर्ग', 'OBC'],
    ['सामान्य', 'GEN'],
    ['अनारक्षित', 'GEN'],
  ] as const
).map(([p, c]): [string, CandidateCategory] => [squash(p), c]);
// Whole words (dots removed: "अ.जा." -> "अजा").
const WORDS = new Map<string, CandidateCategory>(
  (
    [
      ['sc', 'SC'],
      ['st', 'ST'],
      ['obc', 'OBC'],
      ['gen', 'GEN'],
      ['general', 'GEN'],
      ['ur', 'GEN'],
      ['unreserved', 'GEN'],
      ['अजा', 'SC'],
      ['अजजा', 'ST'],
      ['अपिव', 'OBC'],
      ['ओबीसी', 'OBC'],
    ] as const
  ).map(([w, c]) => [nfc(w), c]),
);
const WOMEN_WORDS = new Set(['w', 'women', 'woman', 'female', nfc('महिला')]);

/**
 * The ward's reservation as written on the candidate list ("अनुसूचित जाति (महिला)", "SC (W)",
 * "सामान्य", …). Null when the text is empty or does not name exactly one category.
 */
export function parseReservation(text: string | null): Reservation | null {
  if (text === null || text.trim() === '') return null;
  const words = nfc(text)
    .toLowerCase()
    .split(/[\s,()[\]/\-–]+/u)
    .map((w) => w.replaceAll('.', ''))
    .filter((w) => w !== '');
  const squashed = squash(text);
  const found = new Set<CandidateCategory>();
  let rest = squashed;
  for (const [phrase, cat] of PHRASES) {
    if (rest.includes(phrase)) {
      found.add(cat);
      rest = rest.replaceAll(phrase, ' ');
    }
  }
  for (const w of words) {
    const cat = WORDS.get(w);
    if (cat !== undefined) found.add(cat);
  }
  if (found.size !== 1) return null;
  const women = words.some((w) => WOMEN_WORDS.has(w)) || squashed.includes(nfc('महिला'));
  const [category] = [...found];
  return category === undefined ? null : { category, women };
}

/**
 * Constituency category as the format's footnote asks. ZP: "SC (W)", "UR (W)"; PS: "SC(W)", "UR(W)".
 */
export const constituencyLabel = (r: Reservation, style: 'spaced' | 'compact'): string =>
  `${r.category === 'GEN' ? 'UR' : r.category}${r.women ? (style === 'spaced' ? ' (W)' : '(W)') : ''}`;

// ---------------------------------------------------------------- output types

export interface StRival {
  name: string;
  party: StParty;
  mobile: string | null;
  votes: number;
}

/** One elected member: a row of F15 and of F18. Null = not in the system (empty cell). */
export interface StWinnerRow {
  wardNo: number;
  unopposed: boolean;
  constituencyCategory: string | null;
  name: string;
  /** "DD/MM/YYYY" from the date of birth, else the stated age, else null. */
  dobOrAge: string | number | null;
  party: StParty;
  gender: StGender;
  category: CandidateCategory | null;
  age: number | null;
  education: Education | null;
  literacy: string | null;
  mobile: string | null;
  electorate: number | null;
  /** F18 vote columns: null for an unopposed ward (no poll), polled/rejected also when unknown. */
  polled: number | null;
  rejected: number | null;
  nota: number | null;
  /** Candidates' valid votes, NOTA excluded (F18: polled - rejected - NOTA). */
  valid: number | null;
  winnerVotes: number | null;
  rival: StRival | null;
  margin: number | null;
}

export type GenderCount = Record<StGender, number>;
export type CategoryCount = Record<CandidateCategory, number>;

/** `W` identifies a ward in the warnings: its number (ZP) or "PS – Ward n" (PS). */
export interface StFormatWarnings<W = number> {
  totalWards: number;
  /** Wards with an elected member (declared + unopposed), the left-out ones included. */
  declaredWards: number;
  includedWards: number;
  unopposedWards: W[];
  excludedWards: { wardNo: W; reason: 'MISMATCH' | 'UNAVAILABLE' }[];
  /** Wards whose winner has no age / education / mobile / category. */
  missing: { age: W[]; education: W[]; mobile: W[]; category: W[] };
  /** Party short names counted in the IND columns. */
  partiesAsInd: string[];
  reservationUnknown: { wardNo: W; text: string | null }[];
  /** Contested wards without a rejected-ballot count (F18 polled and rejected empty). */
  rejectedUnknown: W[];
  /** Wards with a booth without a registered-voter count (F18 electorate empty). */
  electorateUnknown: W[];
  /** The same facts once per ward, for the panel's tables (ps: null for ZP). */
  excludedByWard: { ps: string | null; wardNo: number; reason: 'MISMATCH' | 'UNAVAILABLE' }[];
  missingByWard: { ps: string | null; wardNo: number; missing: MissingDetail[] }[];
  otherByWard: { ps: string | null; wardNo: number; blank: OtherBlank[] }[];
}

export type MissingDetail = 'AGE' | 'EDUCATION' | 'MOBILE' | 'CATEGORY';
/** F18 cells left blank for want of data: rejected votes, electorate, constituency category. */
export type OtherBlank = 'REJECTED' | 'ELECTORATE' | 'RESERVATION';

/** Valid votes by party (F14 A). */
export interface VoteShare {
  postal: number;
  evm: number;
  totalValid: number;
  votes: Record<StParty | 'NOTA', number>;
  /** Of totalValid, 2 decimals; null when there are no valid votes. */
  percent: Record<StParty | 'NOTA', number | null>;
}

/** Elected members counted by gender, category, party, age and education. */
export interface WinnerCounts {
  members: number;
  gender: { M: CategoryCount; F: CategoryCount; TG: number };
  women: {
    reserved: CategoryCount;
    reservedTotal: number;
    elected: CategoryCount;
    electedTotal: number;
  };
  /** TOTAL = every winner of the party (also those whose category is unknown). */
  partyCategory: Record<StParty, CategoryCount & { TOTAL: number }>;
  partyGender: Record<StParty, GenderCount & { TOTAL: number }>;
  /** Winners whose age is known only. */
  age: { buckets: { M: number; F: number }[]; total: GenderCount; grand: number };
  /** Winners whose education is known only. */
  education: {
    levels: Record<Education, { M: number; F: number }>;
    total: GenderCount;
    grand: number;
  };
}

/** An elected member with what the counts need. */
export interface CollectedWard {
  wardId: number;
  psId: number | null;
  row: StWinnerRow;
  reservation: Reservation | null;
  /** Null for an unopposed ward (no votes). */
  result: WardResult | null;
}

// ---------------------------------------------------------------- helpers

export function plus(a: number, b: number): number {
  const s = a + b;
  if (!Number.isSafeInteger(s)) throw new Error('ST format: a total is too large to add exactly');
  return s;
}

const zeroCats = (): CategoryCount => ({ GEN: 0, SC: 0, ST: 0, OBC: 0 });
const zeroGenders = (): GenderCount => ({ M: 0, F: 0, TG: 0 });
const byParty = <T>(make: () => T): Record<StParty, T> =>
  Object.fromEntries(ST_PARTIES.map((p) => [p, make()])) as Record<StParty, T>;

const partyKey = (s: string) => nfc(s).toUpperCase().replace(/[\s.]/g, '');
const PARTY_BY_KEY = new Map<string, StParty>(ST_PARTIES.map((p) => [partyKey(p), p]));

const dmy = (iso: string) => iso.split('-').reverse().join('/');
const stGender = (g: 'M' | 'F' | 'O' | null): StGender | null =>
  g === 'M' ? 'M' : g === 'F' ? 'F' : g === 'O' ? 'TG' : null;

/** Party -> format column; remembers the short names that went to IND. */
export function partyMapper(raw: ReportRaw): {
  stParty: (partyId: number | null) => StParty;
  asInd: Set<string>;
} {
  const shortName = new Map(raw.parties.map((p) => [p.id, p.shortName]));
  const asInd = new Set<string>();
  const stParty = (partyId: number | null): StParty => {
    if (partyId === null) return 'IND';
    const short = shortName.get(partyId) ?? '';
    const p = PARTY_BY_KEY.get(partyKey(short));
    if (p === undefined) {
      asInd.add(short);
      return 'IND';
    }
    return p;
  };
  return { stParty, asInd };
}

// ---------------------------------------------------------------- the elected members

export interface CollectOptions<W> {
  /** Which booth column ties a booth to these wards (for the electorate). */
  boothWard: 'zpWardId' | 'psWardId';
  labelStyle: 'spaced' | 'compact';
  /** How a ward is named in the warnings. */
  ref: (w: ReportRaw['wards'][number]) => W;
  /** The ward's PS name for the panel's tables (null for ZP). */
  psName: (w: ReportRaw['wards'][number]) => string | null;
}

/**
 * The elected members of `wards` (in the given order), with the warnings. `stParty` is shared so
 * the IND list covers every ward of the file.
 */
export function collectWinners<W>(
  raw: ReportRaw,
  details: ReadonlyMap<number, CandidateDetails>,
  wards: readonly ReportRaw['wards'][number][],
  stParty: (partyId: number | null) => StParty,
  opts: CollectOptions<W>,
): { collected: CollectedWard[]; warnings: StFormatWarnings<W> } {
  const candidate = new Map(raw.candidates.map((c) => [c.id, c]));
  const detailsOf = (id: number): CandidateDetails => details.get(id) ?? NO_DETAILS;
  const declaredIds = new Set(raw.declarations.map((d) => d.wardId));
  const warnings: StFormatWarnings<W> = {
    totalWards: wards.length,
    declaredWards: 0,
    includedWards: 0,
    unopposedWards: [],
    excludedWards: [],
    missing: { age: [], education: [], mobile: [], category: [] },
    partiesAsInd: [],
    reservationUnknown: [],
    rejectedUnknown: [],
    electorateUnknown: [],
    excludedByWard: [],
    missingByWard: [],
    otherByWard: [],
  };
  const collected: CollectedWard[] = [];

  for (const w of wards) {
    const ref = opts.ref(w);
    const at = { ps: opts.psName(w), wardNo: w.wardNo };
    const missing: MissingDetail[] = [];
    const blank: OtherBlank[] = [];
    const result = raw.results.get(w.id);
    if (result === undefined) continue; // no candidates
    const elected =
      result === 'UNAVAILABLE'
        ? declaredIds.has(w.id) || w.isUnopposed
        : result.status === 'DECLARED' ||
          result.status === 'TIE_RESOLVED' ||
          result.status === 'UNOPPOSED';
    if (!elected) continue;
    warnings.declaredWards++;
    if (result === 'UNAVAILABLE') {
      warnings.excludedWards.push({ wardNo: ref, reason: 'UNAVAILABLE' });
      warnings.excludedByWard.push({ ...at, reason: 'UNAVAILABLE' });
      continue;
    }
    const unopposed = result.status === 'UNOPPOSED';
    const winnerId = result.winnerCandidateId;
    const winnerResult = result.candidates.find((c) => c.id === winnerId);
    const runnerUp = result.runnerUp;
    // Defence in depth: a declared ward is used only when the engine's numbers agree with the
    // declaration (winner on top, margin = winner - nearest rival).
    const consistent =
      winnerId !== null &&
      winnerResult !== undefined &&
      !result.declarationMismatch &&
      (unopposed ||
        (runnerUp !== null &&
          result.leader?.candidateId === winnerId &&
          result.margin === winnerResult.totalVotes - runnerUp.totalVotes));
    const winner = winnerId === null ? undefined : candidate.get(winnerId);
    const gender = stGender(winner?.gender ?? null);
    if (!consistent || winner === undefined || gender === null) {
      warnings.excludedWards.push({ wardNo: ref, reason: 'MISMATCH' });
      warnings.excludedByWard.push({ ...at, reason: 'MISMATCH' });
      continue;
    }
    warnings.includedWards++;
    if (unopposed) warnings.unopposedWards.push(ref);

    const reservation = parseReservation(w.reservationCategory);
    if (reservation === null) {
      warnings.reservationUnknown.push({ wardNo: ref, text: w.reservationCategory });
      blank.push('RESERVATION');
    }

    const d = detailsOf(winner.id);
    // The candidate's own category; else a SC/ST/OBC seat's category (only such a candidate can
    // stand there); a general seat says nothing about the winner's category.
    const category =
      d.candidateCategory ??
      (reservation !== null && reservation.category !== 'GEN' ? reservation.category : null);
    const age = candidateAge(d);
    if (age === null) {
      warnings.missing.age.push(ref);
      missing.push('AGE');
    }
    if (d.education === null) {
      warnings.missing.education.push(ref);
      missing.push('EDUCATION');
    }
    if (d.mobile === null) {
      warnings.missing.mobile.push(ref);
      missing.push('MOBILE');
    }
    if (category === null) {
      warnings.missing.category.push(ref);
      missing.push('CATEGORY');
    }

    const booths = raw.booths.filter((b) => b[opts.boothWard] === w.id);
    let electorate: number | null = booths.length === 0 ? null : 0;
    for (const b of booths) {
      electorate =
        electorate === null || b.registeredVoters === null
          ? null
          : plus(electorate, b.registeredVoters);
    }
    if (electorate === null) {
      warnings.electorateUnknown.push(ref);
      blank.push('ELECTORATE');
    }

    const row: StWinnerRow = {
      wardNo: w.wardNo,
      unopposed,
      constituencyCategory:
        reservation === null ? null : constituencyLabel(reservation, opts.labelStyle),
      name: winner.name,
      dobOrAge: d.dob !== null ? dmy(d.dob) : d.ageStated,
      party: stParty(winner.partyId),
      gender,
      category,
      age,
      education: d.education,
      literacy: d.education === null ? null : EDUCATION_EN[d.education],
      mobile: d.mobile,
      electorate,
      polled: null,
      rejected: null,
      nota: null,
      valid: null,
      winnerVotes: null,
      rival: null,
      margin: null,
    };

    if (!unopposed) {
      const rejected = result.rejectedPostal;
      if (rejected === null) {
        warnings.rejectedUnknown.push(ref);
        blank.push('REJECTED');
      }
      const rival = runnerUp === null ? undefined : candidate.get(runnerUp.candidateId);
      row.rejected = rejected;
      row.polled = rejected === null ? null : plus(result.totalValidVotes, rejected);
      row.nota = result.notaVotes;
      row.valid = result.totalValidVotes - result.notaVotes;
      row.winnerVotes = winnerResult.totalVotes;
      row.margin = result.margin;
      if (rival !== undefined && runnerUp !== null) {
        row.rival = {
          name: rival.name,
          party: stParty(rival.partyId),
          mobile: detailsOf(rival.id).mobile,
          votes: runnerUp.totalVotes,
        };
      }
    }
    if (missing.length > 0) warnings.missingByWard.push({ ...at, missing });
    if (blank.length > 0) warnings.otherByWard.push({ ...at, blank });
    collected.push({
      wardId: w.id,
      psId: w.panchayatSamitiId,
      row,
      reservation,
      result: unopposed ? null : result,
    });
  }
  return { collected, warnings };
}

// ---------------------------------------------------------------- totals

/** F14 (A): total valid = sum of the party columns (NOTA included) = postal + EVM. */
export function voteShare(
  collected: readonly CollectedWard[],
  stParty: (partyId: number | null) => StParty,
): VoteShare {
  const votes = Object.fromEntries([...ST_PARTIES, 'NOTA'].map((p) => [p, 0])) as Record<
    StParty | 'NOTA',
    number
  >;
  let postal = 0;
  let evm = 0;
  let engineValid = 0;
  for (const { result } of collected) {
    if (result === null) continue;
    for (const c of result.candidates) {
      const col = c.isNota ? 'NOTA' : stParty(c.partyId);
      votes[col] = plus(votes[col], c.totalVotes);
      postal = plus(postal, c.postalVotes);
      evm = plus(evm, c.boothVotes);
    }
    engineValid = plus(engineValid, result.totalValidVotes);
  }
  const totalValid = [...ST_PARTIES, 'NOTA' as const].reduce((s, p) => plus(s, votes[p]), 0);
  if (totalValid !== plus(postal, evm) || totalValid !== engineValid) {
    throw new Error('ST format: F14 totals do not agree with the result engine');
  }
  const percent = Object.fromEntries(
    [...ST_PARTIES, 'NOTA'].map((p) => [
      p,
      totalValid === 0 ? null : Math.round((votes[p as StParty] / totalValid) * 10000) / 100,
    ]),
  ) as Record<StParty | 'NOTA', number | null>;
  return { postal, evm, totalValid, votes, percent };
}

export function winnerCounts(collected: readonly CollectedWard[]): WinnerCounts {
  const gender = { M: zeroCats(), F: zeroCats(), TG: 0 };
  const women = { reserved: zeroCats(), reservedTotal: 0, elected: zeroCats(), electedTotal: 0 };
  const partyCategory = byParty(() => ({ ...zeroCats(), TOTAL: 0 }));
  const partyGender = byParty(() => ({ ...zeroGenders(), TOTAL: 0 }));
  const age = { buckets: AGE_BUCKETS.map(() => ({ M: 0, F: 0 })), total: zeroGenders(), grand: 0 };
  const education = {
    levels: Object.fromEntries(EDUCATIONS.map((e) => [e, { M: 0, F: 0 }])) as Record<
      Education,
      { M: number; F: number }
    >,
    total: zeroGenders(),
    grand: 0,
  };
  for (const { row: w, reservation: r } of collected) {
    if (r?.women) {
      women.reserved[r.category]++;
      women.reservedTotal++;
    }
    if (w.gender === 'TG') gender.TG++;
    else if (w.category !== null) gender[w.gender][w.category]++;
    if (w.gender === 'F') {
      women.electedTotal++;
      if (w.category !== null) women.elected[w.category]++;
    }
    partyCategory[w.party].TOTAL++;
    if (w.category !== null) partyCategory[w.party][w.category]++;
    partyGender[w.party][w.gender]++;
    partyGender[w.party].TOTAL++;
    if (w.age !== null) {
      const a = w.age;
      const bucket = age.buckets[AGE_BUCKETS.findIndex((b) => a >= b.min && a <= b.max)];
      if (w.gender !== 'TG' && bucket !== undefined) bucket[w.gender]++;
      age.total[w.gender]++;
      age.grand++;
    }
    if (w.education !== null) {
      if (w.gender !== 'TG') education.levels[w.education][w.gender]++;
      education.total[w.gender]++;
      education.grand++;
    }
  }
  return { members: collected.length, gender, women, partyCategory, partyGender, age, education };
}
