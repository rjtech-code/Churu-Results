// Counting writes: booth and postal result sheets. Every write is ONE transaction that locks the
// ward row first (readWard(..., true)), then checks the declaration, then writes entry + votes +
// audit. Previews run the same checks in a read-only snapshot and write nothing.
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteBallot, canWriteWard } from '../../services/access.js';
import type { BallotFor } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import {
  checkBoothSum,
  checkPostalSum,
  checkRegisteredVoters,
  checkVoteRows,
  sheetSum,
} from '../../services/entry-rules.js';
import type { BallotCandidate, SheetVote } from '../../services/entry-rules.js';
import { emitWardChanged } from '../../services/events.js';
import { computeWardResult } from '../../services/result.js';
import type { WardResult } from '../../services/result.js';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import type { AuthUser } from '../../types/auth.js';
import {
  assertWardOpenForCounting,
  isDuplicateKey,
  readBallot,
  readBooth,
  readWard,
  withWriteTransaction,
} from './counting.db.js';
import type { BoothRow } from './counting.db.js';

export interface WriteContext {
  user: AuthUser;
  ip: string | null;
  requireVoterCounts: boolean;
}

export interface BoothCreateBody {
  wardId: number;
  boothId: number;
  ballotFor: BallotFor;
  roundNo: number;
  sheetTotal: number;
  votes: SheetVote[];
}
export interface BoothUpdateBody {
  rowVersion: number;
  roundNo: number;
  sheetTotal: number;
  votes: SheetVote[];
  reason: string;
}
export interface VoidBody {
  rowVersion: number;
  reason: string;
}
export interface PostalCreateBody {
  sheetTotal: number;
  rejectedCount?: number | undefined;
  votes: SheetVote[];
}
export interface PostalUpdateBody extends PostalCreateBody {
  rowVersion: number;
  reason: string;
}

export interface WriteOutcome {
  entryId: number;
  wardId: number;
  warnings: string[];
}

export interface PreviewSummary {
  summary: {
    wardId: number;
    boothId: number | null;
    ballotFor: BallotFor | null;
    roundNo: number | null;
    sheetTotal: number;
    rejectedCount: number | null;
    sum: number;
    votes: {
      candidateId: number;
      ballotPosition: number;
      nameHindi: string;
      isNota: boolean;
      votes: number;
    }[];
  };
  wardAfter: WardResult;
  warnings: string[];
}

/** Vote rows in ballot order, with names looked up from the DB (never from the client). */
function namedVotes(candidates: readonly BallotCandidate[], votes: readonly SheetVote[]) {
  const byId = new Map(votes.map((v) => [v.candidateId, v.votes]));
  return candidates.map((c) => ({
    candidateId: c.id,
    ballotPosition: c.ballotPosition,
    nameHindi: c.nameHindi,
    isNota: c.isNota,
    votes: byId.get(c.id) ?? 0, // after checkVoteRows every candidate has exactly one row
  }));
}

export const plainVotes = (votes: readonly SheetVote[]) =>
  votes.map((v) => ({ candidateId: v.candidateId, votes: v.votes }));

// ============================================================== booth entries

/** Permission and ward membership, checked before any lock is taken. */
async function authorizeBooth(
  pool: Pool,
  ctx: WriteContext,
  body: BoothCreateBody,
): Promise<BoothRow> {
  const booth = await readBooth(pool, body.boothId);
  if (!(await canWriteBallot(pool, ctx.user, body.boothId, body.ballotFor)))
    throw new ApiError(403, 'FORBIDDEN');
  const realWard = body.ballotFor === 'PS' ? booth.psWardId : booth.zpWardId;
  if (realWard !== body.wardId) throw new ApiError(400, 'BOOTH_NOT_IN_WARD');
  return booth;
}

