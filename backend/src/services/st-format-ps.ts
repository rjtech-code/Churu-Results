// PS ST Format (Panchayat Samiti members, F14A-F19A): per-PS rows, one district row and the TOTAL
// rows, for all PS or one PS. The shared rules (who is elected, what is left out, unknown = empty)
// are in st-format-common.ts. Votes come from the result engine only.
import type { CandidateDetails } from './master-data/candidate-details.js';
import type { ReportRaw } from './reports.js';
import { collectWinners, partyMapper, voteShare, winnerCounts } from './st-format-common.js';
import type {
  CollectedWard,
  StFormatWarnings,
  StWinnerRow,
  VoteShare,
  WinnerCounts,
} from './st-format-common.js';

export interface PsName {
  id: number;
  nameEnglish: string;
}

export interface StPsRow {
  psId: number;
  psName: string;
  /** Every PS ward of this PS (declared or not). */
  totalWards: number;
  share: VoteShare;
  counts: WinnerCounts;
}

export type StPsWarnings = StFormatWarnings<string> & {
  /** PS (in scope) without any elected member yet: not in "TOTAL NO. OF PANCHAYAT SAMITI". */
  psWithoutMembers: string[];
};

export interface StFormatPs {
  /** null = all PS. */
  psId: number | null;
  /** In PS id order. */
  ps: StPsRow[];
  /** ST.F.16 / F16 (B): PS with at least one elected member (one PS: 1), all their wards. */
  district: { psCount: number; totalWards: number; counts: WinnerCounts };
  /** TOTAL rows of the PS-wise sheets: every PS row added up. */
  total: { totalWards: number; counts: WinnerCounts };
  /** F15 / F18 rows: by PS, then ward number. */
  winners: (StWinnerRow & { psName: string })[];
  warnings: StPsWarnings;
}

/** "CHURU - Ward 5" */
export const psWardRef = (psName: string, wardNo: number) => `${psName} - Ward ${String(wardNo)}`;

/** `psId` null = every PS of the district; otherwise only that PS (it must be in `psNames`). */
export function buildStFormatPs(
  raw: ReportRaw,
  details: ReadonlyMap<number, CandidateDetails>,
  psNames: readonly PsName[],
  psId: number | null,
): StFormatPs {
  const scope = [...psNames]
    .filter((p) => psId === null || p.id === psId)
    .sort((a, b) => a.id - b.id);
  if (psId !== null && scope.length !== 1) throw new Error(`ST format: unknown PS ${String(psId)}`);
  const nameOf = new Map(scope.map((p) => [p.id, p.nameEnglish]));
  const wards = raw.wards
    .filter(
      (w) => w.kind === 'PS' && w.panchayatSamitiId !== null && nameOf.has(w.panchayatSamitiId),
    )
    .sort((a, b) => (a.panchayatSamitiId ?? 0) - (b.panchayatSamitiId ?? 0) || a.wardNo - b.wardNo);

  const { stParty, asInd } = partyMapper(raw);
  const { collected, warnings } = collectWinners(raw, details, wards, stParty, {
    boothWard: 'psWardId',
    labelStyle: 'compact',
    ref: (w) => psWardRef(nameOf.get(w.panchayatSamitiId ?? 0) ?? '', w.wardNo),
    psName: (w) => nameOf.get(w.panchayatSamitiId ?? 0) ?? '',
  });

  const byPs = new Map<number, CollectedWard[]>();
  for (const c of collected) {
    const list = byPs.get(c.psId ?? 0) ?? [];
    list.push(c);
    byPs.set(c.psId ?? 0, list);
  }
  const ps: StPsRow[] = scope.map((p) => {
    const mine = byPs.get(p.id) ?? [];
    return {
      psId: p.id,
      psName: p.nameEnglish,
      totalWards: wards.filter((w) => w.panchayatSamitiId === p.id).length,
      share: voteShare(mine, stParty),
      counts: winnerCounts(mine),
    };
  });
  const withMembers = ps.filter((p) => p.counts.members > 0);
  const allCounts = winnerCounts(collected);

  warnings.partiesAsInd = [...asInd].sort();
  return {
    psId,
    ps,
    district: {
      psCount: psId === null ? withMembers.length : 1,
      totalWards: wards.length,
      counts: allCounts,
    },
    total: { totalWards: wards.length, counts: allCounts },
    winners: collected.map((c) => ({ ...c.row, psName: nameOf.get(c.psId ?? 0) ?? '' })),
    warnings: {
      ...warnings,
      psWithoutMembers: ps.filter((p) => p.counts.members === 0).map((p) => p.psName),
    },
  };
}
