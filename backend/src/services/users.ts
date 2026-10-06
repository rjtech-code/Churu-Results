import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser, Role } from '../types/auth.js';

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
  panchayat_samiti_id: number | null;
  ps_name: string | null;
  is_active: number;
}

/** The active user with this id, or null if it does not exist or is disabled. */
export async function loadActiveUser(
  db: Pool | PoolConnection,
  userId: number,
): Promise<AuthUser | null> {
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.username, u.full_name, u.role, u.panchayat_samiti_id, ps.name_hindi AS ps_name, u.is_active
       FROM users u LEFT JOIN panchayat_samiti ps ON ps.id = u.panchayat_samiti_id
      WHERE u.id = ?`,
    [userId],
  );
  const row = rows[0];
  if (row?.is_active !== 1) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    panchayatSamitiId: row.panchayat_samiti_id,
    panchayatSamitiName: row.ps_name,
  };
}

/** Public shape of the logged-in user (GET /api/auth/me and the login response). */
export function meBody(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    panchayatSamiti:
      user.panchayatSamitiId === null
        ? null
        : { id: user.panchayatSamitiId, name: user.panchayatSamitiName ?? '' },
  };
}
