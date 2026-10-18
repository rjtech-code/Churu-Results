// The election date printed on the official forms (Prarup-7 "निर्वाचन की तारीख"). Kept in
// app_settings; no row or an empty value = not set yet, and the form prints the cell blank.
// Only the DM changes it (/api/admin/settings/election-date), with an audit entry.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { ApiError } from '../middleware/errors.js';
import { writeAudit } from './audit.js';
import { calendarDate } from './master-data/candidate-age.js';
import { withMasterDataWrite } from './master-data/lock.js';

export const ELECTION_DATE_KEY = 'election_date';

/** A real YYYY-MM-DD calendar date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    return calendarDate(y ?? 0, m ?? 0, d ?? 0) === v;
  }, 'not a real date');

/** The date (YYYY-MM-DD) or null when not set. */
export async function readElectionDate(db: Pool | PoolConnection): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [ELECTION_DATE_KEY],
  );
  const value = rows[0] === undefined ? '' : String(rows[0].setting_value);
  return isoDate.safeParse(value).success ? value : null;
}

/**
 * Sets (YYYY-MM-DD) or clears (null) the date, under the master-data lock (a busy lock throws
 * MasterDataBusyError). 409 NO_CHANGE when it is already that value.
 */
export async function setElectionDate(
  pool: Pool,
  who: { userId: number; ip: string | null },
  date: string | null,
): Promise<void> {
  await withMasterDataWrite(pool, async (conn) => {
    const before = await readElectionDate(conn);
    if (before === date) throw new ApiError(409, 'NO_CHANGE');
    await conn.execute(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [ELECTION_DATE_KEY, date ?? ''],
    );
    await writeAudit(conn, {
      userId: who.userId,
      action: 'SETTING_CHANGED',
      entity: 'app_settings',
      entityId: null,
      oldValue: { [ELECTION_DATE_KEY]: before },
      newValue: { [ELECTION_DATE_KEY]: date },
      ip: who.ip,
    });
  });
}
