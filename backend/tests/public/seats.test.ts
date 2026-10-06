import { describe, expect, it } from 'vitest';
import { INDEPENDENT_HINDI, partySeats, summarize } from '../../src/services/public-views.js';
import type { PublicStatus, WardCard } from '../../src/services/public-views.js';

const P1 = { shortName: 'P1', nameHindi: 'दल एक' };
const P2 = { shortName: 'P2', nameHindi: 'दल दो' };

function card(
  status: PublicStatus,
  opts: { winner?: typeof P1 | null; leader?: typeof P1 | null; tied?: boolean } = {},
): WardCard {
  const leaderParty = opts.leader === undefined ? null : opts.leader;
  return {
    wardId: 1,
    wardNo: 1,
    status,
    boothsEntered: 1,
    boothsTotal: 1,
    latestRound: 1,
    postalEntered: false,
    top3:
      status === 'NOT_STARTED'
        ? []
        : [
            {
              candidateId: 1,
              name: 'x',
              party: leaderParty,
              votes: 5,
              rank: 1,
              tiedWithPrevious: false,
            },
          ],
    margin: 1,
    topTied: opts.tied ?? false,
    notaVotes: 0,
    winner: opts.winner === undefined ? null : { candidateId: 2, name: 'w', party: opts.winner },
    declarationVersion: null,
    isCorrected: false,
    isUnopposed: status === 'UNOPPOSED',
    reservationCategory: null,
  };
}

describe('party seats (pie chart)', () => {
  it('won = declared + tie-resolved + unopposed; leading = untied leader of a counting ward; total = won + leading', () => {
    const rows = partySeats([
      card('DECLARED', { winner: P1 }),
      card('TIE_RESOLVED', { winner: P1 }),
      card('UNOPPOSED', { winner: P2 }),
      card('COUNTING', { leader: P2 }),
      card('READY_TO_DECLARE', { leader: P1 }),
      card('COUNTING', { leader: P1, tied: true }), // tied: nobody is "leading"
      card('TIE_NEEDS_LOTTERY', { leader: P2, tied: true }),
      card('NOT_STARTED', { leader: P1 }),
      card('NO_CANDIDATES'),
      card('UNAVAILABLE'),
    ]);
    expect(rows).toEqual([
      { party: { shortName: 'P1', nameHindi: 'दल एक' }, won: 2, leading: 1, total: 3 },
      { party: { shortName: 'P2', nameHindi: 'दल दो' }, won: 1, leading: 1, total: 2 },
    ]);
  });

  it('independents (no party) are grouped as निर्दलीय', () => {
    const rows = partySeats([
      card('DECLARED', { winner: null }),
      card('COUNTING', { leader: null }),
      card('UNOPPOSED', { winner: null }),
    ]);
    expect(rows).toEqual([
      { party: { shortName: null, nameHindi: INDEPENDENT_HINDI }, won: 2, leading: 1, total: 3 },
    ]);
  });

  it('summary counts every status in exactly one bucket', () => {
    const statuses: PublicStatus[] = [
      'DECLARED',
      'TIE_RESOLVED',
      'UNOPPOSED',
      'COUNTING',
      'READY_TO_DECLARE',
      'TIE_NEEDS_LOTTERY',
      'NOT_STARTED',
      'NO_CANDIDATES',
      'UNAVAILABLE',
    ];
    expect(summarize(statuses.map((s) => card(s)))).toEqual({
      wardsTotal: 9,
      declared: 2,
      unopposed: 1,
      counting: 3,
      notStarted: 3,
    });
  });
});
