// The numbers of the "अंतिम परिणाम हेतु चेक मीमो" come from ONE place: wardDetail() — the very read
// the DM's ward detail page shows (and which the Counting Status report is built from). Nothing is
// added up or recomputed here: this file only arranges those numbers into the officer's template
// (render-check-memo.xlsx.ts), so the memo can never disagree with the reports.
import type { Pool } from 'mysql2/promise';
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

export function checkMemoOf(detail: Detail): CheckMemoData {
  // Ballot order, exactly as the ward detail lists them; NOTA has its own column at the end.
  const candidates = detail.candidates
    .filter((c) => !c.isNota)
    .sort((a, b) => a.ballotPosition - b.ballotPosition);
  const nota = detail.candidates.find((c) => c.isNota);
  const ids = [...candidates.map((c) => c.id), ...(nota === undefined ? [] : [nota.id])];

  const booths: CheckMemoBooth[] = detail.booths.map((b) => ({
    boothNo: b.boothNo,
    psName: b.psName,
    entered: b.entered,
    votes: b.entered ? votesOf(b.votes, ids) : [],
    total: b.sheetTotal,
  }));
  const psNames = new Set(detail.booths.map((b) => b.psName));

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
    postal: {
      entered: detail.postal.entered,
      votes: detail.postal.entered ? votesOf(detail.postal.votes, ids) : [],
      total: detail.postal.sheetTotal,
      rejected: detail.postal.rejectedCount,
    },
  };
}

/** The check memo data of one ward (the caller has checked that this user may read the ward). */
export async function readCheckMemo(pool: Pool, wardId: number): Promise<CheckMemoData> {
  return checkMemoOf(await wardDetail(pool, wardId));
}
