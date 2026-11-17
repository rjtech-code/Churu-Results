// Per-screen ON / OFF for the three public TV screens (Super Admin panel). One app_settings row, the
// pattern the counting lock and the screen layout already use; no row = every screen ON, so nothing
// changes until the DEO turns one off.
//
// The value is the list of screens that are OFF, as JSON: ["2"]. Anything unreadable is treated as
// "no screen is off": a damaged setting must never black out the hall.
import type { Connection, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export const SCREEN_POWER_KEY = 'screens_off';

export const SCREEN_NUMBERS = ['1', '2', '3'] as const;
export type ScreenNumber = (typeof SCREEN_NUMBERS)[number];

export function isScreenNumber(value: string): value is ScreenNumber {
  return (SCREEN_NUMBERS as readonly string[]).includes(value);
}

/** The stored value -> the screens that are OFF. Unreadable or unknown entries are ignored. */
export function parseScreensOff(raw: string | null | undefined): ScreenNumber[] {
  if (raw === null || raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return SCREEN_NUMBERS.filter((n) => parsed.includes(n));
}

/** How it is stored: sorted, so the same state is always the same text (and the same updated_at). */
export function serializeScreensOff(off: readonly ScreenNumber[]): string {
  return JSON.stringify(SCREEN_NUMBERS.filter((n) => off.includes(n)));
}

export async function readScreensOff(db: Pool | Connection): Promise<ScreenNumber[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [SCREEN_POWER_KEY],
  );
  const row = rows[0];
  return parseScreensOff(row === undefined ? null : String(row.setting_value));
}

/**
 * Turns ONE screen on or off, leaving the other two exactly as they are, and returns the new list.
 * The caller owns the transaction (the audit row is written in the same one).
 */
export async function writeScreenPower(
  conn: PoolConnection,
  screen: ScreenNumber,
  on: boolean,
): Promise<ScreenNumber[]> {
  const before = await readScreensOff(conn);
  const after = on ? before.filter((n) => n !== screen) : [...new Set([...before, screen])];
  await conn.execute(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [SCREEN_POWER_KEY, serializeScreensOff(after)],
  );
  return SCREEN_NUMBERS.filter((n) => after.includes(n));
}
