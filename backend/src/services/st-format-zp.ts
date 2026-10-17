// ZP ST Format (Zila Parishad members, F14A-F19A): the district's ZP wards, one sheet set. The
// shared rules (who is elected, what is left out, unknown = empty) are in st-format-common.ts.
import type { CandidateDetails } from './master-data/candidate-details.js';
import type { ReportRaw } from './reports.js';
import { collectWinners, partyMapper, voteShare, winnerCounts } from './st-format-common.js';
import type {
  CategoryCount,
  GenderCount,
  StFormatWarnings,
  StParty,
  StWinnerRow,
  VoteShare,
} from './st-format-common.js';
import type { Education } from './master-data/candidate-details.js';

export {
  AGE_BUCKETS,
  DISTRICT_NAME,
  ST_CATEGORIES,
  ST_PARTIES,
  constituencyLabel,
  parseReservation,
} from './st-format-common.js';
export type {
  CategoryCount,
  GenderCount,
  Reservation,
  StFormatWarnings,
  StGender,
  StParty,
  StRival,
  StWinnerRow,
} from './st-format-common.js';

export interface StFormatZp {
  totalWards: number;
  /** By ward number. */
  winners: StWinnerRow[];
  f14: VoteShare;
  f16: { M: CategoryCount; F: CategoryCount; TG: number };
  f16a: {
    reserved: CategoryCount;
    reservedTotal: number;
    elected: CategoryCount;
    electedTotal: number;
  };
  /** TOTAL = every winner of the party (also those whose category is unknown). */
  f17: Record<StParty, CategoryCount & { TOTAL: number }>;
  f17a: Record<StParty, GenderCount & { TOTAL: number }>;
  /** Winners whose age is known only. */
  f19: { buckets: { M: number; F: number }[]; total: GenderCount; grand: number };
  /** Winners whose education is known only. */
  f19a: { levels: Record<Education, { M: number; F: number }>; total: GenderCount; grand: number };
  warnings: StFormatWarnings;
}

export function buildStFormatZp(
  raw: ReportRaw,
  details: ReadonlyMap<number, CandidateDetails>,
): StFormatZp {
  const { stParty, asInd } = partyMapper(raw);
  const zpWards = raw.wards.filter((w) => w.kind === 'ZP').sort((a, b) => a.wardNo - b.wardNo);
  const { collected, warnings } = collectWinners(raw, details, zpWards, stParty, {
    boothWard: 'zpWardId',
    labelStyle: 'spaced',
    ref: (w) => w.wardNo,
    psName: () => null,
  });
  const f14 = voteShare(collected, stParty);
  const c = winnerCounts(collected);
  warnings.partiesAsInd = [...asInd].sort();
  return {
    totalWards: zpWards.length,
    winners: collected.map((x) => x.row),
    f14,
    f16: c.gender,
    f16a: c.women,
    f17: c.partyCategory,
    f17a: c.partyGender,
    f19: c.age,
    f19a: c.education,
    warnings,
  };
}
