import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { matchKey } from './text.js';

export interface PsRow {
  id: number;
  name_english: string;
  name_hindi: string;
}

/** Panchayat Samitis keyed by case-insensitive English name. */
export async function loadPanchayatSamitis(
  conn: Pool | PoolConnection,
): Promise<Map<string, PsRow>> {
  const [rows] = await conn.query<(PsRow & RowDataPacket)[]>(
    'SELECT id, name_english, name_hindi FROM panchayat_samiti ORDER BY name_english',
  );
  return new Map(rows.map((r) => [matchKey(r.name_english), r]));
}

export interface WardRow {
  id: number;
  ward_type: 'PS' | 'ZP';
  panchayat_samiti_id: number | null;
  ps_name: string | null;
  /** Short Hindi PS name (for Hindi messages); NULL for ZP wards. */
  ps_name_hindi: string | null;
  ward_no: number;
  is_locked: number;
  is_unopposed: number;
  reservation_category: string | null;
  /** 1 when the RO (or a DM upload) marked the candidate list as ready (Part 13). */
  candidates_ready: number;
}

export async function loadWards(conn: Pool | PoolConnection): Promise<WardRow[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT w.id, w.ward_type, w.panchayat_samiti_id, ps.name_english AS ps_name,
            ps.name_hindi AS ps_name_hindi, w.ward_no, w.is_locked, w.is_unopposed,
            w.reservation_category, (w.candidates_ready_at IS NOT NULL) AS candidates_ready
       FROM ward w
       LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id
      ORDER BY w.ward_type, ps.name_english, w.ward_no`,
  );
  // A SQL boolean arrives as a BIGINT (string from the pool): normalise it.
  return rows.map((r) => ({
    id: Number(r.id),
    ward_type: r.ward_type === 'ZP' ? 'ZP' : 'PS',
    panchayat_samiti_id: r.panchayat_samiti_id === null ? null : Number(r.panchayat_samiti_id),
    ps_name: r.ps_name === null ? null : String(r.ps_name),
    ps_name_hindi: r.ps_name_hindi === null ? null : String(r.ps_name_hindi),
    ward_no: Number(r.ward_no),
    is_locked: Number(r.is_locked),
    is_unopposed: Number(r.is_unopposed),
    reservation_category: r.reservation_category === null ? null : String(r.reservation_category),
    candidates_ready: Number(r.candidates_ready),
  }));
}

export function wardKey(type: 'PS' | 'ZP', psId: number | null, wardNo: number): string {
  return type === 'PS' ? `PS|${psId ?? 0}|${wardNo}` : `ZP|${wardNo}`;
}

/** Human-readable ward name used in reports, with the id needed by ballot:lock/unlock. */
export function wardLabel(w: Pick<WardRow, 'id' | 'ward_type' | 'ps_name' | 'ward_no'>): string {
  return w.ward_type === 'PS'
    ? `PS ward ${w.ward_no} of ${w.ps_name ?? '?'} (ward id ${w.id})`
    : `ZP ward ${w.ward_no} (ward id ${w.id})`;
}

/** Ward ids that already have counting data (booth or postal entries). */
export async function wardsWithEntries(conn: Pool | PoolConnection): Promise<Set<number>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT ward_id FROM booth_entry UNION SELECT ward_id FROM postal_entry',
  );
  return new Set(rows.map((r) => Number(r.ward_id)));
}

/** One ward (or null). Use after the ward row is locked FOR UPDATE to read its latest values. */
export async function loadWard(
  conn: Pool | PoolConnection,
  wardId: number,
): Promise<WardRow | null> {
  return (await loadWards(conn)).find((w) => w.id === wardId) ?? null;
}

/** Locks ward rows FOR UPDATE in ascending id order (the same first lock as counting writes). */
export async function lockWardRows(conn: PoolConnection, wardIds: Iterable<number>): Promise<void> {
  for (const id of [...new Set(wardIds)].sort((a, b) => a - b)) {
    await conn.execute('SELECT id FROM ward WHERE id = ? FOR UPDATE', [id]);
  }
}

/** True when the ward has any booth or postal entry. */
export async function wardHasEntries(db: Pool | PoolConnection, wardId: number): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS x FROM booth_entry WHERE ward_id = ?
     UNION ALL SELECT 1 FROM postal_entry WHERE ward_id = ? LIMIT 1`,
    [wardId, wardId],
  );
  return rows.length > 0;
}
