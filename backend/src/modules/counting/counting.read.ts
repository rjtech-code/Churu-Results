// Read endpoints for the counting screens. Every read is scoped to what the user may write:
// PS_RO only its own PS wards / PS ballots, ZP_RO only ZP wards / ZP ballots.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteBallot, canWriteWard } from '../../services/access.js';
import { loadWardResults } from '../../services/result-loader.js';
import type { ResultStatus } from '../../services/result.js';
import type { AuthUser } from '../../types/auth.js';
import { readBallot, readWard } from './counting.db.js';

export interface WardListItem {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  panchayatSamiti: { id: number; name: string } | null;
  ballotLocked: boolean;
  isUnopposed: boolean;
  status: ResultStatus | 'NO_CANDIDATES';
  boothsEntered: number;
  boothsTotal: number;
  postalEntered: boolean;
}

/** PS_RO: PS wards of its own PS. ZP_RO: all ZP wards. One batched result load for the whole list. */
export async function listWards(pool: Pool, user: AuthUser): Promise<WardListItem[]> {
  const select = `SELECT w.id, w.ward_type, w.ward_no, w.panchayat_samiti_id, ps.name_hindi AS ps_name, w.is_locked,
                         w.is_unopposed, (SELECT COUNT(*) FROM candidate c WHERE c.ward_id = w.id) AS candidates,
                         (SELECT COUNT(*) FROM booth b WHERE b.ps_ward_id = w.id OR b.zp_ward_id = w.id) AS booths
                    FROM ward w LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id`;
  const [rows] =
    user.role === 'PS_RO'
      ? await pool.execute<RowDataPacket[]>(
          `${select} WHERE w.ward_type = 'PS' AND w.panchayat_samiti_id = ? ORDER BY w.ward_no`,
          [user.panchayatSamitiId ?? 0],
        )
      : await pool.execute<RowDataPacket[]>(
          `${select} WHERE w.ward_type = 'ZP' ORDER BY w.ward_no`,
          [],
        );

  const withCandidates = rows.filter((r) => Number(r.candidates) > 0).map((r) => Number(r.id));
  const results = await loadWardResults(pool, withCandidates);
  return rows.map((r) => {
    const id = Number(r.id);
    const result = results.get(id);
    return {
      id,
      kind: r.ward_type === 'ZP' ? 'ZP' : 'PS',
      wardNo: Number(r.ward_no),
      panchayatSamiti:
        r.panchayat_samiti_id === null
          ? null
          : { id: Number(r.panchayat_samiti_id), name: String(r.ps_name) },
      ballotLocked: Number(r.is_locked) === 1,
      isUnopposed: Number(r.is_unopposed) === 1,
      status: result?.status ?? 'NO_CANDIDATES',
      boothsEntered: result?.boothsEntered ?? 0,
      boothsTotal: result?.boothsTotal ?? Number(r.booths),
      postalEntered: result?.postalEntered ?? false,
    };
  });
}

/** 404 for an unknown ward, 403 for a ward the user may not work on. */
async function authorizeWardRead(pool: Pool, user: AuthUser, wardId: number) {
  const ward = await readWard(pool, wardId, false);
  if (!(await canWriteWard(pool, user, wardId))) throw new ApiError(403, 'FORBIDDEN');
  return ward;
}

export async function listBooths(pool: Pool, user: AuthUser, wardId: number) {
  const ward = await authorizeWardRead(pool, user, wardId);
  const columns = `SELECT b.id, ps.name_hindi AS ps_name, b.booth_no, b.name_hindi, b.registered_voters_total,
                          e.id AS entry_id, e.round_no, e.entered_at
                     FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id`;
  const [rows] =
    ward.wardType === 'PS'
      ? await pool.execute<RowDataPacket[]>(
          `${columns} LEFT JOIN booth_entry e ON e.booth_id = b.id AND e.ballot_for = 'PS'
            WHERE b.ps_ward_id = ? ORDER BY ps.name_hindi, b.booth_no`,
          [wardId],
        )
      : await pool.execute<RowDataPacket[]>(
          `${columns} LEFT JOIN booth_entry e ON e.booth_id = b.id AND e.ballot_for = 'ZP'
            WHERE b.zp_ward_id = ? ORDER BY ps.name_hindi, b.booth_no`,
          [wardId],
        );
  const [postal] = await pool.execute<RowDataPacket[]>(
    'SELECT id, entered_at FROM postal_entry WHERE ward_id = ?',
    [wardId],
  );
  const p = postal[0];
  return {
    booths: rows.map((r) => ({
      boothId: Number(r.id),
      panchayatSamiti: String(r.ps_name),
      boothNo: Number(r.booth_no),
      nameHindi: String(r.name_hindi),
      registeredVotersTotal:
        r.registered_voters_total === null ? null : Number(r.registered_voters_total),
      entered: r.entry_id !== null,
      entryId: r.entry_id === null ? null : Number(r.entry_id),
      roundNo: r.round_no === null ? null : Number(r.round_no),
      enteredAt: (r.entered_at as Date | null) ?? null,
    })),
    postal:
      p === undefined
        ? { entered: false, entryId: null, enteredAt: null }
        : { entered: true, entryId: Number(p.id), enteredAt: p.entered_at as Date },
  };
}

export async function wardBallot(pool: Pool, user: AuthUser, wardId: number) {
  await authorizeWardRead(pool, user, wardId);
  return (await readBallot(pool, wardId)).map((c) => ({
    candidateId: c.id,
    ballotPosition: c.ballotPosition,
    nameHindi: c.nameHindi,
    partyShortName: c.partyShortName,
    isNota: c.isNota,
  }));
}

