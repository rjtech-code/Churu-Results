// Reads everything the Counting Status Report needs in ONE read-only consistent snapshot (a fixed
// number of queries, whatever the number of wards), including the DB clock, so the "as of" time,
// every count and the stalled check all describe the same moment. Read only.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { readElectionDate } from '../../services/election-date.js';
import { buildCountingStatus, displayPsName } from '../../services/counting-status.js';
import type {
  CountingStatusRaw,
  CountingStatusReport,
  UserRef,
} from '../../services/counting-status.js';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import { ResultInputError, computeWardResult } from '../../services/result.js';
import type { WardResult } from '../../services/result.js';

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toDateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : toDate(v);
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

export async function readCountingStatusRaw(pool: Pool): Promise<CountingStatusRaw> {
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const [now] = await conn.execute<RowDataPacket[]>('SELECT NOW(3) AS now');
    const electionDate = await readElectionDate(conn);
    const [ps] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name_english FROM panchayat_samiti ORDER BY id',
    );
    const [wards] = await conn.execute<RowDataPacket[]>(
      `SELECT w.id, w.ward_type, w.ward_no, w.panchayat_samiti_id, w.is_unopposed,
              EXISTS (SELECT 1 FROM candidate c WHERE c.ward_id = w.id) AS has_candidates
         FROM ward w ORDER BY w.id`,
    );
    const [booths] = await conn.execute<RowDataPacket[]>(
      `SELECT id, panchayat_samiti_id, booth_no, name_english, name_hindi, ps_ward_id, zp_ward_id
         FROM booth ORDER BY id`,
    );
    const [entries] = await conn.execute<RowDataPacket[]>(
      `SELECT e.booth_id, e.ballot_for, e.round_no, e.sheet_total, e.entered_at, e.updated_at,
              u.username, u.role, ups.name_english AS user_ps
         FROM booth_entry e
         JOIN users u ON u.id = e.entered_by
         LEFT JOIN panchayat_samiti ups ON ups.id = u.panchayat_samiti_id`,
    );
    const [postal] = await conn.execute<RowDataPacket[]>(
      'SELECT ward_id, entered_at, updated_at FROM postal_entry',
    );
    const [assignments] = await conn.execute<RowDataPacket[]>(
      'SELECT zp_ward_id, ps_id FROM zp_ward_postal_assignment',
    );
    const [declarations] = await conn.execute<RowDataPacket[]>(
      `SELECT d.ward_id, d.winner_candidate_id, d.margin FROM ward_declarations d
        WHERE d.version = (SELECT MAX(d2.version) FROM ward_declarations d2 WHERE d2.ward_id = d.ward_id)`,
    );
    const [candidates] = await conn.execute<RowDataPacket[]>(
      `SELECT c.id, c.name_hindi, p.short_name FROM candidate c
         LEFT JOIN party p ON p.id = c.party_id WHERE c.is_nota = 0`,
    );
    const withCandidates = wards
      .filter((w) => Number(w.has_candidates) === 1)
      .map((w) => Number(w.id));
    const inputs = await readWardInputs(conn, withCandidates);
    return {
      now,
      electionDate,
      ps,
      wards,
      booths,
      entries,
      postal,
      assignments,
      declarations,
      candidates,
      inputs,
    };
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
    asOf: toDate(read.now[0]?.now),
    electionDate: read.electionDate,
    ps: read.ps.map((p) => ({ id: Number(p.id), nameEnglish: str(p.name_english) })),
    wards: read.wards.map((w) => ({
      id: Number(w.id),
      kind: w.ward_type === 'ZP' ? 'ZP' : 'PS',
      wardNo: Number(w.ward_no),
      psId: w.panchayat_samiti_id === null ? null : Number(w.panchayat_samiti_id),
      isUnopposed: Number(w.is_unopposed) === 1,
    })),
    booths: read.booths.map((b) => {
      const english = str(b.name_english).trim();
      return {
        id: Number(b.id),
        psId: Number(b.panchayat_samiti_id),
        boothNo: Number(b.booth_no),
        // English name; the stored (Hindi) name only when no English name exists.
        name: english === '' ? str(b.name_hindi) : english,
        psWardId: Number(b.ps_ward_id),
        zpWardId: Number(b.zp_ward_id),
      };
    }),
    entries: read.entries.map((e) => {
      const user: UserRef = {
        username: str(e.username),
        role: str(e.role),
        psName: e.user_ps === null ? null : str(e.user_ps),
      };
      return {
        boothId: Number(e.booth_id),
        ballotFor: e.ballot_for === 'ZP' ? 'ZP' : 'PS',
        roundNo: Number(e.round_no),
        sheetTotal: Number(e.sheet_total),
        enteredAt: toDate(e.entered_at),
        updatedAt: toDateOrNull(e.updated_at),
        enteredBy: user,
      };
    }),
    postal: read.postal.map((p) => ({
      wardId: Number(p.ward_id),
      enteredAt: toDate(p.entered_at),
      updatedAt: toDateOrNull(p.updated_at),
    })),
    postalAssignments: read.assignments.map((a) => ({
      wardId: Number(a.zp_ward_id),
      psId: Number(a.ps_id),
    })),
    declarations: read.declarations.map((d) => ({
      wardId: Number(d.ward_id),
      winnerCandidateId: Number(d.winner_candidate_id),
      margin: Number(d.margin),
    })),
    candidates: read.candidates.map((c) => ({
      id: Number(c.id),
      name: str(c.name_hindi),
      partyShortName: c.short_name === null ? null : str(c.short_name),
    })),
    results,
  };
}

