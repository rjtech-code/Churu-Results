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
  ward_no: number;
  is_locked: number;
  is_unopposed: number;
  reservation_category: string | null;
}

export async function loadWards(conn: Pool | PoolConnection): Promise<WardRow[]> {
  const [rows] = await conn.query<(WardRow & RowDataPacket)[]>(
    `SELECT w.id, w.ward_type, w.panchayat_samiti_id, ps.name_english AS ps_name, w.ward_no,
            w.is_locked, w.is_unopposed, w.reservation_category
       FROM ward w
       LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id
      ORDER BY w.ward_type, ps.name_english, w.ward_no`,
  );
  return rows;
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
