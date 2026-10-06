import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, v } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import {
  appFor,
  confirmBody,
  declareClient,
  fillPsW1,
  PASSWORD,
  previewResult,
} from './helpers.js';
import type { DeclareClient, FilledWard } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let ro: DeclareClient;
let filled: FilledWard;

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
  filled = await fillPsW1(ro, w);
  await ro.dpost(`/wards/${w.psW1}`, confirmBody(await previewResult(ro, w.psW1)));
});

async function correct(aVotes: number, bVotes: number, winner: number, total: number) {
  const res = await ro.dpost(`/wards/${w.psW1}/correction`, {
    password: PASSWORD,
    reason: 'Recount ordered for booth one',
    changes: [
      {
        kind: 'BOOTH',
        entryId: filled.entries.b1,
        rowVersion: await rowVersion(),
        sheetTotal: aVotes + bVotes + 10,
        votes: v([
          [w.c.A, aVotes],
          [w.c.B, bVotes],
          [w.c.N1, 10],
        ]),
      },
    ],
    confirmWinnerCandidateId: winner,
    confirmTotalValidVotes: total,
  });
  expect(res.status).toBe(201);
}

async function rowVersion(): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT row_version FROM booth_entry WHERE id = ?',
    [filled.entries.b1],
  );
  return Number(rows[0]?.row_version);
}

describe('declaration integrity', () => {
  it('ward_declarations rows never change (app user: no privilege; everyone: triggers)', async () => {
    await expect(pool.query('UPDATE ward_declarations SET margin = 1')).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
    await expect(pool.query('DELETE FROM ward_declarations')).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
    await expect(migrator.query('UPDATE ward_declarations SET margin = 1')).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
    await expect(migrator.query('DELETE FROM ward_declarations')).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
  });

  it('after corrections, the sums of the live entries equal the latest snapshot', async () => {
    await correct(200, 300, w.c.B, 553); // v2: B wins
    await correct(250, 250, w.c.A, 553); // v3: A 280 vs B 260
    const [live] = await pool.execute<RowDataPacket[]>(
      `SELECT candidate_id, SUM(votes) AS total FROM (
         SELECT candidate_id, votes FROM booth_entry_vote WHERE ward_id = ?
         UNION ALL SELECT candidate_id, votes FROM postal_entry_vote WHERE ward_id = ?) x
       GROUP BY candidate_id`,
      [w.psW1, w.psW1],
    );
    const [latest] = await pool.execute<RowDataPacket[]>(
      'SELECT version, snapshot FROM ward_declarations WHERE ward_id = ? ORDER BY version DESC LIMIT 1',
      [w.psW1],
    );
    expect(latest[0]?.version).toBe(3);
    const snapshot = latest[0]?.snapshot as {
      candidates: { candidateId: number; totalVotes: number }[];
    };
    expect(
      Object.fromEntries(snapshot.candidates.map((c) => [c.candidateId, c.totalVotes])),
    ).toEqual(Object.fromEntries(live.map((r) => [Number(r.candidate_id), Number(r.total)])));
  });

  it('GET declarations lists every version, oldest first', async () => {
    await correct(200, 300, w.c.B, 553);
    const res = await ro.dget(`/wards/${w.psW1}/declarations`);
    const list = (res.body as { declarations: Record<string, unknown>[] }).declarations;
    expect(
      list.map((d) => [
        d.version,
        d.status,
        (d.winner as { id: number }).id,
        d.margin,
        d.correctionReason,
      ]),
    ).toEqual([
      [1, 'DECLARED', w.c.A, 120, null],
      [2, 'DECLARED', w.c.B, 80, 'Recount ordered for booth one'],
    ]);
    expect(list[0]).toMatchObject({
      totalValidVotes: 553,
      lottery: null,
      notaHighestAck: false,
      declaredBy: { username: 'ro_ps1_x1' },
    });
  });
});
