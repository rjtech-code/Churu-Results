// "विवरण सुधारें" (Nov 2026, grown out of "नाम सुधारें"): the ONLY changes allowed to a candidate
// after the ward's ballot is locked (also while counting and after the ward is declared).
//
//   editable: name, party, gender, the candidate's own category, date of birth / stated age,
//             education, mobile, address, occupation.
//   frozen:   the ballot position (क्रम), adding or removing a candidate, NOTA — refused with
//             FIELD_FROZEN naming the field (see services/candidate-fields.ts).
//
//   who:   PS_RO for PS wards of its own PS, ZP_RO for ZP wards (canWriteWard, on the server).
//          DM and Super Admin never (403); the DM reads the history.
//   needs: the RO's own password again (requireReauth: bcrypt compare, a wrong password counts
//          toward the normal login lockout), a reason (10-500 characters), and the name the RO saw
//          (compare-and-set: two ROs can never overwrite each other silently).
//   party: changes the party-wise seat totals, so it needs confirmPartyChange as well, and the
//          refusal says whether counting of this ward has already started.
//   one transaction: candidate UPDATE + one candidate_name_change row PER CHANGED FIELD + the
//          audit_log row, or nothing.
//
// Votes, entries and declarations point to candidate.id, which never changes here, so every screen,
// report and export shows the new details on its next read.
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteWard } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import {
  FIELD_HI,
  FieldError,
  diffCandidate,
  fieldText,
  partyText,
} from '../../services/candidate-fields.js';
import type {
  CandidateFields,
  CandidatePatch,
  CorrectableField,
  FieldChange,
  Gender,
} from '../../services/candidate-fields.js';
import { istText } from '../../services/counting-status.js';
import { emitWardChanged } from '../../services/events.js';
import { phoneLast4 } from '../../services/master-data/accounts.js';
import {
  DETAIL_COLUMNS_SQL,
  detailsFromRow,
} from '../../services/master-data/candidate-details.js';
import { wardRef } from '../../services/master-data/issues.js';
import { wardHi } from '../../services/master-data/issues-hi.js';
import { loadWard, lockWardRows, wardHasEntries } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import type { AuthUser } from '../../types/auth.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from '../admin/http.js';
import type { Actor } from '../admin/http.js';
import { toCsv } from '../reports/csv.js';

export interface NameCorrectionBody extends CandidatePatch {
  /** The name the RO saw on screen (compare-and-set, for every field). */
  currentName: string;
  reason: string;
  password: string;
  /** Required (true) when the party changes: it moves the party-wise seat totals. */
  confirmPartyChange?: boolean | undefined;
}

export interface NameCorrectionResult {
  candidateId: number;
  /** The name before and after (equal when only other details changed). */
  oldName: string;
  nameHindi: string;
  changes: { field: CorrectableField; label: string; oldValue: string | null; newValue: string | null }[];
  changedAt: string;
}

interface CandidateRow extends CandidateFields {
  id: number;
  position: number;
}

const CANDIDATE_SELECT = `SELECT c.id, c.ballot_position, c.name_hindi, c.party_id, p.short_name,
            c.gender, ${DETAIL_COLUMNS_SQL}
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id
      WHERE c.id = ? AND c.ward_id = ? AND c.is_nota = 0`;

async function readCandidate(
  db: Pool | PoolConnection,
  wardId: number,
  candidateId: number,
  forUpdate: boolean,
): Promise<CandidateRow | null> {
  // FOR UPDATE cannot be used with the LEFT JOIN result alone; the candidate row is the one locked.
  const [rows] = await db.execute<RowDataPacket[]>(
    forUpdate ? `${CANDIDATE_SELECT} FOR UPDATE OF c` : CANDIDATE_SELECT,
    [candidateId, wardId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: Number(r.id),
    position: Number(r.ballot_position),
    name: String(r.name_hindi),
    partyId: r.party_id === null ? null : Number(r.party_id),
    partyShort: r.short_name === null ? null : String(r.short_name),
    gender: String(r.gender) as Gender,
    ...detailsFromRow(r),
  };
}

/** short_name of every party, so a changed party can be named and checked. */
async function partyShortNames(db: Pool | PoolConnection): Promise<Map<number, string>> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, short_name FROM party');
  return new Map(rows.map((r) => [Number(r.id), String(r.short_name)]));
}

/** At most one candidate per party per ward (independents exempt) — the list rule, kept here too. */
async function partyTakenBy(
  db: Pool | PoolConnection,
  wardId: number,
  partyId: number,
  candidateId: number,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 AS x FROM candidate WHERE ward_id = ? AND party_id = ? AND id <> ? LIMIT 1',
    [wardId, partyId, candidateId],
  );
  return rows.length > 0;
}

