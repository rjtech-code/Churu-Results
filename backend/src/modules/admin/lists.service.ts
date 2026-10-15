// DM "उम्मीदवार जाँच": candidate-list status per area, send a list back to its RO, the printable
// ballot report, and the ballot lock (existing lock rules: wards without candidates are refused).
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { emitWardChanged } from '../../services/events.js';
import { applyLock, planLock } from '../../services/master-data/ballot-lock.js';
import { buildBallotReportSheets } from '../../services/master-data/ballot-report.js';
import { readWardCandidates } from '../../services/master-data/candidates.js';
import { wardRef } from '../../services/master-data/issues.js';
import { psHi, wardHi } from '../../services/master-data/issues-hi.js';
import {
  loadPanchayatSamitis,
  loadWard,
  loadWards,
  lockWardRows,
  wardHasEntries,
  wardsWithEntries,
} from '../../services/master-data/lookups.js';
import type { WardRow } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { writeSheetToBuffer } from '../../services/master-data/xlsx.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from './http.js';
import type { Actor } from './http.js';

export type ListStatus = 'PENDING' | 'READY' | 'LOCKED';

/** सूची बाकी / सूची तैयार / लॉक. */
export function listStatus(w: Pick<WardRow, 'is_locked' | 'candidates_ready'>): ListStatus {
  if (w.is_locked === 1) return 'LOCKED';
  return w.candidates_ready === 1 ? 'READY' : 'PENDING';
}

/** An area is one Panchayat Samiti (its PS wards) or the Zila Parishad (all ZP wards). */
export type Area = { kind: 'PS'; psId: number } | { kind: 'ZP' } | { kind: 'ALL_PS' };

export function parseArea(text: string): Area | null {
  if (text === 'ZP') return { kind: 'ZP' };
  if (text === 'ALL_PS') return { kind: 'ALL_PS' };
  const m = /^PS:([1-9]\d{0,9})$/.exec(text);
  return m ? { kind: 'PS', psId: Number(m[1]) } : null;
}

function inArea(area: Area): (w: WardRow) => boolean {
  switch (area.kind) {
    case 'ZP':
      return (w) => w.ward_type === 'ZP';
    case 'ALL_PS':
      return (w) => w.ward_type === 'PS';
    case 'PS':
      return (w) => w.ward_type === 'PS' && w.panchayat_samiti_id === area.psId;
  }
}

function areaKey(area: Area): string {
  return area.kind === 'PS' ? `PS:${area.psId}` : area.kind;
}

async function candidateCounts(pool: Pool): Promise<Map<number, number>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT ward_id, COUNT(*) AS n FROM candidate WHERE is_nota = 0 GROUP BY ward_id',
  );
  return new Map(rows.map((r) => [Number(r.ward_id), Number(r.n)]));
}

/** Per area: ward counts by status. With `area`, also that area's wards. */
export async function candidateStatus(pool: Pool, area: Area | null) {
  const wards = await loadWards(pool);
  const psList = [...(await loadPanchayatSamitis(pool)).values()].sort((a, b) =>
    a.name_hindi.localeCompare(b.name_hindi, 'hi'),
  );
  const summarize = (key: string, name: string, list: WardRow[]) => ({
    area: key,
    name,
    total: list.length,
    pending: list.filter((w) => listStatus(w) === 'PENDING').length,
    ready: list.filter((w) => listStatus(w) === 'READY').length,
    locked: list.filter((w) => listStatus(w) === 'LOCKED').length,
  });
  const areas = [
    ...psList.map((ps) =>
      summarize(
        `PS:${ps.id}`,
        psHi(ps.name_hindi),
        wards.filter(inArea({ kind: 'PS', psId: ps.id })),
      ),
    ),
    summarize('ZP', 'ज़िला परिषद', wards.filter(inArea({ kind: 'ZP' }))),
  ];

  let detail = null;
  if (area !== null) {
    const counts = await candidateCounts(pool);
    const entries = await wardsWithEntries(pool);
    const [reasons] = await pool.execute<RowDataPacket[]>(
      'SELECT id, candidates_return_reason FROM ward WHERE candidates_return_reason IS NOT NULL',
    );
    const reasonOf = new Map(
      reasons.map((r) => [Number(r.id), String(r.candidates_return_reason)]),
    );
    detail = {
      area: areaKey(area),
      name: areas.find((a) => a.area === areaKey(area))?.name ?? '',
      wards: wards.filter(inArea(area)).map((w) => ({
        id: w.id,
        wardNo: w.ward_no,
        label: wardHi(wardRef(w)),
        candidates: counts.get(w.id) ?? 0,
        unopposed: w.is_unopposed === 1,
        status: listStatus(w),
        hasEntries: entries.has(w.id),
        returnReason: reasonOf.get(w.id) ?? null,
      })),
    };
  }
  return { areas, detail };
}