/** Every check of a booth create, on one connection (locking or snapshot). */
async function checkBoothCreate(
  conn: PoolConnection,
  ctx: WriteContext,
  body: BoothCreateBody,
  booth: BoothRow,
  lock: boolean,
): Promise<{ candidates: BallotCandidate[]; warnings: string[] }> {
  const ward = await readWard(conn, body.wardId, lock);
  await assertWardOpenForCounting(conn, ward);
  const [existing] = await conn.execute<RowDataPacket[]>(
    'SELECT id FROM booth_entry WHERE booth_id = ? AND ballot_for = ?',
    [body.boothId, body.ballotFor],
  );
  if (existing.length > 0) throw new ApiError(409, 'ALREADY_ENTERED');
  const candidates = await readBallot(conn, body.wardId);
  checkVoteRows(candidates, body.votes);
  checkBoothSum(body.votes, body.sheetTotal);
  const warnings = checkRegisteredVoters(
    body.sheetTotal,
    booth.registeredVotersTotal,
    ctx.requireVoterCounts,
  );
  return { candidates, warnings };
}

export async function previewBoothEntry(
  pool: Pool,
  ctx: WriteContext,
  body: BoothCreateBody,
): Promise<PreviewSummary> {
  const booth = await authorizeBooth(pool, ctx, body);
  return withReadOnlySnapshot(pool, async (conn) => {
    const { candidates, warnings } = await checkBoothCreate(conn, ctx, body, booth, false);
    const [input] = await readWardInputs(conn, [body.wardId]);
    if (!input) throw new ApiError(404, 'NOT_FOUND');
    // "What the ward would become": the engine on the saved data plus this sheet.
    const wardAfter = computeWardResult({
      ...input,
      boothEntries: [
        ...input.boothEntries,
        {
          boothId: body.boothId,
          roundNo: body.roundNo,
          sheetTotal: body.sheetTotal,
          votes: plainVotes(body.votes),
        },
      ],
    });
    return {
      summary: {
        wardId: body.wardId,
        boothId: body.boothId,
        ballotFor: body.ballotFor,
        roundNo: body.roundNo,
        sheetTotal: body.sheetTotal,
        rejectedCount: null,
        sum: sheetSum(body.votes),
        votes: namedVotes(candidates, body.votes),
      },
      wardAfter,
      warnings,
    };
  });
}