/** THE one source for the UI, the PDF and both CSVs: a fresh read every call (no cache). */
export async function readCountingStatus(pool: Pool): Promise<CountingStatusReport> {
  return buildCountingStatus(await readCountingStatusRaw(pool));
}

// ---- The report builder's dropdowns: names and ids only (no counting data).

export interface ScopeOptions {
  ps: { id: number; name: string }[];
  wards: { id: number; kind: 'PS' | 'ZP'; psId: number | null; wardNo: number }[];
}

/**
 * Every PS (display name order) and every ward, for the cascading selects. ZP_ONLY (the ZP_RO): no
 * Panchayat Samiti and only the Zila Parishad wards.
 */
export async function readScopeOptions(pool: Pool, mode: 'ALL' | 'ZP_ONLY'): Promise<ScopeOptions> {
  const zpOnly = mode === 'ZP_ONLY';
  const ps: RowDataPacket[] = zpOnly
    ? []
    : (await pool.execute<RowDataPacket[]>('SELECT id, name_english FROM panchayat_samiti'))[0];
  const [wards] = await pool.execute<RowDataPacket[]>(
    zpOnly
      ? "SELECT id, ward_type, panchayat_samiti_id, ward_no FROM ward WHERE ward_type = 'ZP' ORDER BY ward_no"
      : 'SELECT id, ward_type, panchayat_samiti_id, ward_no FROM ward ORDER BY ward_type, ward_no',
  );
  return {
    ps: ps
      .map((p) => ({ id: Number(p.id), name: displayPsName(str(p.name_english)) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    wards: wards.map((w) => ({
      id: Number(w.id),
      kind: w.ward_type === 'ZP' ? 'ZP' : 'PS',
      psId: w.panchayat_samiti_id === null ? null : Number(w.panchayat_samiti_id),
      wardNo: Number(w.ward_no),
    })),
  };
}

export interface BoothOption {
  id: number;
  boothNo: number;
  name: string;
  /** The booth's PS (display name): booth numbers restart in every PS, a ZP ward spans several. */
  psName: string;
}

/**
 * The booths of one ward of the given kind (PS: the DM's booth picker; ZP: the ZP_RO's), in PS
 * then booth-number order; null for an unknown ward or a ward of the other kind.
 */
export async function readWardBooths(
  pool: Pool,
  wardId: number,
  kind: 'PS' | 'ZP',
): Promise<BoothOption[] | null> {
  const [ward] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM ward WHERE id = ? AND ward_type = ?',
    [wardId, kind],
  );
  if (ward.length === 0) return null;
  const [booths] = await pool.execute<RowDataPacket[]>(
    kind === 'PS'
      ? `SELECT b.id, b.booth_no, b.name_english, b.name_hindi, ps.name_english AS ps_name
           FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
          WHERE b.ps_ward_id = ?`
      : `SELECT b.id, b.booth_no, b.name_english, b.name_hindi, ps.name_english AS ps_name
           FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
          WHERE b.zp_ward_id = ?`,
    [wardId],
  );
  return booths
    .map((b) => {
      const english = str(b.name_english).trim();
      return {
        id: Number(b.id),
        boothNo: Number(b.booth_no),
        name: english === '' ? str(b.name_hindi) : english,
        psName: displayPsName(str(b.ps_name)),
      };
    })
    .sort((a, b) => a.psName.localeCompare(b.psName, 'en') || a.boothNo - b.boothNo);
}
