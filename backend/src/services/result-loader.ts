// Reads everything the result engine needs for one or more wards and calls it.
// READ ONLY: this file never writes. All reads happen inside ONE read-only transaction with a
// consistent snapshot, so a result never mixes data from before and after a concurrent save.
// The number of queries is fixed (8), whatever the number of wards.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { computeWardResult } from './result.js';
import type {
  BoothEntryInput,
  DeclarationInput,
  PostalEntryInput,
  ResultCandidateInput,
  VoteInput,
  WardResult,
  WardResultInput,
} from './result.js';

export class WardNotFoundError extends Error {
  override readonly name = 'WardNotFoundError';
  constructor(readonly wardIds: number[]) {
    super(`Ward(s) not found: ${wardIds.join(', ')}`);
  }
}

/**
 * Runs `work` inside a READ ONLY transaction with a consistent snapshot (REPEATABLE READ).
 * Transaction control is fixed SQL text without user input, so it uses query().
 */
export async function withReadOnlySnapshot<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    try {
      const value = await work(conn);
      await conn.query('COMMIT');
      return value;
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    }
  } finally {
    conn.release();
  }
}

/** "?, ?, ?" for an IN list. Only the COUNT of ids shapes the SQL; the ids are bound as parameters. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Reads the engine inputs of several wards on the given connection (8 queries, whatever the number
 * of wards). Callers own the transaction: loadWardResults uses a read-only snapshot; the counting
 * preview uses it to compute "the ward as if this entry were saved". Read only.
 */