export async function createBoothEntry(
  pool: Pool,
  ctx: WriteContext,
  body: BoothCreateBody,
): Promise<WriteOutcome> {
  const booth = await authorizeBooth(pool, ctx, body);
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const { candidates, warnings } = await checkBoothCreate(conn, ctx, body, booth, true);
    let entryId: number;
    try {
      const [inserted] = await conn.execute<ResultSetHeader>(
        `INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [body.boothId, body.ballotFor, body.wardId, body.roundNo, body.sheetTotal, ctx.user.id],
      );
      entryId = inserted.insertId;
    } catch (err) {
      if (isDuplicateKey(err)) throw new ApiError(409, 'ALREADY_ENTERED'); // the UNIQUE key backstop
      throw err;
    }
    for (const v of namedVotes(candidates, body.votes)) {
      await conn.execute(
        'INSERT INTO booth_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
        [entryId, body.wardId, v.candidateId, v.votes],
      );
    }
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'ENTRY_CREATED',
      entity: 'booth_entry',
      entityId: entryId,
      newValue: {
        ward_id: body.wardId,
        booth_id: body.boothId,
        ballot_for: body.ballotFor,
        round_no: body.roundNo,
        sheet_total: body.sheetTotal,
        votes: plainVotes(body.votes),
      },
      ip: ctx.ip,
    });
    return { entryId, wardId: body.wardId, warnings };
  });
  emitWardChanged(outcome.wardId); // only after a successful commit
  return outcome;
}

export interface LiveBoothEntry {
  id: number;
  wardId: number;
  boothId: number;
  ballotFor: BallotFor;
  roundNo: number;
  sheetTotal: number;
  rowVersion: number;
  enteredBy: number;
  enteredAt: Date;
  updatedBy: number | null;
  updatedAt: Date | null;
}

export async function readBoothEntry(
  conn: Pool | PoolConnection,
  entryId: number,
  forUpdate: boolean,
): Promise<LiveBoothEntry> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    forUpdate
      ? `SELECT id, ward_id, booth_id, ballot_for, round_no, sheet_total, row_version, entered_by, entered_at,
                updated_by, updated_at FROM booth_entry WHERE id = ? FOR UPDATE`
      : `SELECT id, ward_id, booth_id, ballot_for, round_no, sheet_total, row_version, entered_by, entered_at,
                updated_by, updated_at FROM booth_entry WHERE id = ?`,
    [entryId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(r.id),
    wardId: Number(r.ward_id),
    boothId: Number(r.booth_id),
    ballotFor: r.ballot_for === 'ZP' ? 'ZP' : 'PS',
    roundNo: Number(r.round_no),
    sheetTotal: Number(r.sheet_total),
    rowVersion: Number(r.row_version),
    enteredBy: Number(r.entered_by),
    enteredAt: r.entered_at as Date,
    updatedBy: r.updated_by === null ? null : Number(r.updated_by),
    updatedAt: r.updated_at === null ? null : (r.updated_at as Date),
  };
}

async function readEntryVotes(
  conn: PoolConnection,
  table: 'booth_entry_vote' | 'postal_entry_vote',
  entryId: number,
) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    table === 'booth_entry_vote'
      ? `SELECT v.candidate_id, v.votes, c.ballot_position, c.name_hindi FROM booth_entry_vote v
           JOIN candidate c ON c.id = v.candidate_id WHERE v.entry_id = ? ORDER BY c.ballot_position`
      : `SELECT v.candidate_id, v.votes, c.ballot_position, c.name_hindi FROM postal_entry_vote v
           JOIN candidate c ON c.id = v.candidate_id WHERE v.entry_id = ? ORDER BY c.ballot_position`,
    [entryId],
  );
  return rows.map((r) => ({
    candidateId: Number(r.candidate_id),
    ballotPosition: Number(r.ballot_position),
    nameHindi: String(r.name_hindi),
    votes: Number(r.votes),
  }));
}

/** True when the (already validated, complete) new vote rows equal the saved ones exactly. */
function sameVotes(
  saved: readonly { candidateId: number; votes: number }[],
  next: readonly SheetVote[],
): boolean {
  if (saved.length !== next.length) return false;
  const byId = new Map(saved.map((v) => [v.candidateId, v.votes]));
  return next.every((v) => byId.get(v.candidateId) === v.votes);
}

/** Common start of update/void: permission, then ward lock, ward checks, entry lock, version check. */
async function lockBoothEntryForChange(
  pool: Pool,
  conn: PoolConnection,
  ctx: WriteContext,
  entryId: number,
  rowVersion: number,
): Promise<LiveBoothEntry> {
  const peek = await readBoothEntry(pool, entryId, false);
  if (!(await canWriteBallot(pool, ctx.user, peek.boothId, peek.ballotFor)))
    throw new ApiError(403, 'FORBIDDEN');
  const ward = await readWard(conn, peek.wardId, true); // ward lock first
  await assertWardOpenForCounting(conn, ward);
  const entry = await readBoothEntry(conn, entryId, true);
  if (entry.rowVersion !== rowVersion)
    throw new ApiError(409, 'STALE_VERSION', { currentRowVersion: entry.rowVersion });
  return entry;
}

/** Part 5 rules for a changed booth sheet (completeness, sum, registered voters). */
export async function checkBoothChange(
  conn: PoolConnection,
  ctx: WriteContext,
  entry: LiveBoothEntry,
  change: { sheetTotal: number; votes: SheetVote[] },
): Promise<{ candidates: BallotCandidate[]; warnings: string[] }> {
  const booth = await readBooth(conn, entry.boothId);
  const candidates = await readBallot(conn, entry.wardId);
  checkVoteRows(candidates, change.votes);
  checkBoothSum(change.votes, change.sheetTotal);
  const warnings = checkRegisteredVoters(
    change.sheetTotal,
    booth.registeredVotersTotal,
    ctx.requireVoterCounts,
  );
  return { candidates, warnings };
}

/**
 * Writes an already checked booth change: UPDATE guarded by row_version (+1), the vote rows and
 * an ENTRY_UPDATED audit row. Used by Part 5 edits and by Part 6 corrections (`auditExtra`).
 */
export async function writeBoothChange(
  conn: PoolConnection,
  ctx: WriteContext,
  entry: LiveBoothEntry,
  change: {
    rowVersion: number;
    roundNo: number;
    sheetTotal: number;
    votes: SheetVote[];
    reason: string;
  },
  candidates: readonly BallotCandidate[],
  auditExtra: Record<string, unknown> = {},
): Promise<void> {
  const oldVotes = await readEntryVotes(conn, 'booth_entry_vote', entry.id);
  const [updated] = await conn.execute<ResultSetHeader>(
    `UPDATE booth_entry SET round_no = ?, sheet_total = ?, updated_by = ?, row_version = row_version + 1
      WHERE id = ? AND row_version = ?`,
    [change.roundNo, change.sheetTotal, ctx.user.id, entry.id, change.rowVersion],
  );
  if (updated.affectedRows !== 1) throw new ApiError(409, 'STALE_VERSION');
  for (const v of namedVotes(candidates, change.votes)) {
    await conn.execute(
      'UPDATE booth_entry_vote SET votes = ? WHERE entry_id = ? AND candidate_id = ?',
      [v.votes, entry.id, v.candidateId],
    );
  }
  await writeAudit(conn, {
    userId: ctx.user.id,
    action: 'ENTRY_UPDATED',
    entity: 'booth_entry',
    entityId: entry.id,
    oldValue: {
      ward_id: entry.wardId,
      booth_id: entry.boothId,
      round_no: entry.roundNo,
      sheet_total: entry.sheetTotal,
      row_version: entry.rowVersion,
      votes: oldVotes.map((v) => ({ candidateId: v.candidateId, votes: v.votes })),
    },
    newValue: {
      ward_id: entry.wardId,
      booth_id: entry.boothId,
      round_no: change.roundNo,
      sheet_total: change.sheetTotal,
      row_version: entry.rowVersion + 1,
      votes: plainVotes(change.votes),
      ...auditExtra,
    },
    reason: change.reason,
    ip: ctx.ip,
  });
}

export async function updateBoothEntry(
  pool: Pool,
  ctx: WriteContext,
  entryId: number,
  body: BoothUpdateBody,
): Promise<WriteOutcome> {
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const entry = await lockBoothEntryForChange(pool, conn, ctx, entryId, body.rowVersion);
    const { candidates, warnings } = await checkBoothChange(conn, ctx, entry, body);
    const saved = await readEntryVotes(conn, 'booth_entry_vote', entry.id);
    if (
      body.roundNo === entry.roundNo &&
      body.sheetTotal === entry.sheetTotal &&
      sameVotes(saved, body.votes)
    ) {
      throw new ApiError(400, 'NO_CHANGE'); // nothing written: the transaction rolls back
    }
    await writeBoothChange(conn, ctx, entry, body, candidates);
    return { entryId, wardId: entry.wardId, warnings };
  });
  emitWardChanged(outcome.wardId);
  return outcome;
}

export async function voidBoothEntry(
  pool: Pool,
  ctx: WriteContext,
  entryId: number,
  body: VoidBody,
): Promise<{ archiveId: number; entryId: number; wardId: number }> {
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const entry = await lockBoothEntryForChange(pool, conn, ctx, entryId, body.rowVersion);
    const votes = await readEntryVotes(conn, 'booth_entry_vote', entryId);
    const [archived] = await conn.execute<ResultSetHeader>(
      `INSERT INTO voided_entry (entry_kind, original_entry_id, ward_id, booth_id, ballot_for, round_no, sheet_total,
         rejected_count, row_version, entered_by, entered_at, updated_by, updated_at, votes, voided_by, void_reason)
       VALUES ('BOOTH', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.wardId,
        entry.boothId,
        entry.ballotFor,
        entry.roundNo,
        entry.sheetTotal,
        entry.rowVersion,
        entry.enteredBy,
        entry.enteredAt,
        entry.updatedBy,
        entry.updatedAt,
        JSON.stringify(votes),
        ctx.user.id,
        body.reason,
      ],
    );
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'ENTRY_VOIDED',
      entity: 'booth_entry',
      entityId: entryId,
      oldValue: {
        ward_id: entry.wardId,
        booth_id: entry.boothId,
        ballot_for: entry.ballotFor,
        round_no: entry.roundNo,
        sheet_total: entry.sheetTotal,
        row_version: entry.rowVersion,
        entered_by: entry.enteredBy,
        entered_at: entry.enteredAt,
        votes: votes.map((v) => ({ candidateId: v.candidateId, votes: v.votes })),
      },
      newValue: { voided: true, archive_id: archived.insertId },
      reason: body.reason,
      ip: ctx.ip,
    });
    await conn.execute('DELETE FROM booth_entry_vote WHERE entry_id = ?', [entryId]);
    await conn.execute('DELETE FROM booth_entry WHERE id = ?', [entryId]);
    return { archiveId: archived.insertId, entryId, wardId: entry.wardId };
  });
  emitWardChanged(outcome.wardId);
  return outcome;
}

