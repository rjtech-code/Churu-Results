// Reads what buildZpPsProgress (counting-status.ts, the ONE builder) needs for the RO pages: one ZP
// ward, or every ZP ward, in one read-only snapshot. Booth and entry counts only, never votes.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { buildZpPsProgress } from './counting-status.js';
import type { ZpWardPsProgress } from './counting-status.js';
import { withReadOnlySnapshot } from './result-loader.js';

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toDateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : toDate(v);

/** `wardId` null = every ZP ward. An unknown or PS ward gives an empty list. */
export async function loadZpPsProgress(
  pool: Pool,
  wardId: number | null,
): Promise<ZpWardPsProgress[]> {
  const one = wardId !== null;
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const [ps] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name_english FROM panchayat_samiti',
    );
    const [wards] = await conn.execute<RowDataPacket[]>(
      one
        ? "SELECT id, ward_no, is_unopposed FROM ward WHERE ward_type = 'ZP' AND id = ?"
        : "SELECT id, ward_no, is_unopposed FROM ward WHERE ward_type = 'ZP'",
      one ? [wardId] : [],
    );
    const [booths] = await conn.execute<RowDataPacket[]>(
      one
        ? 'SELECT id, panchayat_samiti_id, zp_ward_id FROM booth WHERE zp_ward_id = ?'
        : 'SELECT id, panchayat_samiti_id, zp_ward_id FROM booth',
      one ? [wardId] : [],
    );
    const [entries] = await conn.execute<RowDataPacket[]>(
      one
        ? "SELECT booth_id, round_no, entered_at, updated_at FROM booth_entry WHERE ballot_for = 'ZP' AND ward_id = ?"
        : "SELECT booth_id, round_no, entered_at, updated_at FROM booth_entry WHERE ballot_for = 'ZP'",
      one ? [wardId] : [],
    );
    const [postal] = await conn.execute<RowDataPacket[]>(
      one
        ? 'SELECT ward_id, entered_at, updated_at FROM postal_entry WHERE ward_id = ?'
        : 'SELECT ward_id, entered_at, updated_at FROM postal_entry',
      one ? [wardId] : [],
    );
    const [assignments] = await conn.execute<RowDataPacket[]>(
      one
        ? 'SELECT zp_ward_id, ps_id FROM zp_ward_postal_assignment WHERE zp_ward_id = ?'
        : 'SELECT zp_ward_id, ps_id FROM zp_ward_postal_assignment',
      one ? [wardId] : [],
    );
    return { ps, wards, booths, entries, postal, assignments };
  });

  return buildZpPsProgress({
    ps: read.ps.map((p) => ({ id: Number(p.id), nameEnglish: String(p.name_english) })),
    wards: read.wards.map((w) => ({
      id: Number(w.id),
      kind: 'ZP' as const,
      wardNo: Number(w.ward_no),
      isUnopposed: Number(w.is_unopposed) === 1,
    })),
    booths: read.booths.map((b) => ({
      id: Number(b.id),
      psId: Number(b.panchayat_samiti_id),
      zpWardId: Number(b.zp_ward_id),
    })),
    entries: read.entries.map((e) => ({
      boothId: Number(e.booth_id),
      ballotFor: 'ZP' as const,
      roundNo: Number(e.round_no),
      enteredAt: toDate(e.entered_at),
      updatedAt: toDateOrNull(e.updated_at),
    })),
    postal: read.postal.map((p) => ({
      wardId: Number(p.ward_id),
      enteredAt: toDate(p.entered_at),
      updatedAt: toDateOrNull(p.updated_at),
    })),
    postalAssignments: read.assignments.map((a) => ({
      wardId: Number(a.zp_ward_id),
      psId: Number(a.ps_id),
    })),
  });
}

/** A PS_RO's view of a ZP ward's progress: its own PS row and the postal row, nothing else. */
export function forPsRo(progress: ZpWardPsProgress, psId: number): ZpWardPsProgress {
  return { ...progress, rows: progress.rows.filter((r) => r.psId === psId) };
}