function fieldError(err: unknown): never {
  if (err instanceof FieldError) {
    throw err.code === 'NAME_UNCHANGED'
      ? new ApiError(409, err.code)
      : new ApiError(400, err.code, err.field === undefined ? undefined : { field: err.field });
  }
  throw err;
}

const PATCH_KEYS = [
  'newName',
  'partyId',
  'gender',
  'candidateCategory',
  'dob',
  'ageStated',
  'education',
  'mobile',
  'address',
  'occupation',
] as const satisfies readonly (keyof CandidatePatch)[];

const patchOf = (body: NameCorrectionBody): CandidatePatch => {
  const patch: CandidatePatch = {};
  for (const key of PATCH_KEYS) {
    if (body[key] !== undefined) Object.assign(patch, { [key]: body[key] });
  }
  return patch;
};

/** "Nothing changed": NAME_UNCHANGED when the RO only retyped the name, else NO_CHANGE. */
function noChangeError(patch: CandidatePatch): ApiError {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === 'newName'
    ? new ApiError(409, 'NAME_UNCHANGED')
    : new ApiError(409, 'NO_CHANGE');
}

function diff(current: CandidateRow, patch: CandidatePatch, parties: Map<number, string>) {
  try {
    return diffCandidate(current, patch, (id) => (id === null ? null : (parties.get(id) ?? null)));
  } catch (err) {
    return fieldError(err);
  }
}

/** Never the whole mobile number in the audit log (the history table keeps it). */
const auditValue = (c: FieldChange, which: 'oldValue' | 'newValue') =>
  c.field === 'MOBILE' ? phoneLast4(c[which]) : c[which];

const auditValues = (changes: readonly FieldChange[], which: 'oldValue' | 'newValue') =>
  Object.fromEntries(changes.map((c) => [c.field, auditValue(c, which)]));

/**
 * Order of checks: role and ward scope (403/404, the password is never checked for someone who may
 * not do this), cheap state checks (so a useless request does not cost a password attempt), the
 * password, then everything again under the ward + candidate row locks inside the transaction.
 */