// ============================================================== postal entries

async function authorizeWard(pool: Pool, ctx: WriteContext, wardId: number): Promise<void> {
  await readWard(pool, wardId, false); // 404 for an unknown ward
  if (!(await canWriteWard(pool, ctx.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
}

async function checkPostalCreate(
  conn: PoolConnection,
  wardId: number,
  body: PostalCreateBody,
  lock: boolean,
): Promise<BallotCandidate[]> {
  const ward = await readWard(conn, wardId, lock);
  await assertWardOpenForCounting(conn, ward);
  const [existing] = await conn.execute<RowDataPacket[]>(
    'SELECT id FROM postal_entry WHERE ward_id = ?',
    [wardId],
  );
  if (existing.length > 0) throw new ApiError(409, 'ALREADY_ENTERED');
  const candidates = await readBallot(conn, wardId);
  checkVoteRows(candidates, body.votes);
  checkPostalSum(body.votes, body.sheetTotal, body.rejectedCount ?? null);
  return candidates;
}

export async function previewPostalEntry(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
  body: PostalCreateBody,
): Promise<PreviewSummary> {
  await authorizeWard(pool, ctx, wardId);
  return withReadOnlySnapshot(pool, async (conn) => {
    const candidates = await checkPostalCreate(conn, wardId, body, false);
    const [input] = await readWardInputs(conn, [wardId]);
    if (!input) throw new ApiError(404, 'NOT_FOUND');
    const wardAfter = computeWardResult({
      ...input,
      postalEntry: {
        sheetTotal: body.sheetTotal,
        rejectedCount: body.rejectedCount ?? null,
        votes: plainVotes(body.votes),
      },
    });
    return {
      summary: {
        wardId,
        boothId: null,
        ballotFor: null,
        roundNo: null,
        sheetTotal: body.sheetTotal,
        rejectedCount: body.rejectedCount ?? null,
        sum: sheetSum(body.votes),
        votes: namedVotes(candidates, body.votes),
      },
      wardAfter,
      warnings: [],
    };
  });
}

export async function createPostalEntry(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
  body: PostalCreateBody,
): Promise<WriteOutcome> {
  await authorizeWard(pool, ctx, wardId);
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const candidates = await checkPostalCreate(conn, wardId, body, true);
    let entryId: number;
    try {
      const [inserted] = await conn.execute<ResultSetHeader>(
        'INSERT INTO postal_entry (ward_id, sheet_total, rejected_count, entered_by) VALUES (?, ?, ?, ?)',
        [wardId, body.sheetTotal, body.rejectedCount ?? null, ctx.user.id],
      );
      entryId = inserted.insertId;
    } catch (err) {
      if (isDuplicateKey(err)) throw new ApiError(409, 'ALREADY_ENTERED');
      throw err;
    }
    for (const v of namedVotes(candidates, body.votes)) {
      await conn.execute(
        'INSERT INTO postal_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
        [entryId, wardId, v.candidateId, v.votes],
      );
    }
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'POSTAL_CREATED',
      entity: 'postal_entry',
      entityId: entryId,
      newValue: {
        ward_id: wardId,
        sheet_total: body.sheetTotal,
        rejected_count: body.rejectedCount ?? null,
        votes: plainVotes(body.votes),
      },
      ip: ctx.ip,
    });
    return { entryId, wardId, warnings: [] };
  });
  emitWardChanged(outcome.wardId);
  return outcome;
}