/** One ward's list as the DM sees it (read only). */
export async function wardCandidates(pool: Pool, wardId: number) {
  const ward = await loadWard(pool, wardId);
  if (!ward) throw new ApiError(404, 'NOT_FOUND');
  const [parties] = await pool.execute<RowDataPacket[]>('SELECT id, name_hindi FROM party');
  const partyHindi = new Map(parties.map((p) => [Number(p.id), String(p.name_hindi)]));
  return {
    ward: {
      id: ward.id,
      label: wardHi(wardRef(ward)),
      status: listStatus(ward),
      unopposed: ward.is_unopposed === 1,
      reservationCategory: ward.reservation_category,
    },
    candidates: (await readWardCandidates(pool, wardId)).map((c) => ({
      position: c.position,
      nameHindi: c.nameHindi,
      party:
        c.partyId === null
          ? null
          : { shortName: c.partyShort ?? '', nameHindi: partyHindi.get(c.partyId) ?? '' },
      gender: c.gender,
    })),
  };
}

/** "वापस भेजें": the list goes back to the RO with a reason; the ready mark is cleared. */
export async function sendBack(
  pool: Pool,
  who: Actor,
  wardId: number,
  body: { reason: string; password: string },
): Promise<void> {
  if (!(await loadWard(pool, wardId))) throw new ApiError(404, 'NOT_FOUND');
  await requireReauth(pool, who.user.id, body.password, who.ip);
  await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      await lockWardRows(conn, [wardId]);
      const ward = await loadWard(conn, wardId);
      if (!ward) throw new ApiError(404, 'NOT_FOUND');
      if (ward.is_locked === 1) throw new ApiError(409, 'BALLOT_LOCKED');
      if (await wardHasEntries(conn, wardId)) throw new ApiError(409, 'COUNTING_STARTED');
      await conn.execute(
        `UPDATE ward SET candidates_ready_at = NULL, candidates_ready_by = NULL,
                candidates_return_reason = ? WHERE id = ?`,
        [body.reason, wardId],
      );
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'CANDIDATES_SENT_BACK',
        entity: 'ward',
        entityId: wardId,
        oldValue: { candidates_ready: ward.candidates_ready === 1 },
        newValue: { candidates_ready: false },
        reason: body.reason,
        ip: who.ip,
      });
    }),
  );
}

// ---------------------------------------------------------------- lock

const lockWardInfo = (w: WardRow) => ({ id: w.id, wardNo: w.ward_no, label: wardHi(wardRef(w)) });

export async function lockPreview(pool: Pool, area: Area) {
  const plan = await planLock(pool, inArea(area));
  return {
    area: areaKey(area),
    toLock: plan.toLock.map(lockWardInfo),
    alreadyLocked: plan.alreadyLocked.length,
    noCandidates: plan.noCandidates.map(lockWardInfo),
    notReady: plan.notReady.map(lockWardInfo),
    canLock: plan.toLock.length > 0 && plan.noCandidates.length === 0,
  };
}

/**
 * Locks every unlocked ward of the area. All or nothing: a ward without candidates refuses the
 * whole lock. `expectedWardIds` are the wards the DM saw in the preview; if the plan changed
 * meanwhile, nothing is locked (LOCK_PLAN_CHANGED), like the CLI's "wards changed" check.
 */
export async function lockArea(
  pool: Pool,
  who: Actor,
  body: { area: Area; expectedWardIds: number[]; password: string },
): Promise<{ locked: number[] }> {
  await requireReauth(pool, who.user.id, body.password, who.ip);
  const by = who.user.fullName ?? who.user.username;
  const locked = await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      const before = await planLock(conn, inArea(body.area));
      await lockWardRows(
        conn,
        before.toLock.map((w) => w.id),
      );
      const plan = await planLock(conn, inArea(body.area));
      // Compare as sets: the plan lists wards by ward number, which need not follow id order.
      const ids = plan.toLock.map((w) => w.id).sort((a, b) => a - b);
      const expected = [...new Set(body.expectedWardIds)].sort((a, b) => a - b);
      if (ids.join(',') !== expected.join(',')) throw new ApiError(409, 'LOCK_PLAN_CHANGED');
      if (plan.noCandidates.length > 0)
        throw new ApiError(409, 'LOCK_REFUSED', { wards: plan.noCandidates.map(lockWardInfo) });
      if (plan.toLock.length === 0) throw new ApiError(409, 'NOTHING_TO_LOCK');
      await applyLock(conn, plan.toLock, { userId: who.user.id, name: by });
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'BALLOT_LOCK',
        entity: 'ward',
        entityId: plan.toLock.length === 1 ? (plan.toLock[0]?.id ?? null) : null,
        newValue: {
          via: 'web',
          locked_by_name: by,
          scope: areaKey(body.area),
          locked_ward_ids: ids,
          already_locked_ward_ids: plan.alreadyLocked.map((w) => w.id),
          not_ready_ward_ids: plan.notReady.map((w) => w.id),
        },
        ip: who.ip,
      });
      return ids;
    }),
  );
  for (const id of locked) emitWardChanged(id);
  return { locked };
}

