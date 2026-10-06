import { describe, expect, it } from 'vitest';
import {
  ResultInputError,
  buildDeclarationSnapshot,
  computeWardResult,
  expectedPostalVoteSum,
} from '../../src/services/result.js';
import type { WardResult, WardResultInput } from '../../src/services/result.js';
import {
  A,
  B,
  C,
  N,
  booth,
  cand,
  declaration,
  nota,
  postal,
  shuffleInput,
  wardInput,
} from './fixtures.js';

const result = (over: Parameters<typeof wardInput>[0] = {}) => computeWardResult(wardInput(over));

/** Three full booths + postal: A=60, B=40, C=10, NOTA=5. */
const fullEntries = () => ({
  boothEntries: [
    booth(1, { [A]: 20, [B]: 15, [C]: 5, [N]: 2 }),
    booth(2, { [A]: 25, [B]: 10, [C]: 3, [N]: 1 }, 2),
    booth(3, { [A]: 10, [B]: 10, [C]: 2, [N]: 2 }, 2),
  ],
  postalEntry: postal({ [A]: 5, [B]: 5, [C]: 0, [N]: 0 }, 3),
});

const ids = (rows: { candidateId: number }[]) => rows.map((r) => r.candidateId);
const totals = (r: WardResult) => Object.fromEntries(r.candidates.map((c) => [c.id, c.totalVotes]));
const ranks = (r: WardResult) => Object.fromEntries(r.candidates.map((c) => [c.id, c.rank]));

