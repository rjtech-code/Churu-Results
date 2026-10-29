// The Super Admin's "Counting Lock" (गिनती लॉक). While ON, the panel's dangerous actions (test-data
// reset, master-data replace, booth add/delete) are refused for everyone, on the server. One
// app_settings row; no row = OFF.
import type { Connection, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';

export const COUNTING_LOCK_KEY = 'counting_lock';

export async function isCountingLocked(db: Pool | Connection): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [COUNTING_LOCK_KEY],
  );
  return rows[0] !== undefined && String(rows[0].setting_value) === 'on';
}

/** 423 COUNTING_LOCKED while the lock is ON. */
export async function assertCountingUnlocked(db: Pool | Connection): Promise<void> {
  if (await isCountingLocked(db)) throw new ApiError(423, 'COUNTING_LOCKED');
}

/** Writes the lock (inside the caller's transaction). */
export async function writeCountingLock(conn: PoolConnection, on: boolean): Promise<void> {
  await conn.execute(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [COUNTING_LOCK_KEY, on ? 'on' : 'off'],
  );
}
