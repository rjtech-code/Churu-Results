import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Role } from '../types/auth.js';

// Server-side authorization rules (CLAUDE.md): hiding a button is not security.
//   PS_RO: only PS ballots / PS wards of their own Panchayat Samiti.
//   ZP_RO: only ZP ballots / ZP wards (any Panchayat Samiti).
//   DM:    read-only, may read every ward, never writes.

export type BallotFor = 'PS' | 'ZP';

export interface AccessUser {
  role: Role;
  panchayatSamitiId: number | null;
}

export interface WardScope {
  wardType: BallotFor;
  /** The PS of a PS ward; NULL for ZP wards. */
  panchayatSamitiId: number | null;
}

type Db = Pool | PoolConnection;

// ---------------------------------------------------------------- pure rules

export function ballotWriteAllowed(
  user: AccessUser,
  boothPsId: number,
  ballotFor: BallotFor,
): boolean {
  switch (user.role) {
    case 'PS_RO':
      return (
        ballotFor === 'PS' &&
        user.panchayatSamitiId !== null &&
        user.panchayatSamitiId === boothPsId
      );
    case 'ZP_RO':
      return ballotFor === 'ZP';
    case 'DM':
      return false;
  }
}

export function wardWriteAllowed(user: AccessUser, ward: WardScope): boolean {
  switch (user.role) {
    case 'PS_RO':
      return (
        ward.wardType === 'PS' &&
        user.panchayatSamitiId !== null &&
        ward.panchayatSamitiId === user.panchayatSamitiId
      );
    case 'ZP_RO':
      return ward.wardType === 'ZP';
    case 'DM':
      return false;
  }
}

export function wardReadAllowed(user: AccessUser, ward: WardScope): boolean {
  switch (user.role) {
    case 'DM':
      return true;
    case 'PS_RO':
    case 'ZP_RO':
      return wardWriteAllowed(user, ward);
  }
}

// ---------------------------------------------------------------- with DB lookups

async function wardScope(db: Db, wardId: number): Promise<WardScope | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT ward_type, panchayat_samiti_id FROM ward WHERE id = ?',
    [wardId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    wardType: row.ward_type === 'PS' ? 'PS' : 'ZP',
    panchayatSamitiId: row.panchayat_samiti_id === null ? null : Number(row.panchayat_samiti_id),
  };
}

/** May this user enter/edit the given ballot (PS or ZP) of this booth? Unknown booth = no. */
export async function canWriteBallot(
  db: Db,
  user: AccessUser,
  boothId: number,
  ballotFor: BallotFor,
): Promise<boolean> {
  if (user.role === 'DM') return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT panchayat_samiti_id FROM booth WHERE id = ?',
    [boothId],
  );
  const row = rows[0];
  if (!row) return false;
  return ballotWriteAllowed(user, Number(row.panchayat_samiti_id), ballotFor);
}

/** May this user write ward-level data (postal ballots, declare)? Unknown ward = no. */
export async function canWriteWard(db: Db, user: AccessUser, wardId: number): Promise<boolean> {
  if (user.role === 'DM') return false;
  const scope = await wardScope(db, wardId);
  return scope !== null && wardWriteAllowed(user, scope);
}

/** May this user read this ward's internal data? Unknown ward = no. */
export async function canReadWard(db: Db, user: AccessUser, wardId: number): Promise<boolean> {
  const scope = await wardScope(db, wardId);
  return scope !== null && wardReadAllowed(user, scope);
}
