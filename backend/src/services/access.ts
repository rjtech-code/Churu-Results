import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Role } from '../types/auth.js';

// Server-side authorization rules (CLAUDE.md): hiding a button is not security.
//   PS_RO: PS and ZP booth ballots of booths in their own Panchayat Samiti (one parchi carries
//          both); postal ballots of the PS wards of their own PS and of the ZP wards ASSIGNED to
//          their PS (zp_ward_postal_assignment); declare / correction only on PS wards of own PS.
//   ZP_RO: no booth or postal entry at all; reads ZP wards, declares and corrects them.
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

/** Booth sheets, PS and ZP ballot alike (one parchi carries both): only the booth's own PS_RO. */
export function ballotWriteAllowed(user: AccessUser, boothPsId: number): boolean {
  switch (user.role) {
    case 'PS_RO':
      return user.panchayatSamitiId !== null && user.panchayatSamitiId === boothPsId;
    case 'ZP_RO': // official order: the ZP RO enters no booth sheet (PS ROs enter both ballots)
    case 'DM':
    case 'SUPER_ADMIN':
      return false;
  }
}

/**
 * Ward-level work that is not data entry: declare, lottery, correction, candidate lists.
 * PS_RO: PS wards of its own PS. ZP_RO: ZP wards.
 */
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
    case 'SUPER_ADMIN':
      return false;
  }
}

export function wardReadAllowed(user: AccessUser, ward: WardScope): boolean {
  switch (user.role) {
    case 'DM':
      return true;
    case 'SUPER_ADMIN':
      return false;
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

/** May this user enter/edit a ballot (PS or ZP) of this booth? Unknown booth = no. */
export async function canWriteBallot(db: Db, user: AccessUser, boothId: number): Promise<boolean> {
  if (user.role === 'DM' || user.role === 'SUPER_ADMIN') return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT panchayat_samiti_id FROM booth WHERE id = ?',
    [boothId],
  );
  const row = rows[0];
  if (!row) return false;
  return ballotWriteAllowed(user, Number(row.panchayat_samiti_id));
}

/** May this user do ward-level work (declare, correction, candidates)? Unknown ward = no. */
export async function canWriteWard(db: Db, user: AccessUser, wardId: number): Promise<boolean> {
  if (user.role === 'DM' || user.role === 'SUPER_ADMIN') return false;
  const scope = await wardScope(db, wardId);
  return scope !== null && wardWriteAllowed(user, scope);
}

/** May this user read this ward's internal data? Unknown ward = no. */
export async function canReadWard(db: Db, user: AccessUser, wardId: number): Promise<boolean> {
  const scope = await wardScope(db, wardId);
  return scope !== null && wardReadAllowed(user, scope);
}

/**
 * Pure postal rule. PS ward: the PS_RO of that PS. ZP ward: only the PS_RO of the assigned PS
 * (`assignedPsId`, null = not assigned yet: nobody). The ZP_RO, DM and Super Admin never.
 */
export function postalWriteAllowed(
  user: AccessUser,
  ward: WardScope,
  assignedPsId: number | null,
): boolean {
  if (user.role !== 'PS_RO' || user.panchayatSamitiId === null) return false;
  return ward.wardType === 'PS'
    ? ward.panchayatSamitiId === user.panchayatSamitiId
    : assignedPsId === user.panchayatSamitiId;
}

/** The PS assigned to enter this ZP ward's postal ballots; null when none (or not a ZP ward). */
export async function assignedPostalPs(db: Db, wardId: number): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT ps_id FROM zp_ward_postal_assignment WHERE zp_ward_id = ?',
    [wardId],
  );
  const row = rows[0];
  return row === undefined ? null : Number(row.ps_id);
}

/** May this user create / edit / void this ward's postal entry? Unknown ward = no. */
export async function canWritePostal(db: Db, user: AccessUser, wardId: number): Promise<boolean> {
  if (user.role !== 'PS_RO') return false;
  const scope = await wardScope(db, wardId);
  if (scope === null) return false;
  const assigned = scope.wardType === 'ZP' ? await assignedPostalPs(db, wardId) : null;
  return postalWriteAllowed(user, scope, assigned);
}