export async function correctCandidateDetails(
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
  const patch = patchOf(body);
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'NO_CHANGE');
  const parties = await partyShortNames(pool);
  if (patch.partyId !== undefined && patch.partyId !== null && !parties.has(patch.partyId)) {
    throw new ApiError(400, 'PARTY_UNKNOWN');
  }
  const precheck = diff(seen, patch, parties);
  if (precheck.changes.length === 0) throw noChangeError(patch);
  if (seen.name !== body.currentName) {
    throw new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: seen.name });
  }
  // The party moves the party-wise seat totals: an explicit second confirmation, and a clear warning
  // when this ward's counting has already started.
  const partyChange = precheck.changes.find((c) => c.field === 'PARTY');
  if (partyChange && body.confirmPartyChange !== true) {
    throw new ApiError(409, 'PARTY_CONFIRM_REQUIRED', {
      oldParty: partyChange.oldValue,
      newParty: partyChange.newValue,
      countingStarted: await wardHasEntries(pool, wardId),
    });
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
      const inside = await partyShortNames(conn);
      if (patch.partyId !== undefined && patch.partyId !== null && !inside.has(patch.partyId)) {
        throw new ApiError(400, 'PARTY_UNKNOWN');
      }
      const { next, changes } = diff(current, patch, inside);
      if (changes.length === 0) throw noChangeError(patch);
      if (
        next.partyId !== null &&
        next.partyId !== current.partyId &&
        (await partyTakenBy(conn, wardId, next.partyId, candidateId))
      ) {
        throw new ApiError(409, 'PARTY_TAKEN', { party: partyText(next.partyShort) });
      }

      const [upd] = await conn.execute<ResultSetHeader>(
        `UPDATE candidate
            SET name_hindi = ?, party_id = ?, gender = ?, candidate_category = ?, dob = ?,
                age_stated = ?, education = ?, mobile = ?, address = ?, occupation = ?
          WHERE id = ? AND ward_id = ? AND is_nota = 0 AND name_hindi = ?`,
        [
          next.name,
          next.partyId,
          next.gender,
          next.candidateCategory,
          next.dob,
          next.ageStated,
          next.education,
          next.mobile,
          next.address,
          next.occupation,
          candidateId,
          wardId,
          current.name,
        ],
      );
      if (upd.affectedRows !== 1) {
        throw new ApiError(409, 'NAME_CHANGED_MEANWHILE', { currentName: current.name });
      }
      // One history row per changed field, in the same transaction as the UPDATE and the audit row.
      let lastId = 0;
      for (const c of changes) {
        const isName = c.field === 'NAME';
        const [ins] = await conn.execute<ResultSetHeader>(
          `INSERT INTO candidate_name_change
             (ward_id, candidate_id, ballot_position, field, old_value, new_value,
              old_name_hindi, new_name_hindi, reason, changed_by, changed_by_name, changed_by_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            wardId,
            candidateId,
            current.position,
            c.field,
            c.oldValue,
            c.newValue,
            isName ? c.oldValue : null,
            isName ? c.newValue : null,
            reason,
            who.user.id,
            byName,
            role,
          ],
        );
        lastId = ins.insertId;
      }
      const [at] = await conn.execute<RowDataPacket[]>(
        'SELECT changed_at FROM candidate_name_change WHERE id = ?',
        [lastId],
      );
      const onlyName = changes.length === 1 && changes[0]?.field === 'NAME';
      await writeAudit(conn, {
        userId: who.user.id,
        action: onlyName ? 'CANDIDATE_NAME_CORRECTED' : 'CANDIDATE_DETAILS_CORRECTED',
        entity: 'candidate',
        entityId: candidateId,
        oldValue: {
          ward_id: wardId,
          position: current.position,
          name_hindi: current.name,
          ...auditValues(changes, 'oldValue'),
        },
        newValue: {
          ward_id: wardId,
          position: current.position,
          name_hindi: next.name,
          fields: changes.map((c) => c.field),
          name_change_id: lastId,
          ...auditValues(changes, 'newValue'),
        },
        reason,
        ip: who.ip,
      });
      const changedAt: unknown = at[0]?.changed_at;
      return {
        candidateId,
        oldName: current.name,
        nameHindi: next.name,
        changes: changes.map((c) => ({
          field: c.field,
          label: FIELD_HI[c.field],
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
        changedAt: changedAt instanceof Date ? changedAt.toISOString() : new Date().toISOString(),
      };
    }),
  );
  emitWardChanged(wardId);
  return out;
}

/** The old name for the name-only correction (kept so existing callers read the same). */
export const correctCandidateName = correctCandidateDetails;

// ---------------------------------------------------------------- history (read only)

export interface NameChangeEntry {
  id: number;
  wardId: number;
  wardLabel: string;
  wardKind: 'PS' | 'ZP';
  wardNo: number;
  candidateId: number;
  ballotPosition: number;
  /** Which detail changed ('NAME' for every row written before the Nov 2026 migration). */
  field: CorrectableField;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  /** Name rows only (kept for the older readers of this history). */
  oldName: string;
  newName: string;
  reason: string;
  changedByName: string;
  changedByRole: 'PS_RO' | 'ZP_RO';
  changedAt: string;
}

// COALESCE: rows written before the migration have only the two name columns (append-only table, so
// they were never backfilled); they read exactly like a NAME row written today.
const HISTORY_SELECT = `SELECT h.id, h.ward_id, w.ward_type, w.ward_no, ps.name_english AS ps_name,
       ps.name_hindi AS ps_name_hindi, h.candidate_id, h.ballot_position, h.field,
       COALESCE(h.old_value, h.old_name_hindi) AS old_value,
       COALESCE(h.new_value, h.new_name_hindi) AS new_value,
       h.reason, h.changed_by_name, h.changed_by_role, h.changed_at
  FROM candidate_name_change h
  JOIN ward w ON w.id = h.ward_id
  LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id`;
const HISTORY_ORDER = ' ORDER BY h.changed_at DESC, h.id DESC';

const text = (v: unknown): string | null => (typeof v === 'string' ? v : v === null || v === undefined ? null : JSON.stringify(v));

function toEntry(r: RowDataPacket): NameChangeEntry {
  const wardType = r.ward_type === 'ZP' ? 'ZP' : 'PS';
  const changedAt = r.changed_at instanceof Date ? r.changed_at : new Date(String(r.changed_at));
  const field = String(r.field ?? 'NAME') as CorrectableField;
  const oldValue = text(r.old_value);
  const newValue = text(r.new_value);
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
    field,
    fieldLabel: FIELD_HI[field],
    oldValue,
    newValue,
    oldName: field === 'NAME' ? (oldValue ?? '') : '',
    newName: field === 'NAME' ? (newValue ?? '') : '',
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
    case 'OBSERVER': // never correction reasons (and the global guard refuses the route first)
      throw new ApiError(403, 'FORBIDDEN');
  }
  return rows.map(toEntry);
}

/** Ids of this ward's current candidates that have at least one recorded correction. */
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
      'क्या बदला',
      'पुराना मान',
      'नया मान',
      'कारण',
      'किसने बदला',
      'पद',
      'कब (IST)',
    ],
    ...entries.map((e, i) => [
      i + 1,
      e.wardLabel,
      e.ballotPosition,
      e.fieldLabel,
      e.oldValue ?? '',
      e.newValue ?? '',
      e.reason,
      e.changedByName,
      ROLE_HI[e.changedByRole],
      istText(new Date(e.changedAt)),
    ]),
  ]);
}

export { fieldText };
