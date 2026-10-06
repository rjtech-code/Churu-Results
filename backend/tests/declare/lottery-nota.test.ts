import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WardResult } from '../../src/services/result.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import {
  appFor,
  confirmBody,
  declareClient,
  fillPsW1,
  PASSWORD,
  previewResult,
} from './helpers.js';
import type { DeclareClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let ro: DeclareClient;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildWorld(pool);
  ro = await declareClient(appFor(pool), 'ro_ps1_x1');
});

/** A = B = 30 (tie), NOTA = 3. */
const TIE = { b1: [10, 10, 1], b2: [10, 10, 1], b4: [10, 10, 1], postal: [0, 0, 0] } as const;

const lottery = (winner: number) => ({
  winnerCandidateId: winner,
  conductedBy: 'RO Churu',
  note: 'Lottery held before both agents',
});

async function lastDeclaration(): Promise<RowDataPacket | undefined> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM ward_declarations WHERE ward_id = ? ORDER BY version DESC',
    [w.psW1],
  );
  return rows[0];
}

describe('tie lottery', () => {
  it('preview of a tie: needsLottery with the tied candidates, no winner yet', async () => {
    await fillPsW1(ro, w, {
      ...TIE,
      b1: [...TIE.b1],
      b2: [...TIE.b2],
      b4: [...TIE.b4],
      postal: [...TIE.postal],
    });
    const res = await ro.dpost(`/wards/${w.psW1}/preview`, {});
    expect(res.body).toMatchObject({
      result: { status: 'TIE_NEEDS_LOTTERY', topTied: true },
      wouldStore: {
        status: 'TIE_RESOLVED',
        winnerCandidateId: null,
        margin: 0,
        needsLottery: true,
        tiedCandidateIds: [w.c.A, w.c.B],
      },
    });
  });

  it('without lottery -> LOTTERY_REQUIRED; winner not tied -> LOTTERY_WINNER_NOT_TIED; valid -> TIE_RESOLVED', async () => {
    await fillPsW1(ro, w, { b1: [10, 10, 1], b2: [10, 10, 1], b4: [10, 10, 1], postal: [0, 0, 0] });
    const result = await previewResult(ro, w.psW1);
    const base = { password: PASSWORD, confirmTotalValidVotes: result.totalValidVotes };

    const none = await ro.dpost(`/wards/${w.psW1}`, { ...base, confirmWinnerCandidateId: w.c.B });
    expect(none.body).toEqual({ error: 'LOTTERY_REQUIRED', tiedCandidateIds: [w.c.A, w.c.B] });
    expect(none.status).toBe(400);

    const notTied = await ro.dpost(`/wards/${w.psW1}`, {
      ...base,
      confirmWinnerCandidateId: w.c.N1,
      lottery: lottery(w.c.N1),
    });
    expect(notTied.body).toEqual({
      error: 'LOTTERY_WINNER_NOT_TIED',
      tiedCandidateIds: [w.c.A, w.c.B],
    });

    const mismatch = await ro.dpost(`/wards/${w.psW1}`, {
      ...base,
      confirmWinnerCandidateId: w.c.A,
      lottery: lottery(w.c.B),
    });
    expect((mismatch.body as { error: string }).error).toBe('RESULT_CHANGED'); // confirm must name the lottery winner

    for (const bad of [
      { ...lottery(w.c.B), conductedBy: 'RO' },
      { ...lottery(w.c.B), note: 'too short' },
    ]) {
      const res = await ro.dpost(`/wards/${w.psW1}`, {
        ...base,
        confirmWinnerCandidateId: w.c.B,
        lottery: bad,
      });
      expect((res.body as { error: string }).error).toBe('VALIDATION_FAILED');
    }

    // Lottery won by B — the candidate with the HIGHER ballot position.
    const ok = await ro.dpost(`/wards/${w.psW1}`, {
      ...base,
      confirmWinnerCandidateId: w.c.B,
      lottery: lottery(w.c.B),
    });
    expect(ok.status).toBe(201);
    const body = ok.body as { declaration: Record<string, unknown>; result: WardResult };
    expect(body.declaration).toMatchObject({
      status: 'TIE_RESOLVED',
      margin: 0,
      winner: { id: w.c.B },
      lottery: {
        winnerCandidateId: w.c.B,
        conductedBy: 'RO Churu',
        note: 'Lottery held before both agents',
        tiedCandidateIds: [w.c.A, w.c.B],
      },
    });
    expect(body.result).toMatchObject({
      status: 'TIE_RESOLVED',
      winnerCandidateId: w.c.B,
      margin: 0,
      declarationMismatch: false,
    });
    expect(body.result.leader?.candidateId).toBe(w.c.B);
    expect((await lastDeclaration())?.lottery_details).toMatchObject({ winnerCandidateId: w.c.B });
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'WARD_DECLARED'",
    );
    expect(audit[0]?.new_value).toMatchObject({
      status: 'TIE_RESOLVED',
      lottery: { winnerCandidateId: w.c.B },
    });
  });

  it('lottery on a non-tie -> LOTTERY_NOT_ALLOWED', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    const res = await ro.dpost(
      `/wards/${w.psW1}`,
      confirmBody(result, { lottery: lottery(w.c.A) }),
    );
    expect([res.status, res.body]).toEqual([400, { error: 'LOTTERY_NOT_ALLOWED' }]);
  });
});

describe('NOTA highest', () => {
  it('without acknowledgement -> NOTA_HIGHEST_ACK_REQUIRED; with it -> declared and the ack recorded', async () => {
    // NOTA = 400 > A = 300 > B = 10.
    await fillPsW1(ro, w, {
      b1: [100, 5, 200],
      b2: [100, 5, 100],
      b4: [100, 0, 100],
      postal: [0, 0, 0],
    });
    const result = await previewResult(ro, w.psW1);
    expect(result).toMatchObject({ notaHighest: true, leader: { candidateId: w.c.A } });

    const noAck = await ro.dpost(`/wards/${w.psW1}`, confirmBody(result));
    expect([noAck.status, noAck.body]).toEqual([
      409,
      { error: 'NOTA_HIGHEST_ACK_REQUIRED', notaVotes: 400 },
    ]);

    const ok = await ro.dpost(
      `/wards/${w.psW1}`,
      confirmBody(result, { acknowledgeNotaHighest: true }),
    );
    expect(ok.status).toBe(201);
    expect((ok.body as { declaration: unknown }).declaration).toMatchObject({
      winner: { id: w.c.A },
      notaHighestAck: true,
      margin: 290,
    });
    expect(Number((await lastDeclaration())?.nota_highest_ack)).toBe(1);
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'WARD_DECLARED'",
    );
    expect(audit[0]?.new_value).toMatchObject({ nota_highest: true, nota_highest_ack: true });
  });

  it('an acknowledgement when NOTA is not highest is ignored (stored 0)', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    expect(
      (await ro.dpost(`/wards/${w.psW1}`, confirmBody(result, { acknowledgeNotaHighest: true })))
        .status,
    ).toBe(201);
    expect(Number((await lastDeclaration())?.nota_highest_ack)).toBe(0);
  });
});
