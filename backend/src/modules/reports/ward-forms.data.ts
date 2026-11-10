// Reads what the official ward forms need (FormSource) in ONE read-only consistent snapshot: the
// ward, its candidates with their private details, the header facts, and the result engine's
// inputs (the engine itself runs outside the transaction). Read only; never adds votes.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { readElectionDate } from '../../services/election-date.js';
import {
  DETAIL_COLUMNS_SQL,
  detailsFromRow,
} from '../../services/master-data/candidate-details.js';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import { ResultInputError, computeWardResult } from '../../services/result.js';
import type { WardResult, WardResultInput } from '../../services/result.js';
import type { FormCandidate, FormSource } from '../../services/ward-forms/form-data.js';
import type { BoothSheet, Part2Head } from '../../services/ward-forms/map-part2.js';

interface WardRow {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  reservation: string | null;
  districtId: number;
  district: string;
  /** The ward's own PS (null for a ZP ward). */
  psId: number | null;
  psName: string | null;
}

/** The ward, or null when there is no such ward. */
export async function readFormWard(
  db: Pool | PoolConnection,
  wardId: number,
): Promise<WardRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT w.id, w.ward_type, w.ward_no, w.reservation_category, w.district_id, d.name_hindi,
            w.panchayat_samiti_id, ps.name_hindi AS ps_name
       FROM ward w JOIN district d ON d.id = w.district_id
       LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id
      WHERE w.id = ?`,
    [wardId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: Number(r.id),
    kind: r.ward_type === 'ZP' ? 'ZP' : 'PS',
    wardNo: Number(r.ward_no),
    reservation: r.reservation_category === null ? null : String(r.reservation_category),
    districtId: Number(r.district_id),
    district: String(r.name_hindi),
    psId: r.panchayat_samiti_id === null ? null : Number(r.panchayat_samiti_id),
    psName: r.ps_name === null ? null : String(r.ps_name),
  };
}

type Gender = NonNullable<FormCandidate['gender']>;
const isGender = (v: unknown): v is Gender => v === 'M' || v === 'F' || v === 'O';

async function readCandidates(conn: PoolConnection, wardId: number): Promise<FormCandidate[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT c.id, c.ballot_position, c.name_hindi, c.gender, p.name_hindi AS party_hindi,
            ${DETAIL_COLUMNS_SQL}
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id
      WHERE c.ward_id = ? AND c.is_nota = 0 ORDER BY c.ballot_position`,
    [wardId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    position: Number(r.ballot_position),
    nameHindi: String(r.name_hindi),
    partyHindi: r.party_hindi === null ? null : String(r.party_hindi),
    gender: isGender(r.gender) ? r.gender : null,
    details: detailsFromRow(r),
  }));
}

