import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWardResult } from '../../src/services/result-loader.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, countingApp, psW1Sheet } from './helpers.js';
import type { World } from './helpers.js';

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

describe('integrity', () => {
  it('voided_entry and audit_log refuse UPDATE/DELETE (app user: no privilege; everyone: triggers)', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    await ro.post(`/entries/${id}/void`, {
      rowVersion: 1,
      reason: 'Voided for the integrity test',
    });

    for (const table of ['voided_entry', 'audit_log']) {
      await expect(pool.query(`UPDATE ${table} SET created_at = NOW()`)).rejects.toMatchObject({
        code: 'ER_TABLEACCESS_DENIED_ERROR',
      });
      await expect(pool.query(`DELETE FROM ${table}`)).rejects.toMatchObject({
        code: 'ER_TABLEACCESS_DENIED_ERROR',
      });
      await expect(migrator.query(`UPDATE ${table} SET created_at = NOW()`)).rejects.toMatchObject({
        code: 'ER_SIGNAL_EXCEPTION',
      });
      await expect(migrator.query(`DELETE FROM ${table}`)).rejects.toMatchObject({
        code: 'ER_SIGNAL_EXCEPTION',
      });
    }
    const [archive] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM voided_entry');
    expect(Number(archive[0]?.n)).toBe(1);
  });

  it('after create + update + void + re-create, the result totals equal the live entries only', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const first = (
      (await ro.post('/entries', psW1Sheet(w, w.b1, 100, 50, 5))).body as { entry: { id: number } }
    ).entry.id;
    await ro.post('/entries', psW1Sheet(w, w.b2, 30, 40, 2));
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 101, 50, 5);
    await ro.put(`/entries/${first}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: 'Corrected candidate A count',
    });
    await ro.post(`/entries/${first}/void`, {
      rowVersion: 2,
      reason: 'Sheet belonged to another booth',
    });
    await ro.post('/entries', psW1Sheet(w, w.b1, 7, 8, 9));

    const result = await loadWardResult(pool, w.psW1); // what npm run result:ward shows
    const [live] = await pool.execute<RowDataPacket[]>(
      'SELECT candidate_id, SUM(votes) AS total FROM booth_entry_vote WHERE ward_id = ? GROUP BY candidate_id',
      [w.psW1],
    );
    const liveTotals = Object.fromEntries(
      live.map((r) => [Number(r.candidate_id), Number(r.total)]),
    );
    expect(Object.fromEntries(result.candidates.map((c) => [c.id, c.totalVotes]))).toEqual(
      liveTotals,
    );
    expect(liveTotals).toEqual({ [w.c.A]: 37, [w.c.B]: 48, [w.c.N1]: 11 });
    expect(result.boothsEntered).toBe(2);
  });
});
