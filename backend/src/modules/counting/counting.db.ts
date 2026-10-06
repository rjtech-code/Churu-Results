// Small database helpers for counting. Every write goes through withWriteTransaction, and every
// write locks the WARD ROW first (lockWard) — see README "Lock order".
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import type { BallotCandidate } from '../../services/entry-rules.js';

export type Db = Pool | PoolConnection;

export async function withWriteTransaction<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      const value = await work(conn);
      await conn.commit();
      return value;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    conn.release();
  }
}

export interface WardState {
  id: number;
  wardType: 'PS' | 'ZP';
  panchayatSamitiId: number | null;
  isLocked: boolean;
  isUnopposed: boolean;
}

/**
 * Reads the ward row; with forUpdate it takes the ward lock (always the FIRST lock of a counting
 * write; Part 6 declare takes the same lock first). 404 if the ward does not exist.
 */
export async function readWard(conn: Db, wardId: number, forUpdate: boolean): Promise<WardState> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    forUpdate
      ? 'SELECT id, ward_type, panchayat_samiti_id, is_locked, is_unopposed FROM ward WHERE id = ? FOR UPDATE'
      : 'SELECT id, ward_type, panchayat_samiti_id, is_locked, is_unopposed FROM ward WHERE id = ?',
    [wardId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(row.id),
    wardType: row.ward_type === 'ZP' ? 'ZP' : 'PS',
    panchayatSamitiId: row.panchayat_samiti_id === null ? null : Number(row.panchayat_samiti_id),
    isLocked: Number(row.is_locked) === 1,
    isUnopposed: Number(row.is_unopposed) === 1,
  };
}

/** Counting data may change only on a locked, contested, undeclared ward. */
export async function assertWardOpenForCounting(conn: Db, ward: WardState): Promise<void> {
  if (ward.isUnopposed) throw new ApiError(409, 'WARD_UNOPPOSED');
  if (!ward.isLocked) throw new ApiError(409, 'BALLOT_NOT_LOCKED');
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT 1 AS x FROM ward_declarations WHERE ward_id = ? LIMIT 1',
    [ward.id],
  );
  if (rows.length > 0) throw new ApiError(409, 'WARD_DECLARED');
}

/** The ward's candidates in ballot order (NOTA included), looked up from the DB, never the client. */
export async function readBallot(conn: Db, wardId: number): Promise<BallotCandidate[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT c.id, c.ballot_position, c.name_hindi, c.is_nota, p.short_name
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id
      WHERE c.ward_id = ? ORDER BY c.ballot_position`,
    [wardId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    ballotPosition: Number(r.ballot_position),
    nameHindi: String(r.name_hindi),
    isNota: Number(r.is_nota) === 1,
    partyShortName: r.short_name === null ? null : String(r.short_name),
  }));
}

export interface BoothRow {
  id: number;
  panchayatSamitiId: number;
  psWardId: number;
  zpWardId: number;
  registeredVotersTotal: number | null;
}

export async function readBooth(conn: Db, boothId: number): Promise<BoothRow> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT id, panchayat_samiti_id, ps_ward_id, zp_ward_id, registered_voters_total FROM booth WHERE id = ?',
    [boothId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(row.id),
    panchayatSamitiId: Number(row.panchayat_samiti_id),
    psWardId: Number(row.ps_ward_id),
    zpWardId: Number(row.zp_ward_id),
    registeredVotersTotal:
      row.registered_voters_total === null ? null : Number(row.registered_voters_total),
  };
}

export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ER_DUP_ENTRY';
}
