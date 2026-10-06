import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, count, countingApp, psW1Sheet, v } from './helpers.js';
import type { Client, World } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let ro: Client;

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
  ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
});

const entries = () => count(pool, 'SELECT COUNT(*) AS n FROM booth_entry');
const REASON = 'A long enough reason text';

async function expectError(res: { status: number; body: unknown }, status: number, error: string) {
  expect(res.status).toBe(status);
  expect((res.body as { error: string }).error).toBe(error);
  expect(await entries()).toBe(0);
}

describe('business rules (each its own code)', () => {
  it('BOOTH_NOT_IN_WARD: booth of another ward than the form', async () => {
    await expectError(
      await ro.post('/entries', { ...psW1Sheet(w, w.b1), wardId: w.psW4 }),
      400,
      'BOOTH_NOT_IN_WARD',
    );
    await expectError(await ro.post('/entries', psW1Sheet(w, w.b6)), 400, 'BOOTH_NOT_IN_WARD');
  });

  it('BALLOT_NOT_LOCKED', async () => {
    const body = {
      wardId: w.psW4,
      boothId: w.b6,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 3,
      votes: v([
        [w.c.G, 1],
        [w.c.H, 1],
        [w.c.N4, 1],
      ]),
    };
    await expectError(await ro.post('/entries', body), 409, 'BALLOT_NOT_LOCKED');
  });

  it('WARD_UNOPPOSED', async () => {
    const body = {
      wardId: w.psW3,
      boothId: w.b5,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 1,
      votes: v([[w.c.U, 1]]),
    };
    await expectError(await ro.post('/entries', body), 409, 'WARD_UNOPPOSED');
  });

  it('WARD_DECLARED (declaration inserted directly)', async () => {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot, declared_by)
       VALUES (?, 1, 'DECLARED', ?, 5, '{}', ?)`,
      [w.psW1, w.c.A, w.users.ro1],
    );
    await expectError(await ro.post('/entries', psW1Sheet(w, w.b1)), 409, 'WARD_DECLARED');
    await expectError(
      await ro.post(`/wards/${w.psW1}/postal`, {
        sheetTotal: 0,
        votes: v([
          [w.c.A, 0],
          [w.c.B, 0],
          [w.c.N1, 0],
        ]),
      }),
      409,
      'WARD_DECLARED',
    );
  });

  it('VOTES_INCOMPLETE: a candidate missing, or NOTA missing', async () => {
    const noB = {
      ...psW1Sheet(w, w.b1),
      sheetTotal: 310,
      votes: v([
        [w.c.A, 300],
        [w.c.N1, 10],
      ]),
    };
    const res = await ro.post('/entries', noB);
    await expectError(res, 400, 'VOTES_INCOMPLETE');
    expect(res.body).toEqual({ error: 'VOTES_INCOMPLETE', missingCandidateIds: [w.c.B] });
    const noNota = {
      ...psW1Sheet(w, w.b1),
      sheetTotal: 500,
      votes: v([
        [w.c.A, 300],
        [w.c.B, 200],
      ]),
    };
    expect((await ro.post('/entries', noNota)).body).toEqual({
      error: 'VOTES_INCOMPLETE',
      missingCandidateIds: [w.c.N1],
    });
  });

  it('UNKNOWN_CANDIDATE: a candidate of another ward', async () => {
    const body = {
      ...psW1Sheet(w, w.b1),
      sheetTotal: 511,
      votes: [...psW1Sheet(w, w.b1).votes, { candidateId: w.c.C, votes: 1 }],
    };
    const res = await ro.post('/entries', body);
    await expectError(res, 400, 'UNKNOWN_CANDIDATE');
    expect(res.body).toEqual({ error: 'UNKNOWN_CANDIDATE', candidateIds: [w.c.C] });
  });

  it('DUPLICATE_CANDIDATE', async () => {
    const body = {
      ...psW1Sheet(w, w.b1),
      sheetTotal: 511,
      votes: [...psW1Sheet(w, w.b1).votes, { candidateId: w.c.A, votes: 1 }],
    };
    const res = await ro.post('/entries', body);
    await expectError(res, 400, 'DUPLICATE_CANDIDATE');
    expect(res.body).toEqual({ error: 'DUPLICATE_CANDIDATE', candidateIds: [w.c.A] });
  });

  it('SUM_MISMATCH returns both numbers', async () => {
    const res = await ro.post('/entries', { ...psW1Sheet(w, w.b1), sheetTotal: 509 });
    await expectError(res, 400, 'SUM_MISMATCH');
    expect(res.body).toEqual({ error: 'SUM_MISMATCH', sum: 510, sheetTotal: 509 });
  });

  it('EXCEEDS_REGISTERED_VOTERS (booth has 1000)', async () => {
    const res = await ro.post('/entries', psW1Sheet(w, w.b1, 600, 400, 1));
    await expectError(res, 400, 'EXCEEDS_REGISTERED_VOTERS');
    expect(res.body).toEqual({
      error: 'EXCEEDS_REGISTERED_VOTERS',
      sheetTotal: 1001,
      registeredVoters: 1000,
    });
    expect((await ro.post('/entries', psW1Sheet(w, w.b1, 600, 400, 0))).status).toBe(201); // exactly 1000 is fine
  });

  it('ALREADY_ENTERED', async () => {
    expect((await ro.post('/entries', psW1Sheet(w, w.b1))).status).toBe(201);
    const res = await ro.post('/entries', psW1Sheet(w, w.b1, 1, 1, 1));
    expect([res.status, res.body]).toEqual([409, { error: 'ALREADY_ENTERED' }]);
  });

  it('STALE_VERSION', async () => {
    const id = ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 1, 1, 1);
    const ok = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect(ok.status).toBe(200);
    const stale = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect([stale.status, stale.body]).toEqual([
      409,
      { error: 'STALE_VERSION', currentRowVersion: 2 },
    ]);
  });

  it('NOT_FOUND for unknown booth, ward and entry', async () => {
    expect((await ro.post('/entries', { ...psW1Sheet(w, w.b1), boothId: 999_999 })).body).toEqual({
      error: 'NOT_FOUND',
    });
    expect((await ro.get('/wards/999999/booths')).status).toBe(404);
    expect((await ro.get('/entries/999999')).status).toBe(404);
    expect((await ro.post('/entries/999999/void', { rowVersion: 1, reason: REASON })).status).toBe(
      404,
    );
  });
});

describe('Zod validation -> 400 VALIDATION_FAILED with field details', () => {
  const invalid: [string, (base: ReturnType<typeof psW1Sheet>) => unknown][] = [
    [
      'negative votes',
      (b) => ({
        ...b,
        votes: [{ candidateId: b.votes[0]?.candidateId, votes: -1 }, ...b.votes.slice(1)],
      }),
    ],
    [
      'decimal votes',
      (b) => ({
        ...b,
        votes: [{ candidateId: b.votes[0]?.candidateId, votes: 1.5 }, ...b.votes.slice(1)],
      }),
    ],
    [
      'huge votes',
      (b) => ({
        ...b,
        votes: [{ candidateId: b.votes[0]?.candidateId, votes: 2 ** 53 }, ...b.votes.slice(1)],
      }),
    ],
    [
      'votes as text',
      (b) => ({
        ...b,
        votes: [{ candidateId: b.votes[0]?.candidateId, votes: '5' }, ...b.votes.slice(1)],
      }),
    ],
    ['negative sheetTotal', (b) => ({ ...b, sheetTotal: -1 })],
    ['round 0', (b) => ({ ...b, roundNo: 0 })],
    ['round 100', (b) => ({ ...b, roundNo: 100 })],
    ['ballotFor XX', (b) => ({ ...b, ballotFor: 'XX' })],
    ['booth id 0', (b) => ({ ...b, boothId: 0 })],
    ['no vote rows', (b) => ({ ...b, votes: [] })],
    [
      '61 vote rows',
      (b) => ({
        ...b,
        votes: Array.from({ length: 61 }, (_, i) => ({ candidateId: i + 1, votes: 0 })),
      }),
    ],
    ['extra field', (b) => ({ ...b, candidateName: 'x' })],
    ['missing wardId', ({ wardId: _w, ...rest }) => rest],
  ];
  it.each(invalid)('%s', async (_name, make) => {
    const res = await ro.post('/entries', make(psW1Sheet(w, w.b1)));
    expect(res.status).toBe(400);
    expect((res.body as { error: string; details: unknown[] }).error).toBe('VALIDATION_FAILED');
    expect(
      (res.body as { details: { path: string; message: string }[] }).details.length,
    ).toBeGreaterThan(0);
    expect(await entries()).toBe(0);
  });

  it('reason must be 10-500 characters after trimming (update and void)', async () => {
    const id = ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b1);
    for (const reason of ['too short', '         x         ', 'x'.repeat(501), undefined]) {
      const put = await ro.put(`/entries/${id}`, {
        rowVersion: 1,
        roundNo: 1,
        sheetTotal,
        votes,
        reason,
      });
      expect((put.body as { error: string }).error).toBe('VALIDATION_FAILED');
      const voided = await ro.post(`/entries/${id}/void`, { rowVersion: 1, reason });
      expect((voided.body as { error: string }).error).toBe('VALIDATION_FAILED');
    }
    expect(await entries()).toBe(1);
  });

  it('PUT may not change the booth (unknown fields are rejected)', async () => {
    const id = ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b1);
    const res = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
      boothId: w.b2,
    });
    expect((res.body as { error: string }).error).toBe('VALIDATION_FAILED');
  });

  it('a bad path id is VALIDATION_FAILED', async () => {
    expect((await ro.get('/entries/abc')).body).toMatchObject({ error: 'VALIDATION_FAILED' });
    expect((await ro.get('/wards/0/booths')).body).toMatchObject({ error: 'VALIDATION_FAILED' });
  });

  it('error details never echo the submitted values', async () => {
    const res = await ro.post('/entries', { ...psW1Sheet(w, w.b1), roundNo: 'SECRET-VALUE-123' });
    expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE-123');
  });
});