/**
 * "अनलॉक करें": unlocks the locked wards of one PS or the ZP and clears their "सूची तैयार" mark,
 * so the RO can change the list, mark it ready again and the DM can lock it again. Refused while
 * any ward of the area has an active booth or postal entry (voided entries live in voided_entry).
 * Candidates are not touched.
 */
export async function unlockArea(
  pool: Pool,
  who: Actor,
  body: { area: Extract<Area, { kind: 'PS' } | { kind: 'ZP' }>; reason: string; password: string },
): Promise<{ unlocked: number[] }> {
  await requireReauth(pool, who.user.id, body.password, who.ip);
  const by = who.user.fullName ?? who.user.username;
  const unlocked = await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      const select = inArea(body.area);
      await lockWardRows(
        conn,
        (await loadWards(conn)).filter(select).map((w) => w.id),
      );
      const wards = (await loadWards(conn)).filter(select);
      const entries = await wardsWithEntries(conn);
      if (wards.some((w) => entries.has(w.id))) throw new ApiError(409, 'UNLOCK_COUNTING_STARTED');
      const ids = wards
        .filter((w) => w.is_locked === 1)
        .map((w) => w.id)
        .sort((a, b) => a - b);
      if (ids.length === 0) throw new ApiError(409, 'NOTHING_TO_UNLOCK');
      const before: RowDataPacket[] = [];
      for (const id of ids) {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, locked_at, locked_by, locked_by_name, (candidates_ready_at IS NOT NULL) AS ready
             FROM ward WHERE id = ?`,
          [id],
        );
        before.push(...rows);
        await conn.execute(
          `UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
                  candidates_ready_at = NULL, candidates_ready_by = NULL
            WHERE id = ? AND is_locked = 1`,
          [id],
        );
      }
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'BALLOT_UNLOCK',
        entity: 'ward',
        entityId: ids.length === 1 ? (ids[0] ?? null) : null,
        oldValue: {
          wards: before.map((r) => ({
            id: Number(r.id),
            locked_at: r.locked_at instanceof Date ? r.locked_at.toISOString() : null,
            locked_by: r.locked_by === null ? null : Number(r.locked_by),
            locked_by_name: r.locked_by_name === null ? null : String(r.locked_by_name),
            candidates_ready: Number(r.ready) === 1,
          })),
        },
        newValue: {
          via: 'web',
          unlocked_by_name: by,
          scope: areaKey(body.area),
          unlocked_ward_ids: ids,
        },
        reason: body.reason,
        ip: who.ip,
      });
      return ids;
    }),
  );
  for (const id of unlocked) emitWardChanged(id);
  return { unlocked };
}

// ---------------------------------------------------------------- ballot report

/** The printable ballot report (.xlsx) of one PS, the ZP, or everything. Audited. */
export async function ballotReport(
  pool: Pool,
  who: Actor,
  scope: Area | { kind: 'ALL' },
): Promise<{ data: Buffer; fileName: string }> {
  const { sheets } = await buildBallotReportSheets(pool, {
    ps:
      scope.kind === 'PS'
        ? scope.psId
        : scope.kind === 'ALL' || scope.kind === 'ALL_PS'
          ? 'ALL'
          : 'NONE',
    includeZp: scope.kind === 'ZP' || scope.kind === 'ALL',
  });
  if (sheets.length === 0) throw new ApiError(404, 'NOT_FOUND');
  const data = await writeSheetToBuffer(sheets);
  await writeAudit(pool, {
    userId: who.user.id,
    action: 'BALLOT_REPORT_DOWNLOADED',
    entity: 'ward',
    entityId: null,
    newValue: { scope: scope.kind === 'PS' ? `PS:${scope.psId}` : scope.kind },
    ip: who.ip,
  });
  const tag = scope.kind === 'PS' ? `ps${scope.psId}` : scope.kind.toLowerCase();
  return { data, fileName: `ballot-report-${tag}.xlsx` };
}
