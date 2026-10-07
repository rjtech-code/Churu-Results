// DM ward detail: candidates (booth / postal / total from result.ts), the booth-wise entries as saved,
// the postal entry, every declaration version and a history summary (edits, voids). Read only, one
// consistent snapshot.
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { istIso } from '../../services/public-views.js';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import { ResultInputError, computeWardResult } from '../../services/result.js';
import type { WardResult } from '../../services/result.js';

/** Text of a DB value (strings and numbers only; anything else is ''). */
const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const iso = (v: unknown): string | null =>
  v instanceof Date ? istIso(v) : typeof v === 'string' ? istIso(new Date(v)) : null;
const userName = (full: unknown, username: unknown): string | null => {
  const name = text(full) || text(username);
  return name === '' ? null : name;
};

function inList(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** ENTRY_UPDATED / POSTAL_UPDATED counts per entry id (live and voided entries). */
async function editCounts(
  conn: PoolConnection,
  entity: 'booth_entry' | 'postal_entry',
  ids: number[],
): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT entity_id, COUNT(*) AS n FROM audit_log
      WHERE entity = ? AND action IN ('ENTRY_UPDATED', 'POSTAL_UPDATED') AND entity_id IN (${inList(ids.length)})
      GROUP BY entity_id`,
    [entity, ...ids],
  );
  return new Map(rows.map((r) => [Number(r.entity_id), Number(r.n)]));
}

export async function wardDetail(pool: Pool, wardId: number) {
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const [wardRows] = await conn.execute<RowDataPacket[]>(
      `SELECT w.id, w.ward_type, w.ward_no, w.reservation_category, w.is_unopposed, ps.name_hindi AS ps_name, ps.name_english AS ps_english
         FROM ward w LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id WHERE w.id = ?`,
      [wardId],
    );
    const ward = wardRows[0];
    if (ward === undefined) throw new ApiError(404, 'NOT_FOUND');
    const kind = ward.ward_type === 'ZP' ? 'ZP' : 'PS';
    const [candidates] = await conn.execute<RowDataPacket[]>(
      `SELECT c.id, c.ballot_position, c.name_hindi, c.gender, c.is_nota, p.short_name, p.name_hindi AS party_name
         FROM candidate c LEFT JOIN party p ON p.id = c.party_id WHERE c.ward_id = ? ORDER BY c.is_nota, c.ballot_position`,
      [wardId],
    );
    const [booths] = await conn.execute<RowDataPacket[]>(
      `SELECT b.id, b.booth_no, b.name_hindi, b.registered_voters_total, ps.name_hindi AS ps_name
         FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
        WHERE ${kind === 'PS' ? 'b.ps_ward_id' : 'b.zp_ward_id'} = ? ORDER BY ps.id, b.booth_no`,
      [wardId],
    );
    const [entries] = await conn.execute<RowDataPacket[]>(
      `SELECT e.id, e.booth_id, e.round_no, e.sheet_total, e.entered_at, e.updated_at,
              ue.username AS e_user, ue.full_name AS e_full, uu.username AS u_user, uu.full_name AS u_full
         FROM booth_entry e JOIN users ue ON ue.id = e.entered_by LEFT JOIN users uu ON uu.id = e.updated_by
        WHERE e.ward_id = ?`,
      [wardId],
    );
    const [entryVotes] = await conn.execute<RowDataPacket[]>(
      'SELECT entry_id, candidate_id, votes FROM booth_entry_vote WHERE ward_id = ?',
      [wardId],
    );
    const [postal] = await conn.execute<RowDataPacket[]>(
      `SELECT p.id, p.sheet_total, p.rejected_count, p.entered_at, ue.username AS e_user, ue.full_name AS e_full
         FROM postal_entry p JOIN users ue ON ue.id = p.entered_by WHERE p.ward_id = ?`,
      [wardId],
    );
    const [postalVotes] = await conn.execute<RowDataPacket[]>(
      'SELECT candidate_id, votes FROM postal_entry_vote WHERE ward_id = ?',
      [wardId],
    );
    const [voided] = await conn.execute<RowDataPacket[]>(
      'SELECT entry_kind, original_entry_id, booth_id FROM voided_entry WHERE ward_id = ?',
      [wardId],
    );
    const [declarations] = await conn.execute<RowDataPacket[]>(
      `SELECT d.version, d.status, d.winner_candidate_id, c.name_hindi AS winner_name, d.margin, d.snapshot,
              d.lottery_details, d.nota_highest_ack, d.correction_reason, d.declared_at, u.username, u.full_name
         FROM ward_declarations d JOIN candidate c ON c.id = d.winner_candidate_id JOIN users u ON u.id = d.declared_by
        WHERE d.ward_id = ? ORDER BY d.version`,
      [wardId],
    );
    const boothEntryIds = [
      ...entries.map((e) => Number(e.id)),
      ...voided.filter((v) => v.entry_kind === 'BOOTH').map((v) => Number(v.original_entry_id)),
    ];
    const postalIds = [
      ...postal.map((p) => Number(p.id)),
      ...voided.filter((v) => v.entry_kind === 'POSTAL').map((v) => Number(v.original_entry_id)),
    ];
    const boothEdits = await editCounts(conn, 'booth_entry', boothEntryIds);
    const postalEdits = await editCounts(conn, 'postal_entry', postalIds);
    const inputs = candidates.length === 0 ? [] : await readWardInputs(conn, [wardId]);
    return {
      ward,
      kind,
      candidates,
      booths,
      entries,
      entryVotes,
      postal,
      postalVotes,
      voided,
      declarations,
      boothEdits,
      postalEdits,
      inputs,
    };
  });

  let result: WardResult | null = null;
  let unavailable = false;
  const input = read.inputs[0];
  if (input !== undefined) {
    try {
      result = computeWardResult(input);
    } catch (err) {
      if (!(err instanceof ResultInputError)) throw err;
      unavailable = true;
    }
  }
  const byCandidate = new Map((result?.candidates ?? []).map((c) => [c.id, c]));
  const votesByEntry = new Map<number, { candidateId: number; votes: number }[]>();
  for (const v of read.entryVotes) {
    const id = Number(v.entry_id);
    votesByEntry.set(id, [
      ...(votesByEntry.get(id) ?? []),
      { candidateId: Number(v.candidate_id), votes: Number(v.votes) },
    ]);
  }
  const entryByBooth = new Map(read.entries.map((e) => [Number(e.booth_id), e]));
  const entryBooth = new Map<number, number>([
    ...read.entries.map((e): [number, number] => [Number(e.id), Number(e.booth_id)]),
    ...read.voided
      .filter((v) => v.entry_kind === 'BOOTH')
      .map((v): [number, number] => [Number(v.original_entry_id), Number(v.booth_id)]),
  ]);
  const editsOfBooth = (boothId: number) =>
    [...read.boothEdits.entries()]
      .filter(([id]) => entryBooth.get(id) === boothId)
      .reduce((s, [, n]) => s + n, 0);
  const postalRow = read.postal[0];
  const ward = read.ward;

  return {
    ward: {
      id: Number(ward.id),
      kind: read.kind,
      wardNo: Number(ward.ward_no),
      psName: read.kind === 'PS' ? String(ward.ps_name ?? ward.ps_english ?? '') : null,
      reservationCategory:
        ward.reservation_category === null ? null : String(ward.reservation_category),
      isUnopposed: Number(ward.is_unopposed) === 1,
      status: unavailable ? 'UNAVAILABLE' : (result?.status ?? 'NO_CANDIDATES'),
      totalValidVotes: result?.totalValidVotes ?? 0,
      notaVotes: result?.notaVotes ?? 0,
      rejectedPostal: result?.rejectedPostal ?? null,
      boothsEntered: result?.boothsEntered ?? 0,
      boothsTotal: result?.boothsTotal ?? read.booths.length,
      postalEntered: result?.postalEntered ?? false,
      margin: result?.margin ?? null,
      declarationMismatch: result?.declarationMismatch ?? false,
      notaHighest: result?.notaHighest ?? false,
      unavailable,
    },
    candidates: read.candidates.map((c) => {
      const r = byCandidate.get(Number(c.id));
      return {
        id: Number(c.id),
        ballotPosition: Number(c.ballot_position),
        name: String(c.name_hindi),
        party:
          c.short_name === null
            ? null
            : { shortName: String(c.short_name), nameHindi: String(c.party_name) },
        gender: c.gender === null ? null : String(c.gender),
        isNota: Number(c.is_nota) === 1,
        boothVotes: r?.boothVotes ?? 0,
        postalVotes: r?.postalVotes ?? 0,
        totalVotes: r?.totalVotes ?? 0,
        rank: r?.rank ?? null,
        isWinner: result?.winnerCandidateId === Number(c.id),
      };
    }),
    booths: read.booths.map((b) => {
      const e = entryByBooth.get(Number(b.id));
      return {
        boothId: Number(b.id),
        boothNo: Number(b.booth_no),
        name: String(b.name_hindi),
        psName: String(b.ps_name),
        registeredVoters:
          b.registered_voters_total === null ? null : Number(b.registered_voters_total),
        entered: e !== undefined,
        roundNo: e === undefined ? null : Number(e.round_no),
        sheetTotal: e === undefined ? null : Number(e.sheet_total),
        votes: e === undefined ? [] : (votesByEntry.get(Number(e.id)) ?? []),
        enteredBy: e === undefined ? null : userName(e.e_full, e.e_user),
        enteredAt: e === undefined ? null : iso(e.entered_at),
        updatedBy: e === undefined ? null : userName(e.u_full, e.u_user),
        updatedAt: e === undefined ? null : iso(e.updated_at),
        edits: editsOfBooth(Number(b.id)),
        voids: read.voided.filter(
          (v) => v.entry_kind === 'BOOTH' && Number(v.booth_id) === Number(b.id),
        ).length,
      };
    }),
    postal: {
      entered: postalRow !== undefined,
      sheetTotal: postalRow === undefined ? null : Number(postalRow.sheet_total),
      rejectedCount:
        postalRow === undefined || postalRow.rejected_count === null
          ? null
          : Number(postalRow.rejected_count),
      votes: read.postalVotes.map((v) => ({
        candidateId: Number(v.candidate_id),
        votes: Number(v.votes),
      })),
      enteredBy: postalRow === undefined ? null : userName(postalRow.e_full, postalRow.e_user),
      enteredAt: postalRow === undefined ? null : iso(postalRow.entered_at),
      edits: [...read.postalEdits.values()].reduce((s, n) => s + n, 0),
      voids: read.voided.filter((v) => v.entry_kind === 'POSTAL').length,
    },
    declarations: read.declarations.map((d) => {
      const snapshot = d.snapshot as { totalValidVotes?: unknown } | null;
      const lottery = d.lottery_details as { conductedBy?: unknown; note?: unknown } | null;
      return {
        version: Number(d.version),
        status: String(d.status),
        winner: { id: Number(d.winner_candidate_id), name: String(d.winner_name) },
        margin: Number(d.margin),
        totalValidVotes:
          typeof snapshot?.totalValidVotes === 'number' ? snapshot.totalValidVotes : null,
        lottery:
          lottery === null
            ? null
            : { conductedBy: text(lottery.conductedBy), note: text(lottery.note) },
        notaHighestAck: Number(d.nota_highest_ack) === 1,
        correctionReason: d.correction_reason === null ? null : String(d.correction_reason),
        declaredBy: userName(d.full_name, d.username) ?? '',
        declaredAt: iso(d.declared_at) ?? '',
      };
    }),
  };
}