export interface LivePostalEntry {
  id: number;
  wardId: number;
  sheetTotal: number;
  rejectedCount: number | null;
  rowVersion: number;
  enteredBy: number;
  enteredAt: Date;
  updatedBy: number | null;
  updatedAt: Date | null;
}

export async function readPostalEntry(
  conn: Pool | PoolConnection,
  entryId: number,
  forUpdate: boolean,
): Promise<LivePostalEntry> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    forUpdate
      ? `SELECT id, ward_id, sheet_total, rejected_count, row_version, entered_by, entered_at, updated_by, updated_at
           FROM postal_entry WHERE id = ? FOR UPDATE`
      : `SELECT id, ward_id, sheet_total, rejected_count, row_version, entered_by, entered_at, updated_by, updated_at
           FROM postal_entry WHERE id = ?`,
    [entryId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(r.id),
    wardId: Number(r.ward_id),
    sheetTotal: Number(r.sheet_total),
    rejectedCount: r.rejected_count === null ? null : Number(r.rejected_count),
    rowVersion: Number(r.row_version),
    enteredBy: Number(r.entered_by),
    enteredAt: r.entered_at as Date,
    updatedBy: r.updated_by === null ? null : Number(r.updated_by),
    updatedAt: r.updated_at === null ? null : (r.updated_at as Date),
  };
}