describe('result engine — cases', () => {
  it('1. normal win: totals, margin, READY_TO_DECLARE', () => {
    const r = result(fullEntries());
    expect(totals(r)).toEqual({ [A]: 60, [B]: 40, [C]: 10, [N]: 5 });
    expect(r.candidates.map((c) => [c.id, c.boothVotes, c.postalVotes])).toEqual([
      [A, 55, 5],
      [B, 35, 5],
      [C, 10, 0],
      [N, 5, 0],
    ]);
    expect(r).toMatchObject({
      status: 'READY_TO_DECLARE',
      margin: 20,
      topTied: false,
      notaVotes: 5,
      totalValidVotes: 115,
      rejectedPostal: 3,
      boothsTotal: 3,
      boothsEntered: 3,
      postalEntered: true,
      roundsSeen: [1, 2],
      winnerCandidateId: null,
      declaration: null,
      declarationMismatch: false,
      notaHighest: false,
    });
    expect(ranks(r)).toEqual({ [A]: 1, [B]: 2, [C]: 3, [N]: null });
    expect(r.leader).toMatchObject({
      candidateId: A,
      totalVotes: 60,
      rank: 1,
      tiedWithPrevious: false,
    });
    expect(r.runnerUp).toMatchObject({ candidateId: B, totalVotes: 40, rank: 2 });
    expect(ids(r.top3)).toEqual([A, B, C]);
  });

  it('2. exact tie at the top after full counting: TIE_NEEDS_LOTTERY, leader by ballot position for display', () => {
    const r = result({
      boothEntries: [
        booth(1, { [A]: 10, [B]: 30, [C]: 1, [N]: 0 }),
        booth(2, { [A]: 20, [B]: 0, [C]: 1, [N]: 0 }),
        booth(3, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
    });
    expect(r.status).toBe('TIE_NEEDS_LOTTERY');
    expect(r.topTied).toBe(true);
    expect(r.margin).toBe(0);
    expect(r.winnerCandidateId).toBeNull();
    expect(r.leader).toMatchObject({ candidateId: A, rank: 1, tiedWithPrevious: false });
    expect(r.runnerUp).toMatchObject({ candidateId: B, rank: 1, tiedWithPrevious: true });
  });

  it('3. tie at the top while counting: COUNTING with topTied', () => {
    const r = result({ boothEntries: [booth(1, { [A]: 5, [B]: 5, [C]: 1, [N]: 0 })] });
    expect(r).toMatchObject({ status: 'COUNTING', topTied: true, margin: 0 });
  });

  it('4. tie for 2nd/3rd place only: no tie status, ranks 1,2,2', () => {
    const r2 = result({
      boothEntries: [
        booth(1, { [A]: 50, [B]: 20, [C]: 20, [N]: 0 }),
        booth(2, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
        booth(3, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
    });
    expect(r2.status).toBe('READY_TO_DECLARE');
    expect(r2.topTied).toBe(false);
    expect(ranks(r2)).toEqual({ [A]: 1, [B]: 2, [C]: 2, [N]: null });
    expect(r2.top3.map((t) => [t.candidateId, t.rank, t.tiedWithPrevious])).toEqual([
      [A, 1, false],
      [B, 2, false],
      [C, 2, true],
    ]);
  });

  it('5. all votes 0 after full counting: TIE_NEEDS_LOTTERY', () => {
    const zero = { [A]: 0, [B]: 0, [C]: 0, [N]: 0 };
    const r = result({
      boothEntries: [booth(1, zero), booth(2, zero), booth(3, zero)],
      postalEntry: postal(zero),
    });
    expect(r).toMatchObject({
      status: 'TIE_NEEDS_LOTTERY',
      topTied: true,
      margin: 0,
      totalValidVotes: 0,
    });
    expect(ranks(r)).toEqual({ [A]: 1, [B]: 1, [C]: 1, [N]: null });
  });

  it('6. NOTA has the most votes: never leader/runnerUp/top3; notaHighest; margin between real candidates', () => {
    const r = result({
      boothEntries: [
        booth(1, { [A]: 10, [B]: 7, [C]: 1, [N]: 50 }),
        booth(2, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
        booth(3, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
    });
    expect(r.notaHighest).toBe(true);
    expect(r.notaVotes).toBe(50);
    expect(ids(r.top3)).toEqual([A, B, C]);
    expect(r.leader?.candidateId).toBe(A);
    expect(r.runnerUp?.candidateId).toBe(B);
    expect(r.margin).toBe(3);
    expect(r.status).toBe('READY_TO_DECLARE');
    expect(ranks(r)[A]).toBe(1);
  });

  it('7. NOTA tied with the top candidate: still ignored for leader; not "highest"', () => {
    const r = result({ boothEntries: [booth(1, { [A]: 10, [B]: 4, [C]: 1, [N]: 10 })] });
    expect(r.leader?.candidateId).toBe(A);
    expect(r.notaHighest).toBe(false);
    expect(r.margin).toBe(6);
    expect(ids(r.top3)).not.toContain(N);
  });

  it('8. only 2 real candidates (+ NOTA): top3 has 2 rows', () => {
    const r = result({
      candidates: [cand(A, 1), cand(B, 2), nota(N, 3)],
      boothEntries: [booth(1, { [A]: 3, [B]: 9, [N]: 1 })],
    });
    expect(ids(r.top3)).toEqual([B, A]);
    expect(r.margin).toBe(6);
  });

  it('9. unopposed ward: UNOPPOSED, winner set, margin null, no counting needed', () => {
    const r = result({ isUnopposed: true, candidates: [cand(A, 1, 1)] });
    expect(r).toMatchObject({
      status: 'UNOPPOSED',
      winnerCandidateId: A,
      margin: null,
      runnerUp: null,
      topTied: false,
      notaVotes: 0,
      notaHighest: false,
      boothsEntered: 0,
      postalEntered: false,
    });
    expect(ids(r.top3)).toEqual([A]);
  });

  it('10. unopposed ward with a booth or postal entry: ResultInputError', () => {
    const base = { isUnopposed: true, candidates: [cand(A, 1)] };
    expect(() => result({ ...base, boothEntries: [booth(1, { [A]: 5 })] })).toThrow(
      ResultInputError,
    );
    expect(() => result({ ...base, postalEntry: postal({ [A]: 1 }) })).toThrow(
      /must have no booth or postal entries/,
    );
  });

  it('11. no entries: NOT_STARTED', () => {
    const r = result();
    expect(r).toMatchObject({
      status: 'NOT_STARTED',
      boothsEntered: 0,
      postalEntered: false,
      totalValidVotes: 0,
      roundsSeen: [],
      rejectedPostal: null,
    });
    expect(r.topTied).toBe(true); // 0 = 0, shown but not a lottery while not started
  });

  it('12. all booths but no postal: COUNTING; postal but no booths: COUNTING', () => {
    const { boothEntries, postalEntry } = fullEntries();
    expect(result({ boothEntries }).status).toBe('COUNTING');
    expect(result({ postalEntry }).status).toBe('COUNTING');
    expect(result({ boothEntries: boothEntries.slice(0, 2), postalEntry }).status).toBe('COUNTING');
  });

  it('13. postal votes can change the leader; totals include postal', () => {
    const r = result({
      boothEntries: [
        booth(1, { [A]: 10, [B]: 9, [C]: 0, [N]: 0 }),
        booth(2, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
        booth(3, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: 1, [B]: 4, [C]: 0, [N]: 0 }, 2),
    });
    expect(r.leader?.candidateId).toBe(B);
    expect(totals(r)).toMatchObject({ [A]: 11, [B]: 13 });
    expect(r.margin).toBe(2);
    expect(r.rejectedPostal).toBe(2);
    expect(r.totalValidVotes).toBe(24); // rejected postal ballots are not valid votes
  });

  it('14. ZP ward spanning booths of 2 PS: every booth counts', () => {
    // Booth ids 1-2 belong to one PS, 501-502 to another; the engine only sees the ward's booth list.
    const r = computeWardResult({
      ...wardInput({ boothIds: [1, 2, 501, 502] }),
      ward: { id: 200, kind: 'ZP', isUnopposed: false, boothIds: [1, 2, 501, 502] },
      boothEntries: [
        booth(1, { [A]: 1, [B]: 0, [C]: 0, [N]: 0 }),
        booth(2, { [A]: 1, [B]: 0, [C]: 0, [N]: 0 }),
        booth(501, { [A]: 0, [B]: 5, [C]: 0, [N]: 0 }),
        booth(502, { [A]: 0, [B]: 5, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }),
    });
    expect(r).toMatchObject({
      kind: 'ZP',
      boothsTotal: 4,
      boothsEntered: 4,
      status: 'READY_TO_DECLARE',
    });
    expect(totals(r)).toMatchObject({ [A]: 2, [B]: 10 });
  });

  it('15. declaration matching the votes: DECLARED, no mismatch; a different snapshot: mismatch', () => {
    const computed = result(fullEntries());
    const snapshot = buildDeclarationSnapshot(computed);
    expect(snapshot.candidates).toEqual([
      { candidateId: A, boothVotes: 55, postalVotes: 5, totalVotes: 60 },
      { candidateId: B, boothVotes: 35, postalVotes: 5, totalVotes: 40 },
      { candidateId: C, boothVotes: 10, postalVotes: 0, totalVotes: 10 },
      { candidateId: N, boothVotes: 5, postalVotes: 0, totalVotes: 5 },
    ]);
    expect(snapshot).toMatchObject({ totalValidVotes: 115, rejectedPostal: 3 });

    const ok = result({
      ...fullEntries(),
      latestDeclaration: declaration({ version: 1, margin: 20, snapshot }),
    });
    expect(ok).toMatchObject({
      status: 'DECLARED',
      winnerCandidateId: A,
      margin: 20,
      declaration: { version: 1, status: 'DECLARED', winnerCandidateId: A, margin: 20 },
      declarationMismatch: false,
    });

    const changedTotal = structuredClone(snapshot);
    changedTotal.candidates[1] = { candidateId: B, boothVotes: 35, postalVotes: 5, totalVotes: 41 };
    const changedPostal = structuredClone(snapshot);
    changedPostal.candidates[0] = {
      candidateId: A,
      boothVotes: 56,
      postalVotes: 4,
      totalVotes: 60,
    };
    const missing = { ...snapshot, candidates: snapshot.candidates.slice(1) };
    const extra = {
      ...snapshot,
      candidates: [
        ...snapshot.candidates,
        { candidateId: 999, boothVotes: 0, postalVotes: 0, totalVotes: 0 },
      ],
    };
    const otherId = {
      ...snapshot,
      candidates: [
        ...snapshot.candidates.slice(1),
        { candidateId: 999, boothVotes: 55, postalVotes: 5, totalVotes: 60 },
      ],
    };
    for (const bad of [
      changedTotal,
      changedPostal,
      missing,
      extra,
      otherId,
      null,
      'x',
      [],
      { candidates: 'no' },
      { candidates: [1, 2, 3, 4] },
    ]) {
      const r = result({
        ...fullEntries(),
        latestDeclaration: declaration({ margin: 20, snapshot: bad }),
      });
      expect(r.status).toBe('DECLARED');
      expect(r.declarationMismatch, JSON.stringify(bad)).toBe(true);
    }
  });

  it('16. TIE_RESOLVED declaration: status TIE_RESOLVED, winner from the declaration, margin 0', () => {
    const zero = { [A]: 0, [B]: 0, [C]: 0, [N]: 0 };
    const input = {
      boothEntries: [booth(1, zero), booth(2, zero), booth(3, zero)],
      postalEntry: postal(zero),
    };
    const snapshot = buildDeclarationSnapshot(result(input));
    const r = result({
      ...input,
      latestDeclaration: declaration({
        version: 2,
        status: 'TIE_RESOLVED',
        winnerCandidateId: C,
        margin: 0,
        snapshot,
      }),
    });
    expect(r).toMatchObject({
      status: 'TIE_RESOLVED',
      winnerCandidateId: C,
      margin: 0,
      topTied: true,
      declarationMismatch: false,
    });
    expect(r.leader?.candidateId).toBe(A); // display order is unchanged; the WINNER is the lottery result
  });

  describe('17. input validation (ResultInputError)', () => {
    const bad: [string, WardResultInput, RegExp][] = [
      [
        'vote for a candidate not in this ward',
        wardInput({ boothEntries: [booth(1, { [A]: 1, [B]: 0, [C]: 0, [N]: 0, 77: 1 })] }),
        /candidate 77, who is not a candidate of this ward/,
      ],
      [
        'same candidate twice in one entry',
        wardInput({
          boothEntries: [
            {
              boothId: 1,
              roundNo: 1,
              sheetTotal: 2,
              votes: [
                { candidateId: A, votes: 1 },
                { candidateId: A, votes: 1 },
                { candidateId: B, votes: 0 },
                { candidateId: C, votes: 0 },
                { candidateId: N, votes: 0 },
              ],
            },
          ],
        }),
        /candidate 11 appears twice/,
      ],
      [
        'missing vote row (never 0)',
        wardInput({ boothEntries: [booth(1, { [A]: 1, [B]: 0, [N]: 0 })] }),
        /no vote row for candidate\(s\) 13/,
      ],
      [
        'booth not in the ward',
        wardInput({ boothEntries: [booth(9, { [A]: 1, [B]: 0, [C]: 0, [N]: 0 })] }),
        /booth 9: this booth is not in the ward/,
      ],
      [
        'same booth entered twice',
        wardInput({
          boothEntries: [
            booth(1, { [A]: 1, [B]: 0, [C]: 0, [N]: 0 }),
            booth(1, { [A]: 1, [B]: 0, [C]: 0, [N]: 0 }),
          ],
        }),
        /booth 1: entered twice/,
      ],
      [
        'negative votes',
        wardInput({ boothEntries: [booth(1, { [A]: -1, [B]: 2, [C]: 0, [N]: 0 })] }),
        /votes of candidate 11 must be a whole number 0 or more, got -1/,
      ],
      [
        'non-integer votes',
        wardInput({ boothEntries: [booth(1, { [A]: 1.5, [B]: 0, [C]: 0, [N]: 0 })] }),
        /got 1.5/,
      ],
      [
        'unsafe-integer votes',
        wardInput({ boothEntries: [booth(1, { [A]: 2 ** 53, [B]: 0, [C]: 0, [N]: 0 })] }),
        /got 9007199254740992/,
      ],
      [
        'booth votes do not match the sheet total',
        wardInput({ boothEntries: [booth(1, { [A]: 1, [B]: 2, [C]: 0, [N]: 0 }, 1, 4)] }),
        /votes add up to 3 but the sheet total is 4/,
      ],
      [
        'postal votes do not match the sheet total',
        wardInput({ postalEntry: postal({ [A]: 1, [B]: 2, [C]: 0, [N]: 0 }, 5, 8) }),
        /postal: votes add up to 3 but the sheet total is 8/,
      ],
      [
        'postal vote for an unknown candidate',
        wardInput({ postalEntry: postal({ [A]: 1, [B]: 0, [C]: 0, [N]: 0, 78: 0 }) }),
        /postal: vote for candidate 78/,
      ],
      [
        'invalid sheet total',
        wardInput({ boothEntries: [booth(1, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }, 1, -1)] }),
        /sheet total must be a whole number/,
      ],
      [
        'invalid postal sheet total',
        wardInput({ postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }, null, -2) }),
        /postal: sheet total/,
      ],
      [
        'invalid rejected count',
        wardInput({ postalEntry: postal({ [A]: 0, [B]: 0, [C]: 0, [N]: 0 }, -1) }),
        /rejected count/,
      ],
      [
        'invalid round number',
        wardInput({ boothEntries: [booth(1, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }, 0)] }),
        /round number/,
      ],
      [
        'non-integer round number',
        wardInput({ boothEntries: [booth(1, { [A]: 0, [B]: 0, [C]: 0, [N]: 0 }, 1.5)] }),
        /round number/,
      ],
      [
        'more than one NOTA',
        wardInput({ candidates: [cand(A, 1), cand(B, 2), nota(N, 3), nota(20, 4)] }),
        /more than one NOTA/,
      ],
      ['no real candidate', wardInput({ candidates: [nota(N, 1)] }), /no real candidate/],
      [
        'one real candidate in a contested ward',
        wardInput({ candidates: [cand(A, 1), nota(N, 2)] }),
        /only one real candidate but is not marked unopposed/,
      ],
      [
        'unopposed with more than one real candidate',
        wardInput({ isUnopposed: true, candidates: [cand(A, 1), cand(B, 2)] }),
        /unopposed but has 2 real candidates/,
      ],
      [
        'declaration on an unopposed ward',
        wardInput({
          isUnopposed: true,
          candidates: [cand(A, 1)],
          latestDeclaration: declaration(),
        }),
        /never declared/,
      ],
      ['ward with no booths', wardInput({ boothIds: [] }), /has no booths/],
      [
        'booth listed twice in the ward',
        wardInput({ boothIds: [1, 1, 2] }),
        /a booth is listed twice/,
      ],
      [
        'duplicate candidate id',
        wardInput({ candidates: [cand(A, 1), cand(A, 2), nota(N, 3)] }),
        /candidate id appears twice/,
      ],
      [
        'duplicate ballot position',
        wardInput({ candidates: [cand(A, 1), cand(B, 1), nota(N, 3)] }),
        /share a ballot position/,
      ],
      [
        'declared winner is NOTA',
        wardInput({ latestDeclaration: declaration({ winnerCandidateId: N }) }),
        /declared winner 19 is not a real candidate/,
      ],
      [
        'declared winner from another ward',
        wardInput({ latestDeclaration: declaration({ winnerCandidateId: 555 }) }),
        /declared winner 555/,
      ],
      [
        'invalid declaration version',
        wardInput({ latestDeclaration: declaration({ version: 0 }) }),
        /declaration version/,
      ],
      [
        'non-integer declaration version',
        wardInput({ latestDeclaration: declaration({ version: 1.5 }) }),
        /declaration version/,
      ],
      [
        'invalid declared margin',
        wardInput({ latestDeclaration: declaration({ margin: -3 }) }),
        /declared margin/,
      ],
    ];
    it.each(bad)('%s', (_name, input, message) => {
      expect(() => computeWardResult(input)).toThrow(ResultInputError);
      expect(() => computeWardResult(input)).toThrow(message);
    });

    it('errors carry the ResultInputError name', () => {
      try {
        computeWardResult(wardInput({ boothIds: [] }));
      } catch (err) {
        expect(err).toBeInstanceOf(ResultInputError);
        expect((err as Error).name).toBe('ResultInputError');
      }
    });
  });

  it('18. very large but safe numbers add exactly; sums that become unsafe throw', () => {
    const big = 2 ** 51; // safe
    const r = result({
      boothEntries: [
        booth(1, { [A]: big, [B]: 1, [C]: 0, [N]: 0 }),
        booth(2, { [A]: big, [B]: 0, [C]: 0, [N]: 0 }),
      ],
      postalEntry: postal({ [A]: big, [B]: 0, [C]: 0, [N]: 0 }),
    });
    expect(totals(r)[A]).toBe(3 * big);
    expect(r.margin).toBe(3 * big - 1);

    const huge = Number.MAX_SAFE_INTEGER - 1;
    // Sum inside one entry becomes unsafe.
    expect(() =>
      result({ boothEntries: [booth(1, { [A]: huge, [B]: huge, [C]: 0, [N]: 0 }, 1, 0)] }),
    ).toThrow(/sum of votes is too large/);
    // Booth totals across entries become unsafe.
    expect(() =>
      result({
        boothEntries: [
          booth(1, { [A]: huge, [B]: 0, [C]: 0, [N]: 0 }),
          booth(2, { [A]: huge, [B]: 0, [C]: 0, [N]: 0 }),
        ],
      }),
    ).toThrow(/booth votes is too large/);
    // Booth + postal of one candidate becomes unsafe.
    expect(() =>
      result({
        boothEntries: [booth(1, { [A]: huge, [B]: 0, [C]: 0, [N]: 0 })],
        postalEntry: postal({ [A]: huge, [B]: 0, [C]: 0, [N]: 0 }),
      }),
    ).toThrow(/total of candidate 11 is too large/);
    // The ward's total valid votes becomes unsafe.
    expect(() =>
      result({
        boothEntries: [booth(1, { [A]: huge, [B]: 0, [C]: 0, [N]: 0 })],
        postalEntry: postal({ [A]: 0, [B]: huge, [C]: 0, [N]: 0 }),
      }),
    ).toThrow(/total valid votes is too large/);
  });

  it('19. input order does not matter', () => {
    const inputs: WardResultInput[] = [
      wardInput(fullEntries()),
      wardInput({
        boothEntries: [
          booth(1, { [A]: 5, [B]: 5, [C]: 5, [N]: 0 }),
          booth(3, { [A]: 1, [B]: 0, [C]: 1, [N]: 9 }, 4),
        ],
      }),
      wardInput({
        ...fullEntries(),
        latestDeclaration: declaration({
          margin: 20,
          snapshot: buildDeclarationSnapshot(result(fullEntries())),
        }),
      }),
    ];
    for (const input of inputs) {
      const expected = computeWardResult(input);
      for (let seed = 1; seed <= 25; seed++)
        expect(computeWardResult(shuffleInput(input, seed))).toEqual(expected);
    }
  });

  it('candidates are listed in ballot order whatever their ids; postal rule lives in one function', () => {
    const r = result({ candidates: [cand(50, 2), cand(40, 1), nota(30, 3)] });
    expect(r.candidates.map((c) => c.id)).toEqual([40, 50, 30]);
    expect(expectedPostalVoteSum(postal({ [A]: 3 }, 9))).toBe(3);
  });
});
