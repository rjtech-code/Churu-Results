// RO "उम्मीदवार": a PS_RO edits the candidate lists of its own PS's PS wards, the ZP_RO those of
// the ZP wards (canWriteWard, checked on the server for every request). The whole list of a ward is
// saved at once with exactly the importer's rules (checkWardList), so a half-edited list can never be
// stored. "सूची तैयार है" (with the password) marks it ready for the DM's check.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteWard, wardWriteAllowed } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import { emitWardChanged } from '../../services/events.js';
import {
  detailsForAudit,
  checkDetails,
  formDetails,
  sameDetails,
} from '../../services/master-data/candidate-details.js';
import type {
  CandidateDetails,
  FormDetails,
} from '../../services/master-data/candidate-details.js';
import {
  MAX_NAME_LENGTH,
  checkWardList,
  readWardCandidates,
  replaceWardCandidates,
} from '../../services/master-data/candidates.js';
import type { CandidateInput, Gender } from '../../services/master-data/candidates.js';
import { IssueList, wardRef } from '../../services/master-data/issues.js';
import { issuesHi, psHi, wardHi } from '../../services/master-data/issues-hi.js';
import {
  loadWard,
  loadWards,
  lockWardRows,
  wardHasEntries,
  wardsWithEntries,
} from '../../services/master-data/lookups.js';
import type { WardRow } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { loadParties } from '../../services/master-data/parties.js';
import { normalizeText } from '../../services/master-data/text.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from '../admin/http.js';
import type { Actor } from '../admin/http.js';
import { listStatus } from '../admin/lists.service.js';

export interface FormCandidate extends FormDetails {
  ballotPosition: number;
  nameHindi: string;
  partyId: number | null;
  gender: Gender;
}

