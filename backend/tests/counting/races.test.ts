import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { sleep } from '../auth/helpers.js';
import { buildWorld, clientFor, count, countingApp, psW1Sheet } from './helpers.js';
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

const REASON = 'Concurrent correction test';

describe('races', () => {
  it('two simultaneous creates for the same booth: exactly one 201 and one 409 ALREADY_ENTERED', async () => {
    const app = countingApp(pool);
    const [a, b] = await Promise.all([clientFor(app, 'ro_ps1_x1'), clientFor(app, 'ro_ps1_x1')]);
    const results = await Promise.all([
      a.post('/entries', psW1Sheet(w, w.b1, 1, 2, 3)),
      b.post('/entries', psW1Sheet(w, w.b1, 4, 5, 6)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body).toEqual({ error: 'ALREADY_ENTERED' });
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry')).toBe(1);
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry_vote')).toBe(3);
    expect(
      await count(pool, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ENTRY_CREATED'"),
    ).toBe(1);
  });

  it('two simultaneous PUTs with the same rowVersion: one 200, one 409 STALE_VERSION', async () => {
    const app = countingApp(pool);
    const [a, b] = await Promise.all([clientFor(app, 'ro_ps1_x1'), clientFor(app, 'ro_ps1_x1')]);
    const id = ((await a.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const edit = (x: number) => {
      const { votes, sheetTotal } = psW1Sheet(w, w.b1, x, 1, 1);
      return { rowVersion: 1, roundNo: 1, sheetTotal, votes, reason: REASON };
    };
    const results = await Promise.all([
      a.put(`/entries/${id}`, edit(7)),
      b.put(`/entries/${id}`, edit(8)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body).toMatchObject({ error: 'STALE_VERSION' });
    expect(await count(pool, 'SELECT row_version AS n FROM booth_entry WHERE id = ?', [id])).toBe(
      2,
    );
    expect(
      await count(pool, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ENTRY_UPDATED'"),
    ).toBe(1);
  });

  it('a create waits for a declare holding the ward lock, then sees the declaration (never both)', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const declare = await pool.getConnection();
    try {
      // Part 6's declare will do exactly this: lock the ward row first, then write the declaration.
      await declare.beginTransaction();
      await declare.execute('SELECT id FROM ward WHERE id = ? FOR UPDATE', [w.psW1]);
      await declare.execute(
        `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot, declared_by)
         VALUES (?, 1, 'DECLARED', ?, 1, '{}', ?)`,
        [w.psW1, w.c.A, w.users.ro1],
      );
      let settled = false;
      const create = ro.post('/entries', psW1Sheet(w, w.b1)).then((r) => {
        settled = true;
        return r;
      });
      await sleep(400);
      expect(settled).toBe(false); // blocked on the ward lock
      await declare.commit();
      const res = await create;
      expect([res.status, res.body]).toEqual([409, { error: 'WARD_DECLARED' }]);
    } finally {
      declare.release();
    }
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry')).toBe(0);
  });

  it('when the declare is rolled back instead, the waiting create goes through', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const declare = await pool.getConnection();
    try {
      await declare.beginTransaction();
      await declare.execute('SELECT id FROM ward WHERE id = ? FOR UPDATE', [w.psW1]);
      const create = ro.post('/entries', psW1Sheet(w, w.b1));
      await sleep(300);
      await declare.rollback();
      expect((await create).status).toBe(201);
    } finally {
      declare.release();
    }
    // And a declare that starts after the entry sees it (entry committed before the lock was granted).
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM booth_entry WHERE ward_id = ?',
      [w.psW1],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
