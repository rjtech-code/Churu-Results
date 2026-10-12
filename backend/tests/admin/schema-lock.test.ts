import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MASTER_DATA_LOCK } from '../../src/services/master-data/lock.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { adminApp, apiClient, buildAdminWorld } from './helpers.js';
import type { AdminWorld } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;

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
  w = await buildAdminWorld(pool);
});

describe('candidate-list status columns', () => {
  it('ready time and ready-by go together; an empty return reason is refused', async () => {
    await expect(
      pool.execute('UPDATE ward SET candidates_ready_at = NOW(3) WHERE id = ?', [w.psW5]),
    ).rejects.toThrow(/chk_ward_candidates_ready/);
    await expect(
      pool.execute('UPDATE ward SET candidates_ready_by = ? WHERE id = ?', [w.users.ro1, w.psW5]),
    ).rejects.toThrow(/chk_ward_candidates_ready/);
    await expect(
      pool.execute("UPDATE ward SET candidates_return_reason = '  ' WHERE id = ?", [w.psW5]),
    ).rejects.toThrow(/chk_ward_return_reason/);
  });
});

describe('master-data lock', () => {
  it('while a CLI script holds the lock, a web change waits, then answers MASTER_DATA_BUSY', async () => {
    const holder = await migrator.getConnection();
    try {
      const [got] = await holder.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [
        MASTER_DATA_LOCK,
      ]);
      expect(Number(got[0]?.got)).toBe(1);
      const ro = await apiClient(adminApp(pool), 'ro_ps1_x1');
      const res = await ro.put(`/api/candidates/wards/${w.psW5}`, {
        candidates: [{ ballotPosition: 1, nameHindi: 'राम', partyId: null, gender: 'M' }],
      });
      expect([res.status, res.body]).toEqual([409, { error: 'MASTER_DATA_BUSY' }]);
    } finally {
      await holder.query('SELECT RELEASE_LOCK(?)', [MASTER_DATA_LOCK]);
      holder.release();
    }
  });
});
