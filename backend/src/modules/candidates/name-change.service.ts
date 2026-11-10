// "नाम सुधारें": the ONE change allowed to a candidate after the ward's ballot is locked (also while
// counting and after the ward is declared): the candidate's name. Everything else stays frozen.
//
//   who:   PS_RO for PS wards of its own PS, ZP_RO for ZP wards (canWriteWard, on the server).
//          DM and Super Admin never (403); the DM reads the history.
//   needs: the RO's own password again (requireReauth: bcrypt compare, a wrong password counts
//          toward the normal login lockout), a reason (10-500 characters), and the name the RO saw
//          (compare-and-set: two ROs can never overwrite each other silently).
//   one transaction: candidate UPDATE + candidate_name_change row + audit_log row, or nothing.
//
// Votes, entries and declarations point to candidate.id, which never changes here, so every screen,
// report and export shows the new name on its next read.
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteWard } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import { checkNewName } from '../../services/candidate-name.js';
import { istText } from '../../services/counting-status.js';
import { emitWardChanged } from '../../services/events.js';
import { wardRef } from '../../services/master-data/issues.js';
import { wardHi } from '../../services/master-data/issues-hi.js';
import { loadWard, lockWardRows } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import type { AuthUser } from '../../types/auth.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from '../admin/http.js';
import type { Actor } from '../admin/http.js';
import { toCsv } from '../reports/csv.js';

export interface NameCorrectionBody {
  /** The name the RO saw on screen (compare-and-set). */
  currentName: string;
  newName: string;
  reason: string;
  password: string;
}

export interface NameCorrectionResult {
  candidateId: number;
  oldName: string;
  nameHindi: string;
  changedAt: string;
}

interface CandidateRow {
  id: number;
  position: number;
  name: string;
}

async function readCandidate(
  db: Pool | PoolConnection,
  wardId: number,
  candidateId: number,
  forUpdate: boolean,
): Promise<CandidateRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    forUpdate
      ? 'SELECT id, ballot_position, name_hindi FROM candidate WHERE id = ? AND ward_id = ? AND is_nota = 0 FOR UPDATE'
      : 'SELECT id, ballot_position, name_hindi FROM candidate WHERE id = ? AND ward_id = ? AND is_nota = 0',
    [candidateId, wardId],
  );
  const r = rows[0];
  return r === undefined
    ? null
    : { id: Number(r.id), position: Number(r.ballot_position), name: String(r.name_hindi) };
}

function nameError(problem: string): ApiError {
  return problem === 'NAME_UNCHANGED' ? new ApiError(409, problem) : new ApiError(400, problem);
}

/**
 * Order of checks: role and ward scope (403/404, the password is never checked for someone who may
 * not do this), cheap state checks (so a useless request does not cost a password attempt), the
 * password, then everything again under the ward + candidate row locks inside the transaction.
 */