/** Hindi names of the PS whose booths vote in this ward (a ZP ward may span several PS). */
/** Hindi names of the PS whose booths vote in a ZP ward (it may span several PS). */
async function readPsNames(conn: PoolConnection, zpWardId: number): Promise<string[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT DISTINCT ps.id, ps.name_hindi FROM booth b
       JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
      WHERE b.zp_ward_id = ? ORDER BY ps.id`,
    [zpWardId],
  );
  return rows.map((r) => String(r.name_hindi));
}

async function countRows(conn: PoolConnection, sql: string, id: number): Promise<number> {
  const [rows] = await conn.execute<RowDataPacket[]>(sql, [id]);
  return Number(rows[0]?.n ?? 0);
}

/** A ZP ward elects to the district's Zila Parishad; a PS ward to its own Panchayat Samiti. */
export async function readBody(conn: PoolConnection, ward: WardRow): Promise<FormSource['body']> {
  if (ward.kind === 'ZP') {
    const sql = "SELECT COUNT(*) AS n FROM ward WHERE ward_type = 'ZP' AND district_id = ?";
    return { name: ward.district, wardCount: await countRows(conn, sql, ward.districtId) };
  }
  if (ward.psId === null || ward.psName === null) throw new Error('PS ward without its PS');
  const sql = "SELECT COUNT(*) AS n FROM ward WHERE ward_type = 'PS' AND panchayat_samiti_id = ?";
  return { name: ward.psName, wardCount: await countRows(conn, sql, ward.psId) };
}

/** The engine's result; data it refuses is 409 RESULT_UNAVAILABLE (never a form). */
function computeOrUnavailable(input: WardResultInput): WardResult {
  try {
    return computeWardResult(input);
  } catch (err) {
    if (err instanceof ResultInputError) throw new ApiError(409, 'RESULT_UNAVAILABLE');
    throw err;
  }
}

/** 404 for an unknown ward; 409 RESULT_UNAVAILABLE when the engine refuses the ward's data. */
export async function readFormSource(pool: Pool, wardId: number): Promise<FormSource> {
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const ward = await readFormWard(conn, wardId);
    if (ward === null) throw new ApiError(404, 'NOT_FOUND');
    const [input] = await readWardInputs(conn, [wardId]);
    if (input === undefined) throw new ApiError(404, 'NOT_FOUND');
    return {
      ward,
      input,
      candidates: await readCandidates(conn, wardId),
      panchayatSamitis: ward.kind === 'ZP' ? await readPsNames(conn, ward.id) : [],
      body: await readBody(conn, ward),
      electionDate: await readElectionDate(conn),
    };
  });
  const result = computeOrUnavailable(read.input);
  const { ward, candidates, panchayatSamitis, body, electionDate } = read;
  return {
    ward: { id: ward.id, kind: ward.kind, wardNo: ward.wardNo, reservation: ward.reservation },
    district: ward.district,
    body,
    panchayatSamitis,
    electionDate,
    candidates,
    result,
  };
}

// ---------------------------------------------------------------- booth sheet (प्रारूप–14)

/** The booth's PS and its two wards (for the permission check), or null for an unknown booth. */
export async function readBoothScope(
  db: Pool | PoolConnection,
  boothId: number,
): Promise<{ psId: number; psWardId: number; zpWardId: number } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT panchayat_samiti_id, ps_ward_id, zp_ward_id FROM booth WHERE id = ?',
    [boothId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    psId: Number(r.panchayat_samiti_id),
    psWardId: Number(r.ps_ward_id),
    zpWardId: Number(r.zp_ward_id),
  };
}

/**
 * One booth's LIVE entry for one ballot, with the header facts, in one read-only snapshot. Votes and
 * the total are exactly as saved (never recomputed). No live entry (never entered, or voided):
 * 404 NO_ENTRY.
 */
export async function readBoothSheet(
  pool: Pool,
  boothId: number,
  ballotFor: 'PS' | 'ZP',
): Promise<{ head: Part2Head; sheet: BoothSheet; wardId: number; entryId: number }> {
  return withReadOnlySnapshot(pool, async (conn) => {
    const [boothRows] = await conn.execute<RowDataPacket[]>(
      `SELECT b.booth_no, b.booth_suffix, b.name_hindi, b.ps_ward_id, b.zp_ward_id
         FROM booth b WHERE b.id = ?`,
      [boothId],
    );
    const b = boothRows[0];
    if (b === undefined) throw new ApiError(404, 'NOT_FOUND');
    const wardId = Number(ballotFor === 'PS' ? b.ps_ward_id : b.zp_ward_id);
    const ward = await readFormWard(conn, wardId);
    if (ward === null) throw new ApiError(404, 'NOT_FOUND');
    const [entries] = await conn.execute<RowDataPacket[]>(
      'SELECT id, sheet_total FROM booth_entry WHERE booth_id = ? AND ballot_for = ? AND ward_id = ?',
      [boothId, ballotFor, wardId],
    );
    const entry = entries[0];
    if (entry === undefined) throw new ApiError(404, 'NO_ENTRY');
    const [votes] = await conn.execute<RowDataPacket[]>(
      `SELECT c.ballot_position, c.name_hindi, c.is_nota, v.votes
         FROM candidate c
         JOIN booth_entry_vote v ON v.candidate_id = c.id AND v.entry_id = ?
        WHERE c.ward_id = ?
        ORDER BY c.is_nota, c.ballot_position`,
      [entry.id, wardId],
    );
    const nota = votes.find((r) => Number(r.is_nota) === 1);
    if (nota === undefined) throw new ApiError(409, 'RESULT_UNAVAILABLE');
    return {
      wardId,
      entryId: Number(entry.id),
      head: {
        kind: ward.kind,
        bodyName: (await readBody(conn, ward)).name,
        wardNo: ward.wardNo,
        district: ward.district,
        electionDate: await readElectionDate(conn),
      },
      sheet: {
        boothNo: Number(b.booth_no),
        boothSuffix: String(b.booth_suffix),
        boothName: String(b.name_hindi),
        candidates: votes
          .filter((r) => Number(r.is_nota) === 0)
          .map((r) => ({
            position: Number(r.ballot_position),
            nameHindi: String(r.name_hindi),
            votes: Number(r.votes),
          })),
        notaVotes: Number(nota.votes),
        sheetTotal: Number(entry.sheet_total),
      },
    };
  });
}