async function lockPostalEntryForChange(
  pool: Pool,
  conn: PoolConnection,
  ctx: WriteContext,
  entryId: number,
  rowVersion: number,
): Promise<LivePostalEntry> {
  const peek = await readPostalEntry(pool, entryId, false);
  if (!(await canWriteWard(pool, ctx.user, peek.wardId))) throw new ApiError(403, 'FORBIDDEN');
  const ward = await readWard(conn, peek.wardId, true); // ward lock first
  await assertWardOpenForCounting(conn, ward);
  const entry = await readPostalEntry(conn, entryId, true);
  if (entry.rowVersion !== rowVersion)
    throw new ApiError(409, 'STALE_VERSION', { currentRowVersion: entry.rowVersion });
  return entry;
}

/** Part 5 rules for a changed postal sheet (completeness, sum via result.ts). */
export async function checkPostalChange(
  conn: PoolConnection,
  entry: LivePostalEntry,
  change: { sheetTotal: number; rejectedCount: number | null; votes: SheetVote[] },
): Promise<BallotCandidate[]> {
  const candidates = await readBallot(conn, entry.wardId);
  checkVoteRows(candidates, change.votes);
  checkPostalSum(change.votes, change.sheetTotal, change.rejectedCount);
  return candidates;
}

/** Writes an already checked postal change (row_version guard, vote rows, POSTAL_UPDATED audit). */
export async function writePostalChange(
  conn: PoolConnection,
  ctx: WriteContext,
  entry: LivePostalEntry,
  change: {
    rowVersion: number;
    sheetTotal: number;
    rejectedCount: number | null;
    votes: SheetVote[];
    reason: string;
  },
  candidates: readonly BallotCandidate[],
  auditExtra: Record<string, unknown> = {},
): Promise<void> {
  const oldVotes = await readEntryVotes(conn, 'postal_entry_vote', entry.id);
  const [updated] = await conn.execute<ResultSetHeader>(
    `UPDATE postal_entry SET sheet_total = ?, rejected_count = ?, updated_by = ?, row_version = row_version + 1
      WHERE id = ? AND row_version = ?`,
    [change.sheetTotal, change.rejectedCount, ctx.user.id, entry.id, change.rowVersion],
  );
  if (updated.affectedRows !== 1) throw new ApiError(409, 'STALE_VERSION');
  for (const v of namedVotes(candidates, change.votes)) {
    await conn.execute(
      'UPDATE postal_entry_vote SET votes = ? WHERE entry_id = ? AND candidate_id = ?',
      [v.votes, entry.id, v.candidateId],
    );
  }
  await writeAudit(conn, {
    userId: ctx.user.id,
    action: 'POSTAL_UPDATED',
    entity: 'postal_entry',
    entityId: entry.id,
    oldValue: {
      ward_id: entry.wardId,
      sheet_total: entry.sheetTotal,
      rejected_count: entry.rejectedCount,
      row_version: entry.rowVersion,
      votes: oldVotes.map((v) => ({ candidateId: v.candidateId, votes: v.votes })),
    },
    newValue: {
      ward_id: entry.wardId,
      sheet_total: change.sheetTotal,
      rejected_count: change.rejectedCount,
      row_version: entry.rowVersion + 1,
      votes: plainVotes(change.votes),
      ...auditExtra,
    },
    reason: change.reason,
    ip: ctx.ip,
  });
}