/** 404 for an unknown ward, 403 for a ward the user may not work on. */
async function authorize(pool: Pool, who: Actor, wardId: number): Promise<WardRow> {
  const ward = await loadWard(pool, wardId);
  if (!ward) throw new ApiError(404, 'NOT_FOUND');
  if (!(await canWriteWard(pool, who.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
  return ward;
}

async function returnReasons(pool: Pool): Promise<Map<number, string>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, candidates_return_reason FROM ward WHERE candidates_return_reason IS NOT NULL',
  );
  return new Map(rows.map((r) => [Number(r.id), String(r.candidates_return_reason)]));
}

/** The RO's own wards with their list status. */
export async function listOwnWards(pool: Pool, who: Actor) {
  const wards = (await loadWards(pool)).filter((w) =>
    wardWriteAllowed(who.user, { wardType: w.ward_type, panchayatSamitiId: w.panchayat_samiti_id }),
  );
  const [counts] = await pool.execute<RowDataPacket[]>(
    'SELECT ward_id, COUNT(*) AS n FROM candidate WHERE is_nota = 0 GROUP BY ward_id',
  );
  const count = new Map(counts.map((r) => [Number(r.ward_id), Number(r.n)]));
  const entries = await wardsWithEntries(pool);
  const reasons = await returnReasons(pool);
  return wards
    .sort((a, b) => a.ward_no - b.ward_no)
    .map((w) => ({
      id: w.id,
      kind: w.ward_type,
      wardNo: w.ward_no,
      label: wardHi(wardRef(w)),
      candidates: count.get(w.id) ?? 0,
      unopposed: w.is_unopposed === 1,
      status: listStatus(w),
      hasEntries: entries.has(w.id),
      returnReason: reasons.get(w.id) ?? null,
    }));
}

/** One ward's list and the party dropdown. */
export async function readOwnWard(pool: Pool, who: Actor, wardId: number) {
  const ward = await authorize(pool, who, wardId);
  const reasons = await returnReasons(pool);
  const hasEntries = await wardHasEntries(pool, wardId);
  return {
    ward: {
      id: ward.id,
      kind: ward.ward_type,
      wardNo: ward.ward_no,
      label: wardHi(wardRef(ward)),
      panchayatSamiti: ward.ward_type === 'PS' ? psHi(ward.ps_name_hindi) : null,
      status: listStatus(ward),
      unopposed: ward.is_unopposed === 1,
      hasEntries,
      editable: ward.is_locked !== 1 && !hasEntries,
      returnReason: reasons.get(ward.id) ?? null,
      reservationCategory: ward.reservation_category,
    },
    candidates: (await readWardCandidates(pool, wardId)).map((c) => ({
      ballotPosition: c.position,
      nameHindi: c.nameHindi,
      partyId: c.partyId,
      gender: c.gender,
      // The ward's own RO (authorize above) may see the private details.
      dob: c.details.dob,
      ageStated: c.details.ageStated,
      education: c.details.education,
      mobile: c.details.mobile,
    })),
    parties: (await loadParties(pool)).map((p) => ({
      id: p.id,
      shortName: p.short_name,
      nameHindi: p.name_hindi,
    })),
  };
}

const sameList = (
  a: readonly {
    position: number;
    nameHindi: string;
    partyId: number | null;
    gender: Gender;
    details: CandidateDetails;
  }[],
  b: readonly CandidateInput[],
) =>
  a.length === b.length &&
  [...b]
    .sort((x, y) => x.position - y.position)
    .every((c, i) => {
      const o = a[i];
      return (
        o?.position === c.position &&
        o.nameHindi === c.nameHindi &&
        o.partyId === c.partyId &&
        o.gender === c.gender &&
        sameDetails(o.details, c.details)
      );
    });

/** Saves the whole list of one ward. The ready mark is cleared (the new list must be checked). */
export async function saveOwnWard(
  pool: Pool,
  who: Actor,
  wardId: number,
  candidates: readonly FormCandidate[],
): Promise<{ candidates: number; unopposed: boolean }> {
  await authorize(pool, who, wardId);
  const out = await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await lockWardRows(conn, [wardId]);
      const ward = await loadWard(conn, wardId);
      if (!ward) throw new ApiError(404, 'NOT_FOUND');
      const parties = new Map((await loadParties(conn)).map((p) => [p.id, p.short_name]));

      const issues = new IssueList();
      const rows: CandidateInput[] = [];
      candidates.forEach((c, i) => {
        const rowNumber = i + 1;
        const nameHindi = normalizeText(c.nameHindi);
        let ok = true;
        if (nameHindi === '') {
          issues.error({ code: 'CELL_EMPTY', column: 'name_hindi' }, rowNumber);
          ok = false;
        } else if (nameHindi.length > MAX_NAME_LENGTH) {
          issues.error({ code: 'NAME_TOO_LONG', max: MAX_NAME_LENGTH }, rowNumber);
          ok = false;
        }
        const partyShort = c.partyId === null ? null : (parties.get(c.partyId) ?? null);
        if (c.partyId !== null && partyShort === null) {
          issues.error({ code: 'PARTY_UNKNOWN', value: String(c.partyId) }, rowNumber);
          ok = false;
        }
        const details = checkDetails(formDetails(c), rowNumber, issues);
        if (details === null) ok = false;
        if (ok && details !== null)
          rows.push({
            rowNumber,
            position: c.ballotPosition,
            nameHindi,
            partyId: c.partyId,
            partyShort,
            gender: c.gender,
            category: null,
            details,
          });
      });
      checkWardList(ward, rows, await wardHasEntries(conn, wardId), false, issues);
      if (!issues.isOk())
        throw new ApiError(400, 'CHECK_FAILED', { errors: issuesHi(issues.errors, 'form') });

      const before = await readWardCandidates(conn, wardId);
      if (sameList(before, rows)) throw new ApiError(409, 'NO_CHANGE');
      await replaceWardCandidates(conn, wardId, rows, 'keep');
      const plain = (
        list: readonly {
          position: number;
          nameHindi: string;
          partyShort: string | null;
          gender: Gender;
          details: CandidateDetails;
        }[],
      ) =>
        list.map((c) => ({
          position: c.position,
          name_hindi: c.nameHindi,
          party: c.partyShort,
          gender: c.gender,
          ...detailsForAudit(c.details),
        }));
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'CANDIDATES_SAVED',
        entity: 'ward',
        entityId: wardId,
        oldValue: { candidates: plain(before), ready: ward.candidates_ready === 1 },
        newValue: {
          candidates: plain([...rows].sort((a, b) => a.position - b.position)),
          ready: false,
          unopposed: rows.length === 1,
        },
        ip: who.ip,
      });
      return { candidates: rows.length, unopposed: rows.length === 1 };
    }),
  );
  emitWardChanged(wardId);
  return out;
}

/** "सूची तैयार है": needs the password, at least one candidate, and an unlocked ward. */
export async function markReady(
  pool: Pool,
  who: Actor,
  wardId: number,
  password: string,
): Promise<void> {
  await authorize(pool, who, wardId);
  await requireReauth(pool, who.user.id, password, who.ip);
  await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      await lockWardRows(conn, [wardId]);
      const ward = await loadWard(conn, wardId);
      if (!ward) throw new ApiError(404, 'NOT_FOUND');
      if (ward.is_locked === 1) throw new ApiError(409, 'BALLOT_LOCKED');
      if (await wardHasEntries(conn, wardId)) throw new ApiError(409, 'COUNTING_STARTED');
      if ((await readWardCandidates(conn, wardId)).length === 0)
        throw new ApiError(409, 'LIST_EMPTY');
      if (ward.candidates_ready === 1) throw new ApiError(409, 'NO_CHANGE');
      await conn.execute(
        `UPDATE ward SET candidates_ready_at = NOW(3), candidates_ready_by = ?,
                candidates_return_reason = NULL WHERE id = ?`,
        [who.user.id, wardId],
      );
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'CANDIDATES_READY',
        entity: 'ward',
        entityId: wardId,
        newValue: { candidates_ready: true },
        ip: who.ip,
      });
    }),
  );
}