export async function correctCandidateName(
  pool: Pool,
  who: Actor,
  wardId: number,
  candidateId: number,
  body: NameCorrectionBody,
): Promise<NameCorrectionResult> {
  const role = who.user.role;
  if (role !== 'PS_RO' && role !== 'ZP_RO') throw new ApiError(403, 'FORBIDDEN');
  const ward = await loadWard(pool, wardId);
  if (!ward) throw new ApiError(404, 'NOT_FOUND');
  if (!(await canWriteWard(pool, who.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
  if (ward.is_locked !== 1) throw new ApiError(409, 'BALLOT_NOT_LOCKED');
  const seen = await readCandidate(pool, wardId, candidateId, false);
  if (!seen) throw new ApiError(404, 'NOT_FOUND');
  const precheck = checkNewName(body.newName, body.currentName);
  if (!precheck.ok) throw nameError(precheck.problem);
  if (seen.name !== body.currentName) {
    throw new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: seen.name });
  }

  await requireReauth(pool, who.user.id, body.password, who.ip);

  const reason = body.reason.trim();
  const byName = who.user.fullName ?? who.user.username;
  const out = await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      await lockWardRows(conn, [wardId]);
      const locked = await loadWard(conn, wardId);
      if (!locked) throw new ApiError(404, 'NOT_FOUND');
      if (!(await canWriteWard(conn, who.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
      if (locked.is_locked !== 1) throw new ApiError(409, 'BALLOT_NOT_LOCKED');
      const current = await readCandidate(conn, wardId, candidateId, true);
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      if (current.name !== body.currentName) {
        throw new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: current.name });
      }
      const check = checkNewName(body.newName, current.name);
      if (!check.ok) throw nameError(check.problem);

      const [upd] = await conn.execute<ResultSetHeader>(
        'UPDATE candidate SET name_hindi = ? WHERE id = ? AND ward_id = ? AND is_nota = 0 AND name_hindi = ?',
        [check.name, candidateId, wardId, current.name],
      );
      if (upd.affectedRows !== 1) {
        throw new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: current.name });
      }
      const [ins] = await conn.execute<ResultSetHeader>(
        `INSERT INTO candidate_name_change
           (ward_id, candidate_id, ballot_position, old_name_hindi, new_name_hindi, reason,
            changed_by, changed_by_name, changed_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wardId,
          candidateId,
          current.position,
          current.name,
          check.name,
          reason,
          who.user.id,
          byName,
          role,
        ],
      );
      const [at] = await conn.execute<RowDataPacket[]>(
        'SELECT changed_at FROM candidate_name_change WHERE id = ?',
        [ins.insertId],
      );
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'CANDIDATE_NAME_CORRECTED',
        entity: 'candidate',
        entityId: candidateId,
        oldValue: { ward_id: wardId, position: current.position, name_hindi: current.name },
        newValue: {
          ward_id: wardId,
          position: current.position,
          name_hindi: check.name,
          name_change_id: ins.insertId,
        },
        reason,
        ip: who.ip,
      });
      const changedAt: unknown = at[0]?.changed_at;
      return {
        candidateId,
        oldName: current.name,
        nameHindi: check.name,
        changedAt: changedAt instanceof Date ? changedAt.toISOString() : new Date().toISOString(),
      };
    }),
  );
  emitWardChanged(wardId);
  return out;
}

// ---------------------------------------------------------------- history (read only)

export interface NameChangeEntry {
  id: number;
  wardId: number;
  wardLabel: string;
  wardKind: 'PS' | 'ZP';
  wardNo: number;
  candidateId: number;
  ballotPosition: number;
  oldName: string;
  newName: string;
  reason: string;
  changedByName: string;
  changedByRole: 'PS_RO' | 'ZP_RO';
  changedAt: string;
}

const HISTORY_SELECT = `SELECT h.id, h.ward_id, w.ward_type, w.ward_no, ps.name_english AS ps_name,
       ps.name_hindi AS ps_name_hindi, h.candidate_id, h.ballot_position, h.old_name_hindi,
       h.new_name_hindi, h.reason, h.changed_by_name, h.changed_by_role, h.changed_at
  FROM candidate_name_change h
  JOIN ward w ON w.id = h.ward_id
  LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id`;
const HISTORY_ORDER = ' ORDER BY h.changed_at DESC, h.id DESC';

function toEntry(r: RowDataPacket): NameChangeEntry {
  const wardType = r.ward_type === 'ZP' ? 'ZP' : 'PS';
  const changedAt = r.changed_at instanceof Date ? r.changed_at : new Date(String(r.changed_at));
  return {
    id: Number(r.id),
    wardId: Number(r.ward_id),
    wardLabel: wardHi(
      wardRef({
        id: Number(r.ward_id),
        ward_type: wardType,
        ward_no: Number(r.ward_no),
        ps_name: r.ps_name === null ? null : String(r.ps_name),
        ps_name_hindi: r.ps_name_hindi === null ? null : String(r.ps_name_hindi),
      }),
    ),
    wardKind: wardType,
    wardNo: Number(r.ward_no),
    candidateId: Number(r.candidate_id),
    ballotPosition: Number(r.ballot_position),
    oldName: String(r.old_name_hindi),
    newName: String(r.new_name_hindi),
    reason: String(r.reason),
    changedByName: String(r.changed_by_name),
    changedByRole: r.changed_by_role === 'ZP_RO' ? 'ZP_RO' : 'PS_RO',
    changedAt: changedAt.toISOString(),
  };
}

/** One ward's corrections, newest first. The caller has checked that the user may read the ward. */
export async function wardNameChanges(
  db: Pool | PoolConnection,
  wardId: number,
): Promise<NameChangeEntry[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `${HISTORY_SELECT} WHERE h.ward_id = ?${HISTORY_ORDER}`,
    [wardId],
  );
  return rows.map(toEntry);
}

/**
 * Every correction the user may see, newest first: PS_RO the PS wards of its own PS, ZP_RO the ZP
 * wards, DM all. Super Admin: nothing (403). Only fixed SQL text is chosen here, never user input.
 */
export async function visibleNameChanges(pool: Pool, user: AuthUser): Promise<NameChangeEntry[]> {
  let rows: RowDataPacket[];
  switch (user.role) {
    case 'DM':
      [rows] = await pool.execute<RowDataPacket[]>(`${HISTORY_SELECT}${HISTORY_ORDER}`);
      break;
    case 'ZP_RO':
      [rows] = await pool.execute<RowDataPacket[]>(
        `${HISTORY_SELECT} WHERE w.ward_type = 'ZP'${HISTORY_ORDER}`,
      );
      break;
    case 'PS_RO':
      if (user.panchayatSamitiId === null) return [];
      [rows] = await pool.execute<RowDataPacket[]>(
        `${HISTORY_SELECT} WHERE w.ward_type = 'PS' AND w.panchayat_samiti_id = ?${HISTORY_ORDER}`,
        [user.panchayatSamitiId],
      );
      break;
    case 'SUPER_ADMIN':
      throw new ApiError(403, 'FORBIDDEN');
  }
  return rows.map(toEntry);
}

/** Ids of this ward's current candidates that have at least one recorded name correction. */
export async function renamedCandidateIds(
  db: Pool | PoolConnection,
  wardId: number,
): Promise<Set<number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT h.candidate_id FROM candidate_name_change h
       JOIN candidate c ON c.id = h.candidate_id AND c.ward_id = h.ward_id
      WHERE h.ward_id = ?`,
    [wardId],
  );
  return new Set(rows.map((r) => Number(r.candidate_id)));
}

const ROLE_HI: Readonly<Record<NameChangeEntry['changedByRole'], string>> = {
  PS_RO: 'PS RO',
  ZP_RO: 'ZP RO',
};

/** The DM's CSV download (UTF-8 BOM, formula-injection guard from csv.ts), newest first. */
export function nameChangesCsv(entries: readonly NameChangeEntry[]): string {
  return toCsv([
    [
      'क्र.',
      'वार्ड',
      'क्रम संख्या (मतपत्र)',
      'पुराना नाम',
      'नया नाम',
      'कारण',
      'किसने बदला',
      'पद',
      'कब (IST)',
    ],
    ...entries.map((e, i) => [
      i + 1,
      e.wardLabel,
      e.ballotPosition,
      e.oldName,
      e.newName,
      e.reason,
      e.changedByName,
      ROLE_HI[e.changedByRole],
      istText(new Date(e.changedAt)),
    ]),
  ]);
}
