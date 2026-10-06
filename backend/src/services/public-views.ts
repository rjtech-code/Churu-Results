// Pure builders: engine results + ward/party data -> what the public media-room screens show.
// Only WARD-LEVEL facts are copied. Nothing here adds votes (that is result.ts) and nothing here
// may ever copy officer names, usernames, ids of entries, voter counts, lottery notes or alarms.
import type { ResultStatus, WardResult } from './result.js';

export type PublicStatus = ResultStatus | 'NO_CANDIDATES' | 'UNAVAILABLE';

export interface PartyRef {
  shortName: string;
  nameHindi: string;
}

export interface WardCard {
  wardId: number;
  wardNo: number;
  status: PublicStatus;
  boothsEntered: number;
  boothsTotal: number;
  latestRound: number | null;
  postalEntered: boolean;
  top3: {
    name: string;
    party: PartyRef | null;
    votes: number;
    rank: number;
    tiedWithPrevious: boolean;
  }[];
  margin: number | null;
  topTied: boolean;
  notaVotes: number;
  winner: { name: string; party: PartyRef | null } | null;
  declarationVersion: number | null;
  isCorrected: boolean;
  isUnopposed: boolean;
  reservationCategory: string | null;
}

export interface Summary {
  wardsTotal: number;
  declared: number;
  unopposed: number;
  counting: number;
  notStarted: number;
}

export interface SeatRow {
  party: { shortName: string | null; nameHindi: string };
  won: number;
  leading: number;
  total: number;
}

/** Facts about a ward that are not results. */
export interface WardMeta {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  panchayatSamitiId: number | null;
  reservationCategory: string | null;
  isUnopposed: boolean;
  boothCount: number;
}

export interface CandidateRef {
  name: string;
  partyId: number | null;
}

export const INDEPENDENT_HINDI = 'निर्दलीय';

const WINNER_STATUSES = new Set<PublicStatus>(['DECLARED', 'TIE_RESOLVED', 'UNOPPOSED']);
const LEADING_STATUSES = new Set<PublicStatus>(['COUNTING', 'READY_TO_DECLARE']);

export function partyRef(
  partyId: number | null,
  parties: ReadonlyMap<number, PartyRef>,
): PartyRef | null {
  return partyId === null ? null : (parties.get(partyId) ?? null);
}

/**
 * One ward's public card. `result` is null when the ward has no candidates yet or when the engine
 * rejected its data (then `status` says which; no numbers are shown).
 */
export function wardCard(
  meta: WardMeta,
  result: WardResult | null,
  status: PublicStatus,
  candidates: ReadonlyMap<number, CandidateRef>,
  parties: ReadonlyMap<number, PartyRef>,
): WardCard {
  const person = (id: number) => {
    const c = candidates.get(id);
    return { name: c?.name ?? '', party: partyRef(c?.partyId ?? null, parties) };
  };
  const counted = result !== null && status !== 'NOT_STARTED';
  const roundsSeen = result?.roundsSeen ?? [];
  const winnerId = result !== null && WINNER_STATUSES.has(status) ? result.winnerCandidateId : null;
  return {
    wardId: meta.id,
    wardNo: meta.wardNo,
    status,
    boothsEntered: result?.boothsEntered ?? 0,
    boothsTotal: result?.boothsTotal ?? meta.boothCount,
    latestRound: roundsSeen.length > 0 ? Math.max(...roundsSeen) : null,
    postalEntered: result?.postalEntered ?? false,
    // No leader is shown before counting starts.
    top3: counted
      ? result.top3.map((t) => ({
          ...person(t.candidateId),
          votes: t.totalVotes,
          rank: t.rank,
          tiedWithPrevious: t.tiedWithPrevious,
        }))
      : [],
    margin: counted ? result.margin : null,
    topTied: counted ? result.topTied : false,
    notaVotes: counted ? result.notaVotes : 0,
    winner: winnerId === null ? null : person(winnerId),
    declarationVersion: result?.declaration?.version ?? null,
    isCorrected: (result?.declaration?.version ?? 1) > 1,
    isUnopposed: meta.isUnopposed,
    reservationCategory: meta.reservationCategory,
  };
}

export function summarize(cards: readonly WardCard[]): Summary {
  const summary: Summary = {
    wardsTotal: cards.length,
    declared: 0,
    unopposed: 0,
    counting: 0,
    notStarted: 0,
  };
  for (const c of cards) {
    if (c.status === 'DECLARED' || c.status === 'TIE_RESOLVED') summary.declared++;
    else if (c.status === 'UNOPPOSED') summary.unopposed++;
    else if (
      c.status === 'COUNTING' ||
      c.status === 'READY_TO_DECLARE' ||
      c.status === 'TIE_NEEDS_LOTTERY'
    ) {
      summary.counting++;
    } else summary.notStarted++; // NOT_STARTED, NO_CANDIDATES, UNAVAILABLE
  }
  return summary;
}

/** Who is ahead or has won, for the "recent" list (null while tied or not started). */
export function leaderOrWinner(card: WardCard): { name: string; party: PartyRef | null } | null {
  if (card.winner !== null) return card.winner;
  const first = card.top3[0];
  if (LEADING_STATUSES.has(card.status) && !card.topTied && first !== undefined) {
    return { name: first.name, party: first.party };
  }
  return null;
}

/**
 * Seats per party: won = DECLARED + TIE_RESOLVED + UNOPPOSED; leading = the (not tied) leader of a
 * COUNTING / READY_TO_DECLARE ward; total = won + leading. Independents are grouped.
 */
export function partySeats(cards: readonly WardCard[]): SeatRow[] {
  const rows = new Map<string, SeatRow>();
  const row = (party: PartyRef | null): SeatRow => {
    const key = party?.shortName ?? '\u0000independent';
    let r = rows.get(key);
    if (!r) {
      r = {
        party: party === null ? { shortName: null, nameHindi: INDEPENDENT_HINDI } : { ...party },
        won: 0,
        leading: 0,
        total: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const card of cards) {
    if (card.winner !== null) {
      const r = row(card.winner.party);
      r.won++;
      r.total++;
      continue;
    }
    const leader = leaderOrWinner(card);
    if (leader !== null) {
      const r = row(leader.party);
      r.leading++;
      r.total++;
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.won - a.won || b.leading - a.leading || a.party.nameHindi.localeCompare(b.party.nameHindi),
  );
}

/** ISO time in IST, e.g. 2026-11-20T10:15:02.123+05:30. */
export function istIso(date: Date): string {
  return `${new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 23)}+05:30`;
}