async function userRef(pool: Pool, userId: number | null) {
  if (userId === null) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, username, full_name FROM users WHERE id = ?',
    [userId],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        username: String(r.username),
        fullName: r.full_name === null ? null : String(r.full_name),
      }
    : null;
}

async function voteRows(pool: Pool, kind: 'BOOTH' | 'POSTAL', entryId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    kind === 'BOOTH'
      ? `SELECT v.candidate_id, v.votes FROM booth_entry_vote v JOIN candidate c ON c.id = v.candidate_id
          WHERE v.entry_id = ? ORDER BY c.ballot_position`
      : `SELECT v.candidate_id, v.votes FROM postal_entry_vote v JOIN candidate c ON c.id = v.candidate_id
          WHERE v.entry_id = ? ORDER BY c.ballot_position`,
    [entryId],
  );
  return rows.map((r) => ({ candidateId: Number(r.candidate_id), votes: Number(r.votes) }));
}

/** One live booth entry, for the edit form (no permission check: callers check first). */
export async function boothEntryView(pool: Pool, entryId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, ward_id, booth_id, ballot_for, round_no, sheet_total, row_version, entered_by, entered_at,
            updated_by, updated_at FROM booth_entry WHERE id = ?`,
    [entryId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(r.id),
    kind: 'BOOTH' as const,
    wardId: Number(r.ward_id),
    boothId: Number(r.booth_id),
    ballotFor: r.ballot_for === 'ZP' ? ('ZP' as const) : ('PS' as const),
    roundNo: Number(r.round_no),
    sheetTotal: Number(r.sheet_total),
    rowVersion: Number(r.row_version),
    enteredBy: await userRef(pool, Number(r.entered_by)),
    enteredAt: r.entered_at as Date,
    updatedBy: await userRef(pool, r.updated_by === null ? null : Number(r.updated_by)),
    updatedAt: (r.updated_at as Date | null) ?? null,
    votes: await voteRows(pool, 'BOOTH', entryId),
  };
}

export async function postalEntryView(pool: Pool, entryId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, ward_id, sheet_total, rejected_count, row_version, entered_by, entered_at, updated_by, updated_at
       FROM postal_entry WHERE id = ?`,
    [entryId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(r.id),
    kind: 'POSTAL' as const,
    wardId: Number(r.ward_id),
    sheetTotal: Number(r.sheet_total),
    rejectedCount: r.rejected_count === null ? null : Number(r.rejected_count),
    rowVersion: Number(r.row_version),
    enteredBy: await userRef(pool, Number(r.entered_by)),
    enteredAt: r.entered_at as Date,
    updatedBy: await userRef(pool, r.updated_by === null ? null : Number(r.updated_by)),
    updatedAt: (r.updated_at as Date | null) ?? null,
    votes: await voteRows(pool, 'POSTAL', entryId),
  };
}

/** Booth entry for a user who may work on it (403 otherwise). */
export async function getBoothEntry(pool: Pool, user: AuthUser, entryId: number) {
  const entry = await boothEntryView(pool, entryId);
  if (!(await canWriteBallot(pool, user, entry.boothId, entry.ballotFor)))
    throw new ApiError(403, 'FORBIDDEN');
  return entry;
}

export async function getPostalEntry(pool: Pool, user: AuthUser, entryId: number) {
  const entry = await postalEntryView(pool, entryId);
  if (!(await canWriteWard(pool, user, entry.wardId))) throw new ApiError(403, 'FORBIDDEN');
  return entry;
}

/**
 * Audit history of an entry, also after it was voided (ownership is then taken from the archive).
 */
export async function entryHistory(
  pool: Pool,
  user: AuthUser,
  kind: 'BOOTH' | 'POSTAL',
  entryId: number,
) {
  const [live] = await pool.execute<RowDataPacket[]>(
    kind === 'BOOTH'
      ? 'SELECT ward_id, booth_id, ballot_for FROM booth_entry WHERE id = ?'
      : 'SELECT ward_id, NULL AS booth_id, NULL AS ballot_for FROM postal_entry WHERE id = ?',
    [entryId],
  );
  const [archived] = await pool.execute<RowDataPacket[]>(
    'SELECT ward_id, booth_id, ballot_for FROM voided_entry WHERE entry_kind = ? AND original_entry_id = ?',
    [kind, entryId],
  );
  const owner = live[0] ?? archived[0];
  if (!owner) throw new ApiError(404, 'NOT_FOUND');
  const allowed =
    kind === 'BOOTH'
      ? await canWriteBallot(
          pool,
          user,
          Number(owner.booth_id),
          owner.ballot_for === 'ZP' ? 'ZP' : 'PS',
        )
      : await canWriteWard(pool, user, Number(owner.ward_id));
  if (!allowed) throw new ApiError(403, 'FORBIDDEN');

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.action, a.created_at, a.old_value, a.new_value, a.reason, u.username, u.full_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id`,
    [kind === 'BOOTH' ? 'booth_entry' : 'postal_entry', entryId],
  );
  return rows.map((r) => ({
    action: String(r.action),
    at: r.created_at as Date,
    user:
      r.username === null
        ? null
        : {
            username: String(r.username),
            fullName: r.full_name === null ? null : String(r.full_name),
          },
    oldValue: r.old_value as unknown,
    newValue: r.new_value as unknown,
    reason: r.reason === null ? null : String(r.reason),
  }));
}
