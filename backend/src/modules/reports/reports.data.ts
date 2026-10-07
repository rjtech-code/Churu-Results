// Reads everything the DM reports need in ONE read-only consistent snapshot, with a FIXED number of
// queries whatever the number of wards (7 here + the 8 of readWardInputs). Read only.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import { ResultInputError, computeWardResult } from '../../services/result.js';
import type { WardResult } from '../../services/result.js';
import type { ReportRaw } from '../../services/reports.js';

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function readReportData(pool: Pool): Promise<ReportRaw> {
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const [wards] = await conn.execute<RowDataPacket[]>(
      `SELECT id, ward_type, ward_no, panchayat_samiti_id, reservation_category, is_unopposed
         FROM ward ORDER BY ward_type, panchayat_samiti_id, ward_no`,
    );
    const [ps] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name_english, name_hindi FROM panchayat_samiti ORDER BY id',
    );
    const [parties] = await conn.execute<RowDataPacket[]>(
      'SELECT id, short_name, name_hindi FROM party',
    );
    const [candidates] = await conn.execute<RowDataPacket[]>(
      'SELECT id, ward_id, name_hindi, party_id, gender, is_nota FROM candidate',
    );
    const [booths] = await conn.execute<RowDataPacket[]>(
      'SELECT id, ps_ward_id, zp_ward_id, registered_voters_total FROM booth',
    );
    const [declarations] = await conn.execute<RowDataPacket[]>(
      `SELECT d.ward_id, d.version, d.status, d.winner_candidate_id, d.margin, d.lottery_details,
              d.nota_highest_ack, d.correction_reason, d.declared_at, u.username, u.full_name
         FROM ward_declarations d JOIN users u ON u.id = d.declared_by
        ORDER BY d.ward_id, d.version`,
    );
    const [audit] = await conn.execute<RowDataPacket[]>(
      "SELECT created_at FROM audit_log WHERE action = 'CONFIG_VOTER_CHECK_DISABLED' ORDER BY id DESC LIMIT 1",
    );
    const withCandidates = [...new Set(candidates.map((c) => Number(c.ward_id)))];
    const inputs = await readWardInputs(conn, withCandidates);
    return { wards, ps, parties, candidates, booths, declarations, audit, inputs };
  });

  // The pure engine runs outside the transaction; one bad ward never breaks the others.
  const results = new Map<number, WardResult | 'UNAVAILABLE'>();
  for (const input of read.inputs) {
    try {
      results.set(input.ward.id, computeWardResult(input));
    } catch (err) {
      if (!(err instanceof ResultInputError)) throw err;
      results.set(input.ward.id, 'UNAVAILABLE');
    }
  }

  return {
    wards: read.wards.map((w) => ({
      id: Number(w.id),
      kind: w.ward_type === 'ZP' ? 'ZP' : 'PS',
      wardNo: Number(w.ward_no),
      panchayatSamitiId: numOrNull(w.panchayat_samiti_id),
      reservationCategory: w.reservation_category === null ? null : String(w.reservation_category),
      isUnopposed: Number(w.is_unopposed) === 1,
    })),
    ps: read.ps.map((p) => ({ id: Number(p.id), name: String(p.name_hindi ?? p.name_english) })),
    parties: read.parties.map((p) => ({
      id: Number(p.id),
      shortName: String(p.short_name),
      nameHindi: String(p.name_hindi),
    })),
    candidates: read.candidates.map((c) => ({
      id: Number(c.id),
      wardId: Number(c.ward_id),
      name: String(c.name_hindi),
      partyId: numOrNull(c.party_id),
      gender: c.gender === null ? null : (String(c.gender) as 'M' | 'F' | 'O'),
      isNota: Number(c.is_nota) === 1,
    })),
    booths: read.booths.map((b) => ({
      id: Number(b.id),
      psWardId: numOrNull(b.ps_ward_id),
      zpWardId: numOrNull(b.zp_ward_id),
      registeredVoters: numOrNull(b.registered_voters_total),
    })),
    declarations: read.declarations.map((d) => {
      const lottery = d.lottery_details as { conductedBy?: unknown; note?: unknown } | null;
      return {
        wardId: Number(d.ward_id),
        version: Number(d.version),
        status: d.status === 'TIE_RESOLVED' ? 'TIE_RESOLVED' : 'DECLARED',
        winnerCandidateId: Number(d.winner_candidate_id),
        margin: Number(d.margin),
        lottery:
          lottery === null
            ? null
            : {
                conductedBy: typeof lottery.conductedBy === 'string' ? lottery.conductedBy : '',
                note: typeof lottery.note === 'string' ? lottery.note : '',
              },
        notaHighestAck: Number(d.nota_highest_ack) === 1,
        correctionReason: d.correction_reason === null ? null : String(d.correction_reason),
        declaredAt: toDate(d.declared_at),
        declaredBy: d.full_name === null ? String(d.username) : String(d.full_name),
      };
    }),
    voterCheckDisabledAt: read.audit[0] === undefined ? null : toDate(read.audit[0].created_at),
    results,
  };
}
