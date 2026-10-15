import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { addBoothEntry } from '../helpers/fixtures.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;

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
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

const REASON = 'Ward 2 mein ek naam galat chhapa tha';
const unlockBody = (area: string) => ({
  area,
  reason: REASON,
  confirmText: 'UNLOCK',
  password: PASSWORD,
});
const wardRow = async (id: number) => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT is_locked, locked_at, candidates_ready_at FROM ward WHERE id = ?',
    [id],
  );
  return rows[0];
};
const candidateRows = async () => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM candidate ORDER BY id');
  return JSON.stringify(rows);
};

describe('DM ballot unlock', () => {
  it('unlocks a PS without entries, clears the ready mark, audits, and can be locked again', async () => {
    // ps2: psW2 locked with candidates, no entries. Mark it ready so the reset is visible.
    await pool.execute(
      'UPDATE ward SET candidates_ready_at = NOW(3), candidates_ready_by = ? WHERE id = ?',
      [w.users.ro2, w.psW2],
    );
    const candidatesBefore = await candidateRows();

    const res = await dm.post('/api/admin/unlock', unlockBody(`PS:${w.ps2}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlocked: [w.psW2] });

    const row = await wardRow(w.psW2);
    expect(Number(row?.is_locked)).toBe(0);
    expect(row?.locked_at).toBeNull();
    expect(row?.candidates_ready_at).toBeNull();
    expect(await candidateRows()).toBe(candidatesBefore);

    const audit = await auditOf(pool, 'BALLOT_UNLOCK');
    expect(audit).toHaveLength(1);
    expect(Number(audit[0]?.user_id)).toBe(w.users.dm);
    expect(audit[0]?.reason).toBe(REASON);
    expect(audit[0]?.new_value).toMatchObject({
      via: 'web',
      scope: `PS:${w.ps2}`,
      unlocked_ward_ids: [w.psW2],
    });

    // The existing lock flow works again.
    const lock = await dm.post('/api/admin/lock', {
      area: `PS:${w.ps2}`,
      confirmText: 'LOCK',
      expectedWardIds: [w.psW2],
      password: PASSWORD,
    });
    expect(lock.status).toBe(200);
    expect(Number((await wardRow(w.psW2))?.is_locked)).toBe(1);
  });

  it('refuses with 409 when any ward of the area has an active entry; nothing changes', async () => {
    // psW1 (ps1) has an entry; psW3 (also ps1, locked) has none: the whole PS is refused.
    await addBoothEntry(pool, w.b1, 'PS', w.psW1, w.users.ro1);
    const before = await masterSnapshot(pool);

    const res = await dm.post('/api/admin/unlock', unlockBody(`PS:${w.ps1}`));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'UNLOCK_COUNTING_STARTED' });
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await auditOf(pool, 'BALLOT_UNLOCK')).toHaveLength(0);
  });

  it('a PS RO gets 403', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const before = await masterSnapshot(pool);
    const res = await ro.post('/api/admin/unlock', unlockBody(`PS:${w.ps1}`));
    expect(res.status).toBe(403);
    expect(await masterSnapshot(pool)).toBe(before);
  });
});
