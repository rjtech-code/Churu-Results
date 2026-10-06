import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeclarationSnapshot } from '../../src/services/result.js';
import type { WardResult } from '../../src/services/result.js';
import { loadWardResult } from '../../src/services/result-loader.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildWorld,
  captureEvents,
  count,
  psW1Sheet,
  tableCounts,
  v,
} from '../counting/helpers.js';
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

async function declarations(): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM ward_declarations WHERE ward_id = ? ORDER BY version',
    [w.psW1],
  );
  return rows;
}

describe('declare', () => {
  it('preview shows what would be stored and writes nothing', async () => {
    await fillPsW1(ro, w);
    const before = await tableCounts(pool);
    const res = await ro.dpost(`/wards/${w.psW1}/preview`, {});
    expect(res.status).toBe(200);
    const body = res.body as { result: WardResult; wouldStore: Record<string, unknown> };
    expect(body.result.status).toBe('READY_TO_DECLARE');
    expect(body.wouldStore).toMatchObject({
      version: 1,
      status: 'DECLARED',
      winnerCandidateId: w.c.A,
      margin: 120,
      needsLottery: false,
      tiedCandidateIds: [],
      notaHighest: false,
    });
    expect(body.wouldStore.snapshot).toEqual(buildDeclarationSnapshot(body.result));
    expect(await tableCounts(pool)).toEqual(before);
  });

  it('a READY ward declares as v1 with the engine snapshot, one audit row and one event', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    const cap = captureEvents();
    let res;
    try {
      res = await ro.dpost(`/wards/${w.psW1}`, confirmBody(result));
      expect(cap.events).toEqual([{ wardId: w.psW1 }]);
    } finally {
      cap.stop();
    }
    expect(res.status).toBe(201);
    const body = res.body as { declaration: Record<string, unknown>; result: WardResult };
    expect(body.declaration).toMatchObject({
      version: 1,
      status: 'DECLARED',
      winner: { id: w.c.A, nameHindi: 'ए' },
      margin: 120,
      totalValidVotes: 553,
      lottery: null,
      notaHighestAck: false,
      declaredBy: { username: 'ro_ps1_x1' },
      correctionReason: null,
    });
    expect(body.result).toMatchObject({
      status: 'DECLARED',
      winnerCandidateId: w.c.A,
      declarationMismatch: false,
    });

    const [row] = await declarations();
    expect(row?.snapshot).toEqual(buildDeclarationSnapshot(result));
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM audit_log WHERE action = 'WARD_DECLARED'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      user_id: w.users.ro1,
      entity: 'ward',
      entity_id: String(w.psW1),
      new_value: {
        version: 1,
        status: 'DECLARED',
        winner_candidate_id: w.c.A,
        margin: 120,
        total_valid_votes: 553,
      },
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('wrong password: 401 REAUTH_FAILED, nothing declared, counted toward the lockout', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    const res = await ro.dpost(
      `/wards/${w.psW1}`,
      confirmBody(result, { password: 'not-my-password' }),
    );
    expect([res.status, res.body]).toEqual([401, { error: 'REAUTH_FAILED' }]);
    expect(await declarations()).toEqual([]);
    expect(
      await count(pool, 'SELECT failed_login_count AS n FROM users WHERE id = ?', [w.users.ro1]),
    ).toBe(1);
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REAUTH_FAILED'",
    );
    expect(audit[0]?.new_value).toMatchObject({
      note: 'wrong password at re-check',
      failed_count: 1,
    });
    expect(JSON.stringify(audit)).not.toContain('not-my-password');
  });

  it('5 wrong passwords lock the account: then 423 without checking the password; the session stays', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    for (let i = 0; i < 5; i++) {
      expect(
        (await ro.dpost(`/wards/${w.psW1}`, confirmBody(result, { password: `wrong-${i}` })))
          .status,
      ).toBe(401);
    }
    const locked = await ro.dpost(`/wards/${w.psW1}`, confirmBody(result)); // the right password
    expect(locked.status).toBe(423);
    expect(locked.body).toMatchObject({
      error: 'ACCOUNT_LOCKED',
      retryAfterSeconds: expect.any(Number) as unknown,
    });
    expect(
      await count(pool, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ACCOUNT_LOCKED'"),
    ).toBe(1);
    expect((await ro.get('/wards')).status).toBe(200); // still logged in; counting reads work
    expect(await declarations()).toEqual([]);
  });

  it('a successful re-check resets the failed-login counter', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    await ro.dpost(`/wards/${w.psW1}`, confirmBody(result, { password: 'oops-wrong' }));
    expect((await ro.dpost(`/wards/${w.psW1}`, confirmBody(result))).status).toBe(201);
    expect(
      await count(pool, 'SELECT failed_login_count AS n FROM users WHERE id = ?', [w.users.ro1]),
    ).toBe(0);
  });

  it('COUNTING ward -> 409 COUNTING_INCOMPLETE with the counts', async () => {
    await ro.post('/entries', psW1Sheet(w, w.b1));
    const res = await ro.dpost(`/wards/${w.psW1}`, {
      password: PASSWORD,
      confirmWinnerCandidateId: w.c.A,
      confirmTotalValidVotes: 510,
    });
    expect([res.status, res.body]).toEqual([
      409,
      {
        error: 'COUNTING_INCOMPLETE',
        status: 'COUNTING',
        boothsEntered: 1,
        boothsTotal: 3,
        postalEntered: false,
      },
    ]);
    expect((await ro.dpost(`/wards/${w.psW1}/preview`, {})).body).toMatchObject({
      error: 'COUNTING_INCOMPLETE',
    });
  });

  it('unopposed ward -> 409 WARD_UNOPPOSED (never declared)', async () => {
    const res = await ro.dpost(`/wards/${w.psW3}`, {
      password: PASSWORD,
      confirmWinnerCandidateId: w.c.U,
      confirmTotalValidVotes: 0,
    });
    expect([res.status, res.body]).toEqual([409, { error: 'WARD_UNOPPOSED' }]);
  });

  it('second declare -> 409 ALREADY_DECLARED', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    expect((await ro.dpost(`/wards/${w.psW1}`, confirmBody(result))).status).toBe(201);
    const again = await ro.dpost(`/wards/${w.psW1}`, confirmBody(result));
    expect([again.status, again.body]).toEqual([409, { error: 'ALREADY_DECLARED' }]);
    expect((await declarations()).length).toBe(1);
  });

  it('stale confirm winner or confirm total -> 409 RESULT_CHANGED with the fresh result', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    const wrongWinner = await ro.dpost(
      `/wards/${w.psW1}`,
      confirmBody(result, { confirmWinnerCandidateId: w.c.B }),
    );
    expect(wrongWinner.status).toBe(409);
    expect(wrongWinner.body).toMatchObject({
      error: 'RESULT_CHANGED',
      result: { status: 'READY_TO_DECLARE', totalValidVotes: 553 },
    });
    const wrongTotal = await ro.dpost(
      `/wards/${w.psW1}`,
      confirmBody(result, { confirmTotalValidVotes: 552 }),
    );
    expect((wrongTotal.body as { error: string }).error).toBe('RESULT_CHANGED');
    expect(await declarations()).toEqual([]);
  });

  it('after declare, Part 5 create/PUT/void on that ward -> WARD_DECLARED', async () => {
    const filled = await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    await ro.dpost(`/wards/${w.psW1}`, confirmBody(result));
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 1, 1, 1);
    const put = await ro.put(`/entries/${filled.entries.b1}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: 'Trying to edit after declare',
    });
    expect([put.status, put.body]).toEqual([409, { error: 'WARD_DECLARED' }]);
    const voided = await ro.post(`/entries/${filled.entries.b1}/void`, {
      rowVersion: 1,
      reason: 'Trying to void after declare',
    });
    expect(voided.body).toEqual({ error: 'WARD_DECLARED' });
    const create = await ro.post(`/wards/${w.psW1}/postal`, {
      sheetTotal: 0,
      votes: v([
        [w.c.A, 0],
        [w.c.B, 0],
        [w.c.N1, 0],
      ]),
    });
    expect(create.body).toEqual({ error: 'WARD_DECLARED' });
    const postalPut = await ro.put(`/postal/${filled.entries.postal}`, {
      rowVersion: 1,
      sheetTotal: 0,
      votes: v([
        [w.c.A, 0],
        [w.c.B, 0],
        [w.c.N1, 0],
      ]),
      reason: 'Trying postal after declare',
    });
    expect(postalPut.body).toEqual({ error: 'WARD_DECLARED' });
  });

  it('body validation: strict fields, password required', async () => {
    await fillPsW1(ro, w);
    const result = await previewResult(ro, w.psW1);
    for (const body of [
      { ...confirmBody(result), password: undefined },
      { ...confirmBody(result), extra: 1 },
      { ...confirmBody(result), acknowledgeNotaHighest: false },
      { ...confirmBody(result), confirmTotalValidVotes: -1 },
    ]) {
      expect(((await ro.dpost(`/wards/${w.psW1}`, body)).body as { error: string }).error).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect((await ro.dpost(`/wards/${w.psW1}/preview`, { anything: 1 })).status).toBe(400);
    expect((await loadWardResult(pool, w.psW1)).status).toBe('READY_TO_DECLARE');
  });
});