export async function updatePostalEntry(
  pool: Pool,
  ctx: WriteContext,
  entryId: number,
  body: PostalUpdateBody,
): Promise<WriteOutcome> {
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const entry = await lockPostalEntryForChange(pool, conn, ctx, entryId, body.rowVersion);
    const change = { ...body, rejectedCount: body.rejectedCount ?? null };
    const candidates = await checkPostalChange(conn, entry, change);
    const saved = await readEntryVotes(conn, 'postal_entry_vote', entry.id);
    if (
      change.sheetTotal === entry.sheetTotal &&
      change.rejectedCount === entry.rejectedCount &&
      sameVotes(saved, change.votes)
    ) {
      throw new ApiError(400, 'NO_CHANGE'); // nothing written: the transaction rolls back
    }
    await writePostalChange(conn, ctx, entry, change, candidates);
    return { entryId, wardId: entry.wardId, warnings: [] };
  });
  emitWardChanged(outcome.wardId);
  return outcome;
}

export async function voidPostalEntry(
  pool: Pool,
  ctx: WriteContext,
  entryId: number,
  body: VoidBody,
): Promise<{ archiveId: number; entryId: number; wardId: number }> {
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const entry = await lockPostalEntryForChange(pool, conn, ctx, entryId, body.rowVersion);
    const votes = await readEntryVotes(conn, 'postal_entry_vote', entryId);
    const [archived] = await conn.execute<ResultSetHeader>(
      `INSERT INTO voided_entry (entry_kind, original_entry_id, ward_id, booth_id, ballot_for, round_no, sheet_total,
         rejected_count, row_version, entered_by, entered_at, updated_by, updated_at, votes, voided_by, void_reason)
       VALUES ('POSTAL', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.wardId,
        entry.sheetTotal,
        entry.rejectedCount,
        entry.rowVersion,
        entry.enteredBy,
        entry.enteredAt,
        entry.updatedBy,
        entry.updatedAt,
        JSON.stringify(votes),
        ctx.user.id,
        body.reason,
      ],
    );
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'POSTAL_VOIDED',
      entity: 'postal_entry',
      entityId: entryId,
      oldValue: {
        ward_id: entry.wardId,
        sheet_total: entry.sheetTotal,
        rejected_count: entry.rejectedCount,
        row_version: entry.rowVersion,
        entered_by: entry.enteredBy,
        entered_at: entry.enteredAt,
        votes: votes.map((v) => ({ candidateId: v.candidateId, votes: v.votes })),
      },
      newValue: { voided: true, archive_id: archived.insertId },
      reason: body.reason,
      ip: ctx.ip,
    });
    await conn.execute('DELETE FROM postal_entry_vote WHERE entry_id = ?', [entryId]);
    await conn.execute('DELETE FROM postal_entry WHERE id = ?', [entryId]);
    return { archiveId: archived.insertId, entryId, wardId: entry.wardId };
  });
  emitWardChanged(outcome.wardId);
  return outcome;
}
