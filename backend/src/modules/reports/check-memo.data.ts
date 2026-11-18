// The numbers of the "अंतिम परिणाम हेतु चेक मीमो" come from ONE place: wardDetail() — the very read
// the DM's ward detail page shows (and which the Counting Status report is built from). Nothing is
// added up or recomputed here: this file only arranges those numbers into the officer's template
// (render-check-memo.xlsx.ts), so the memo can never disagree with the reports.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import type { MemoScope } from '../../services/access.js';
import type {
  CheckMemoBooth,
  CheckMemoData,
} from '../../services/ward-forms/render-check-memo.xlsx.js';
import { wardDetail } from './ward-detail.js';

type Detail = Awaited<ReturnType<typeof wardDetail>>;

/** votes per candidate id, as the ward detail reports them for one booth or the postal sheet. */
const votesOf = (
  votes: readonly { candidateId: number; votes: number }[],
  ids: readonly number[],
): number[] => {
  const by = new Map(votes.map((v) => [v.candidateId, v.votes]));
  return ids.map((id) => by.get(id) ?? 0);
};

/**
 * The booths a PS_RO's ZP ward memo may contain: the ward's booths of THAT Panchayat Samiti, by
 * booth id, read from the booth table itself (`booth.panchayat_samiti_id` is NOT NULL with an FK,
 * so it is the authority on which PS a booth belongs to). The psId comes from the session, never
 * from the request. No booths = this Panchayat Samiti has nothing in this ward: 403.
 */
async function psBoothScope(
  pool: Pool,
  wardId: number,
  psId: number,
): Promise<{ psName: string; boothIds: Set<number> }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id, ps.name_hindi AS ps_name
       FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
      WHERE b.zp_ward_id = ? AND b.panchayat_samiti_id = ?`,
    [wardId, psId],
  );
  if (rows.length === 0) throw new ApiError(403, 'FORBIDDEN');
  return {
    psName: String(rows[0]?.ps_name ?? ''),
    boothIds: new Set(rows.map((r) => Number(r.id))),
  };
}

/** The whole ward's sheet, or one Panchayat Samiti's booths of a ZP ward (`only`). */
export function checkMemoOf(
  detail: Detail,
  only: { psName: string; boothIds: Set<number> } | null = null,
): CheckMemoData {
  // Ballot order, exactly as the ward detail lists them; NOTA has its own column at the end.
  const candidates = detail.candidates
    .filter((c) => !c.isNota)
    .sort((a, b) => a.ballotPosition - b.ballotPosition);
  const nota = detail.candidates.find((c) => c.isNota);
  const ids = [...candidates.map((c) => c.id), ...(nota === undefined ? [] : [nota.id])];

  // The one place another Panchayat Samiti's booths are dropped: the sheet is BUILT from the
  // allow-list, so a booth outside it never reaches a cell (votes, totals or booth name alike).
  const source =
    only === null ? detail.booths : detail.booths.filter((b) => only.boothIds.has(b.boothId));
  const booths: CheckMemoBooth[] = source.map((b) => ({
    boothNo: b.boothNo,
    psName: b.psName,
    entered: b.entered,
    votes: b.entered ? votesOf(b.votes, ids) : [],
    total: b.sheetTotal,
  }));
  const psNames = new Set(source.map((b) => b.psName));

  const kind = detail.ward.kind === 'ZP' ? 'ZP' : 'PS';
  return {
    kind,
    wardNo: detail.ward.wardNo,
    psName: detail.ward.psName,
    candidates: candidates.map((c) => c.name),
    booths,
    // 8 ZP wards take booths from more than one Panchayat Samiti, and booth numbers start again in
    // each of them: the sheet then names the Panchayat Samiti above its booths.
    multiPs: kind === 'ZP' && psNames.size > 1,
    // Set ONLY for a PS_RO's ZP ward memo (scope, not a count comparison): the notice is then part
    // of the document whether their Panchayat Samiti holds some of the ward's booths or all of them.
    partial:
      only === null
        ? null
        : {
            psName: only.psName,
            boothsIncluded: booths.length,
            boothsInWard: detail.booths.length,
          },
    // A PS_RO's ZP ward sheet has no postal row at all, so the figures are not carried either:
    // the ward's ONE postal sheet belongs to the ZP ward's result, not to one PS's booths.
    postal:
      only === null
        ? {
            entered: detail.postal.entered,
            votes: detail.postal.entered ? votesOf(detail.postal.votes, ids) : [],
            total: detail.postal.sheetTotal,
            rejected: detail.postal.rejectedCount,
          }
        : { entered: false, votes: [], total: null, rejected: null },
  };
}

/**
 * The check memo data of one ward, as far as `scope` reaches (the caller has already decided the
 * scope from the session: services/access.ts checkMemoScope).
 */
export async function readCheckMemo(
  pool: Pool,
  wardId: number,
  scope: MemoScope,
): Promise<CheckMemoData> {
  const only = scope.kind === 'FULL' ? null : await psBoothScope(pool, wardId, scope.psId);
  return checkMemoOf(await wardDetail(pool, wardId), only);
}
