import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildDeclarationSnapshot, computeWardResult } from '../../src/services/result.js';
import type {
  BoothEntryInput,
  ResultCandidateInput,
  WardResultInput,
} from '../../src/services/result.js';
import { shuffleInput } from './fixtures.js';

// Votes: often tiny (so ties and zeros are common), sometimes large.
const voteArb = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 5_000 }));

/** Random valid ward input: 1-12 real candidates (1 = unopposed), optional NOTA, 1-15 booths. */
const wardArb: fc.Arbitrary<WardResultInput> = fc.integer({ min: 1, max: 12 }).chain((nReal) =>
  fc
    .record({
      withNota: fc.boolean(),
      boothCount: fc.integer({ min: 1, max: 15 }),
      ids: fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), {
        minLength: nReal + 1,
        maxLength: nReal + 1,
      }),
      positions: fc.shuffledSubarray(
        [...Array(nReal + 1).keys()].map((i) => i + 1),
        {
          minLength: nReal + 1,
          maxLength: nReal + 1,
        },
      ),
    })
    .chain(({ withNota, boothCount, ids, positions }) => {
      const unopposed = nReal === 1;
      const nCand = unopposed ? 1 : nReal + (withNota ? 1 : 0);
      const candidates: ResultCandidateInput[] = Array.from({ length: nCand }, (_, i) => ({
        id: ids[i] ?? 0,
        ballotPosition: positions[i] ?? 0,
        nameHindi: `उम्मीदवार ${i}`,
        partyId: null,
        isNota: !unopposed && withNota && i === nCand - 1,
      }));
      const boothIds = Array.from({ length: boothCount }, (_, i) => 1_000 + i * 7);
      const ward = { id: 1, kind: 'PS' as const, isUnopposed: unopposed, boothIds };
      if (unopposed) {
        return fc.constant<WardResultInput>({
          ward,
          candidates,
          boothEntries: [],
          postalEntry: null,
          latestDeclaration: null,
        });
      }
      return fc
        .record({
          entered: fc.array(fc.boolean(), { minLength: boothCount, maxLength: boothCount }),
          votes: fc.array(fc.array(voteArb, { minLength: nCand, maxLength: nCand }), {
            minLength: boothCount,
            maxLength: boothCount,
          }),
          rounds: fc.array(fc.integer({ min: 1, max: 20 }), {
            minLength: boothCount,
            maxLength: boothCount,
          }),
          postal: fc.option(fc.array(voteArb, { minLength: nCand, maxLength: nCand }), {
            nil: null,
          }),
          rejected: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        })
        .map(({ entered, votes, rounds, postal, rejected }): WardResultInput => {
          const toRows = (vs: number[]) =>
            candidates.map((c, i) => ({ candidateId: c.id, votes: vs[i] ?? 0 }));
          const boothEntries: BoothEntryInput[] = boothIds.flatMap((boothId, b) => {
            if (!entered[b]) return [];
            const vs = votes[b] ?? [];
            return [
              {
                boothId,
                roundNo: rounds[b] ?? 1,
                sheetTotal: vs.reduce((s, v) => s + v, 0),
                votes: toRows(vs),
              },
            ];
          });
          return {
            ward,
            candidates,
            boothEntries,
            postalEntry:
              postal === null
                ? null
                : {
                    sheetTotal: postal.reduce((s, v) => s + v, 0),
                    rejectedCount: rejected,
                    votes: toRows(postal),
                  },
            latestDeclaration: null,
          };
        });
    }),
);

const RUNS = { numRuns: 600 };

