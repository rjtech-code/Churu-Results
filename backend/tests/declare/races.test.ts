import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeclarationSnapshot } from '../../src/services/result.js';
import type { WardResult } from '../../src/services/result.js';
import { loadWardResult } from '../../src/services/result-loader.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, count, psW1Sheet, v } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { appFor, confirmBody, declareClient, fillPsW1, previewResult } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;

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
});

const declarations = () =>
  count(pool, 'SELECT COUNT(*) AS n FROM ward_declarations WHERE ward_id = ?', [w.psW1]);

describe('races', () => {
  it('two simultaneous declares: exactly one succeeds', async () => {
    const app = appFor(pool);
    const [a, b] = await Promise.all([
      declareClient(app, 'ro_ps1_x1'),
      declareClient(app, 'ro_ps1_x1'),
    ]);
    await fillPsW1(a, w);
    const result = await previewResult(a, w.psW1);
    const res = await Promise.all([
      a.dpost(`/wards/${w.psW1}`, confirmBody(result)),
      b.dpost(`/wards/${w.psW1}`, confirmBody(result)),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)?.body).toEqual({ error: 'ALREADY_DECLARED' });
    expect(await declarations()).toBe(1);
  });

  it('declare vs a Part 5 edit on the same ward: never both', async () => {
    const app = appFor(pool);
    const [a, b] = await Promise.all([
      declareClient(app, 'ro_ps1_x1'),
      declareClient(app, 'ro_ps1_x1'),
    ]);
    const filled = await fillPsW1(a, w);
    const result = await previewResult(a, w.psW1);
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 301, 200, 10);
    const [declare, edit] = await Promise.all([
      a.dpost(`/wards/${w.psW1}`, confirmBody(result)),
      b.put(`/entries/${filled.entries.b1}`, {
        rowVersion: 1,
        roundNo: 1,
        sheetTotal,
        votes,
        reason: 'Late correction racing the declare',
      }),
    ]);
    const outcome = [declare.status, edit.status];
    // Either the declare went first (edit refused) or the edit went first (declare sees new totals).
    expect([JSON.stringify([201, 409]), JSON.stringify([409, 200])]).toContain(
      JSON.stringify(outcome),
    );
    if (declare.status === 201) expect(edit.body).toEqual({ error: 'WARD_DECLARED' });
    else expect((declare.body as { error: string }).error).toBe('RESULT_CHANGED');
    // Whatever happened, a declaration (if any) matches the live entries.
    const now = await loadWardResult(pool, w.psW1);
    expect(now.declarationMismatch).toBe(false);
  });

  it('declare vs a Part 5 create (postal) on the same ward: the later one sees the other', async () => {
    const app = appFor(pool);
    const [a, b] = await Promise.all([
      declareClient(app, 'ro_ps1_x1'),
      declareClient(app, 'ro_ps1_x1'),
    ]);
    for (const booth of ['b1', 'b2', 'b4'] as const)
      await a.post('/entries', psW1Sheet(w, w[booth], 10, 5, 1));
    // The declare confirms the totals that hold once postal is in.
    const postalBody = {
      sheetTotal: 3,
      votes: v([
        [w.c.A, 1],
        [w.c.B, 1],
        [w.c.N1, 1],
      ]),
    };
    const [declare, create] = await Promise.all([
      a.dpost(`/wards/${w.psW1}`, {
        password: 'Counting-Pass-1',
        confirmWinnerCandidateId: w.c.A,
        confirmTotalValidVotes: 51,
      }),
      b.post(`/wards/${w.psW1}/postal`, postalBody),
    ]);
    // The postal create always succeeds: a declare can never be committed for an incomplete ward.
    expect(create.status).toBe(201);
    // Declare first -> it saw no postal and refused; postal first -> it saw the complete ward and declared.
    if (declare.status === 201)
      expect((declare.body as { declaration: { version: number } }).declaration.version).toBe(1);
    else expect(declare.body).toMatchObject({ error: 'COUNTING_INCOMPLETE', postalEntered: false });
    const now: WardResult = await loadWardResult(pool, w.psW1);
    if (now.declaration !== null) {
      const [row] = await pool.execute<RowDataPacket[]>(
        'SELECT snapshot FROM ward_declarations WHERE ward_id = ?',
        [w.psW1],
      );
      expect(row[0]?.snapshot).toEqual(buildDeclarationSnapshot({ ...now }));
      expect(now.postalEntered).toBe(true);
      expect(now.declarationMismatch).toBe(false);
    }
  });

  it('two simultaneous corrections: one 201, the other STALE_VERSION or RESULT_CHANGED', async () => {
    const app = appFor(pool);
    const [a, b] = await Promise.all([
      declareClient(app, 'ro_ps1_x1'),
      declareClient(app, 'ro_ps1_x1'),
    ]);
    const filled = await fillPsW1(a, w);
    await a.dpost(`/wards/${w.psW1}`, confirmBody(await previewResult(a, w.psW1)));
    const change = (aVotes: number) => ({
      kind: 'BOOTH',
      entryId: filled.entries.b1,
      rowVersion: 1,
      sheetTotal: aVotes + 210,
      votes: v([
        [w.c.A, aVotes],
        [w.c.B, 200],
        [w.c.N1, 10],
      ]),
    });
    const body = (aVotes: number) => ({
      password: 'Counting-Pass-1',
      reason: 'Simultaneous correction attempt',
      changes: [change(aVotes)],
      confirmWinnerCandidateId: w.c.A,
      confirmTotalValidVotes: 553 - 300 + aVotes,
    });
    const res = await Promise.all([
      a.dpost(`/wards/${w.psW1}/correction`, body(299)),
      b.dpost(`/wards/${w.psW1}/correction`, body(298)),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(['STALE_VERSION', 'RESULT_CHANGED']).toContain(
      (res.find((r) => r.status === 409)?.body as { error: string }).error,
    );
    expect(await declarations()).toBe(2);
  });
});