export async function readWardInputs(
  conn: PoolConnection,
  wardIds: readonly number[],
): Promise<WardResultInput[]> {
  const ids = [...new Set(wardIds)].sort((a, b) => a - b);
  if (ids.length === 0) return [];
  const inList = placeholders(ids.length);
  // 1. Wards.
  const [wards] = await conn.execute<RowDataPacket[]>(
    `SELECT id, ward_type, is_unopposed FROM ward WHERE id IN (${inList})`,
    ids,
  );
  const found = new Set(wards.map((w) => Number(w.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new WardNotFoundError(missing);

  // 2. Booths: a PS ward's booths by ps_ward_id, a ZP ward's booths by zp_ward_id (across PS).
  const [booths] = await conn.execute<RowDataPacket[]>(
    `SELECT id, ps_ward_id, zp_ward_id FROM booth WHERE ps_ward_id IN (${inList}) OR zp_ward_id IN (${inList})`,
    [...ids, ...ids],
  );
  // 3. Candidates.
  const [candidates] = await conn.execute<RowDataPacket[]>(
    `SELECT id, ward_id, ballot_position, name_hindi, party_id, is_nota FROM candidate WHERE ward_id IN (${inList})`,
    ids,
  );
  // 4-5. Booth entries and their votes.
  const [boothEntries] = await conn.execute<RowDataPacket[]>(
    `SELECT id, ward_id, booth_id, round_no, sheet_total FROM booth_entry WHERE ward_id IN (${inList})`,
    ids,
  );
  const [boothVotes] = await conn.execute<RowDataPacket[]>(
    `SELECT entry_id, candidate_id, votes FROM booth_entry_vote WHERE ward_id IN (${inList})`,
    ids,
  );
  // 6-7. Postal entries and their votes.
  const [postalEntries] = await conn.execute<RowDataPacket[]>(
    `SELECT id, ward_id, sheet_total, rejected_count FROM postal_entry WHERE ward_id IN (${inList})`,
    ids,
  );
  const [postalVotes] = await conn.execute<RowDataPacket[]>(
    `SELECT entry_id, candidate_id, votes FROM postal_entry_vote WHERE ward_id IN (${inList})`,
    ids,
  );
  // 8. The latest declaration version of each ward.
  const [declarations] = await conn.execute<RowDataPacket[]>(
    `SELECT d.ward_id, d.version, d.status, d.winner_candidate_id, d.margin, d.snapshot
         FROM ward_declarations d
        WHERE d.ward_id IN (${inList})
          AND d.version = (SELECT MAX(d2.version) FROM ward_declarations d2 WHERE d2.ward_id = d.ward_id)`,
    ids,
  );

  const toVotes = (rows: RowDataPacket[] | undefined): VoteInput[] =>
    (rows ?? []).map((v) => ({ candidateId: Number(v.candidate_id), votes: Number(v.votes) }));
  const boothVotesByEntry = groupBy(boothVotes, (v) => Number(v.entry_id));
  const postalVotesByEntry = groupBy(postalVotes, (v) => Number(v.entry_id));
  const candidatesByWard = groupBy(candidates, (c) => Number(c.ward_id));
  const entriesByWard = groupBy(boothEntries, (e) => Number(e.ward_id));
  const postalByWard = new Map(postalEntries.map((p) => [Number(p.ward_id), p]));
  const declarationByWard = new Map(declarations.map((d) => [Number(d.ward_id), d]));

  return wards.map((w): WardResultInput => {
    const wardId = Number(w.id);
    const kind = w.ward_type === 'ZP' ? 'ZP' : 'PS';
    const boothIds = booths
      .filter((b) => Number(kind === 'PS' ? b.ps_ward_id : b.zp_ward_id) === wardId)
      .map((b) => Number(b.id));
    const wardCandidates: ResultCandidateInput[] = (candidatesByWard.get(wardId) ?? []).map(
      (c) => ({
        id: Number(c.id),
        ballotPosition: Number(c.ballot_position),
        nameHindi: String(c.name_hindi),
        partyId: c.party_id === null ? null : Number(c.party_id),
        isNota: Number(c.is_nota) === 1,
      }),
    );
    const entries: BoothEntryInput[] = (entriesByWard.get(wardId) ?? []).map((e) => ({
      boothId: Number(e.booth_id),
      roundNo: Number(e.round_no),
      sheetTotal: Number(e.sheet_total),
      votes: toVotes(boothVotesByEntry.get(Number(e.id))),
    }));
    const p = postalByWard.get(wardId);
    const postal: PostalEntryInput | null =
      p === undefined
        ? null
        : {
            sheetTotal: Number(p.sheet_total),
            rejectedCount: p.rejected_count === null ? null : Number(p.rejected_count),
            votes: toVotes(postalVotesByEntry.get(Number(p.id))),
          };
    const d = declarationByWard.get(wardId);
    const declaration: DeclarationInput | null =
      d === undefined
        ? null
        : {
            version: Number(d.version),
            status: d.status === 'TIE_RESOLVED' ? 'TIE_RESOLVED' : 'DECLARED',
            winnerCandidateId: Number(d.winner_candidate_id),
            margin: Number(d.margin),
            snapshot: d.snapshot as unknown,
          };
    return {
      ward: { id: wardId, kind, isUnopposed: Number(w.is_unopposed) === 1, boothIds },
      candidates: wardCandidates,
      boothEntries: entries,
      postalEntry: postal,
      latestDeclaration: declaration,
    };
  });
}

/** Loads and computes the results of several wards with a fixed number of queries. */
export async function loadWardResults(
  pool: Pool,
  wardIds: readonly number[],
): Promise<Map<number, WardResult>> {
  if (wardIds.length === 0) return new Map();
  const inputs = await withReadOnlySnapshot(pool, (conn) => readWardInputs(conn, wardIds));
  // The pure engine runs outside the transaction (no DB access needed).
  return new Map(inputs.map((input) => [input.ward.id, computeWardResult(input)]));
}

/** Loads and computes one ward's result. Throws WardNotFoundError for an unknown id. */
export async function loadWardResult(pool: Pool, wardId: number): Promise<WardResult> {
  const results = await loadWardResults(pool, [wardId]);
  const result = results.get(wardId);
  if (result === undefined) throw new WardNotFoundError([wardId]);
  return result;
}