describe('result engine — properties', () => {
  it('never throws on valid input', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        computeWardResult(input);
      }),
      RUNS,
    );
  });

  it('totalValidVotes = sum of candidate totals = sum of sheet totals (+ postal sheet total)', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        const r = computeWardResult(input);
        const byCandidates = r.candidates.reduce((s, c) => s + c.totalVotes, 0);
        const bySheets =
          input.boothEntries.reduce((s, e) => s + e.sheetTotal, 0) +
          (input.postalEntry?.sheetTotal ?? 0);
        expect(r.totalValidVotes).toBe(byCandidates);
        expect(r.totalValidVotes).toBe(bySheets);
        for (const c of r.candidates) expect(c.totalVotes).toBe(c.boothVotes + c.postalVotes);
      }),
      RUNS,
    );
  });

  it('NOTA is never leader, runner-up or in top3, and never ranked', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        const r = computeWardResult(input);
        const notaIds = new Set(r.candidates.filter((c) => c.isNota).map((c) => c.id));
        expect(r.top3.some((t) => notaIds.has(t.candidateId))).toBe(false);
        expect(notaIds.has(r.leader?.candidateId ?? -1)).toBe(false);
        expect(notaIds.has(r.runnerUp?.candidateId ?? -1)).toBe(false);
        for (const c of r.candidates) expect(c.rank === null).toBe(c.isNota);
      }),
      RUNS,
    );
  });

  it('margin is never negative, and margin = 0 exactly when the top is tied', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        const r = computeWardResult(input);
        if (r.margin === null) {
          expect(r.topTied).toBe(false);
          expect(r.runnerUp).toBeNull();
        } else {
          expect(r.margin).toBeGreaterThanOrEqual(0);
          expect(r.margin === 0).toBe(r.topTied);
        }
      }),
      RUNS,
    );
  });

  it('rank 1 always has the maximum real-candidate votes; ranks are competition ranks', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        const r = computeWardResult(input);
        const real = r.candidates.filter((c) => !c.isNota);
        const max = Math.max(...real.map((c) => c.totalVotes));
        for (const c of real) {
          expect(c.rank === 1).toBe(c.totalVotes === max);
          expect(c.rank).toBe(1 + real.filter((o) => o.totalVotes > c.totalVotes).length);
        }
        expect(r.leader?.totalVotes).toBe(max);
        expect(r.top3.length).toBe(Math.min(3, real.length));
      }),
      RUNS,
    );
  });

  it('the output never depends on input order', () => {
    fc.assert(
      fc.property(wardArb, fc.integer({ min: 1, max: 2 ** 31 - 1 }), (input, seed) => {
        expect(computeWardResult(shuffleInput(input, seed))).toEqual(computeWardResult(input));
      }),
      RUNS,
    );
  });

  it('the status is consistent with what was entered', () => {
    fc.assert(
      fc.property(wardArb, (input) => {
        const r = computeWardResult(input);
        const complete = r.boothsEntered === r.boothsTotal && r.postalEntered;
        if (input.ward.isUnopposed) expect(r.status).toBe('UNOPPOSED');
        else if (r.boothsEntered === 0 && !r.postalEntered) expect(r.status).toBe('NOT_STARTED');
        else if (!complete) expect(r.status).toBe('COUNTING');
        else expect(r.status).toBe(r.topTied ? 'TIE_NEEDS_LOTTERY' : 'READY_TO_DECLARE');
        expect(r.winnerCandidateId === null).toBe(r.status !== 'UNOPPOSED');
      }),
      RUNS,
    );
  });

  it('declared wards: leader and top3[0] are always the declared winner; ranks stay competition ranks', () => {
    const contested = wardArb.filter((input) => !input.ward.isUnopposed);
    fc.assert(
      fc.property(contested, fc.nat(), (input, pick) => {
        const counted = computeWardResult(input);
        // A valid declaration: the leader, or (for a tie) any of the top-tied candidates by lottery.
        const topVotes = counted.leader?.totalVotes;
        const tied = counted.candidates.filter((c) => !c.isNota && c.totalVotes === topVotes);
        const winner = tied[pick % tied.length];
        if (winner === undefined) throw new Error('no top candidate');
        const status = counted.topTied ? 'TIE_RESOLVED' : 'DECLARED';
        const r = computeWardResult({
          ...input,
          latestDeclaration: {
            version: 1,
            status,
            winnerCandidateId: winner.id,
            margin: counted.margin ?? 0,
            snapshot: buildDeclarationSnapshot(counted),
          },
        });
        expect(r.status).toBe(status);
        expect(r.declarationMismatch).toBe(false);
        expect(r.leader?.candidateId).toBe(r.winnerCandidateId);
        expect(r.top3[0]?.candidateId).toBe(winner.id);
        // Only the order of equal-vote rows changes: same ranks and the same vote sequence.
        expect(r.candidates.map((c) => c.rank)).toEqual(counted.candidates.map((c) => c.rank));
        expect(r.top3.map((t) => t.totalVotes)).toEqual(counted.top3.map((t) => t.totalVotes));
        expect(r.runnerUp?.candidateId).toBe(r.top3[1]?.candidateId);
      }),
      RUNS,
    );
  });

  it('a declared winner who is not top-voted always raises declarationMismatch', () => {
    const contested = wardArb.filter((input) => !input.ward.isUnopposed);
    fc.assert(
      fc.property(contested, fc.nat(), (input, pick) => {
        const counted = computeWardResult(input);
        const real = counted.candidates.filter((c) => !c.isNota);
        const winner = real[pick % real.length];
        if (winner === undefined) throw new Error('no candidate');
        const r = computeWardResult({
          ...input,
          latestDeclaration: {
            version: 1,
            status: 'DECLARED',
            winnerCandidateId: winner.id,
            margin: 1,
            snapshot: buildDeclarationSnapshot(counted),
          },
        });
        const isTop = winner.totalVotes === counted.leader?.totalVotes;
        expect(r.declarationMismatch).toBe(!isTop);
        expect(r.leader?.candidateId === winner.id).toBe(isTop);
      }),
      RUNS,
    );
  });
});
