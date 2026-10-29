import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { Role } from '../master-data/accounts.js';

export { ROLES, ROLE_LIMITS, USERNAME_PATTERN } from '../master-data/accounts.js';
export type { Role } from '../master-data/accounts.js';

export interface UserRow {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
  panchayat_samiti_id: number | null;
  ps_name: string | null;
  is_active: number;
  last_login_at: Date | null;
}

export async function findUser(conn: PoolConnection, username: string): Promise<UserRow | null> {
  const [rows] = await conn.execute<(UserRow & RowDataPacket)[]>(
    `SELECT u.id, u.username, u.full_name, u.role, u.panchayat_samiti_id, ps.name_english AS ps_name,
            u.is_active, u.last_login_at
       FROM users u LEFT JOIN panchayat_samiti ps ON ps.id = u.panchayat_samiti_id
      WHERE u.username = ?`,
    [username],
  );
  return rows[0] ?? null;
}

/** Shown once on the terminal. Never written to a report, log, file or the audit log. */
export function passwordBanner(username: string, password: string): string {
  const line = '='.repeat(68);
  return [
    '',
    line,
    `  NEW PASSWORD for "${username}" — shown ONCE, it is NOT saved anywhere:`,
    '',
    `      ${password}`,
    '',
    '  Hand it to the officer in person. Do not send it by message or email.',
    '  If it is lost, run npm run users:reset-password for a new one.',
    line,
    '',
  ].join('\n');
}
