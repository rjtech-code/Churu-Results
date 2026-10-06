// Declare a ward, record a tie lottery, and correct a declared ward through a new declaration
// version. Every write follows the README lock order: password re-check (outside the lock), then
// the ward row FOR UPDATE, then reads on the SAME connection, then writes, then commit.
// No vote is added here: results come from computeWardResult (result.ts) only.
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { canWriteWard } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import type { SheetVote } from '../../services/entry-rules.js';
import { emitWardChanged } from '../../services/events.js';
import { buildDeclarationSnapshot, computeWardResult } from '../../services/result.js';
import type { DeclarationSnapshot, WardResult, WardResultInput } from '../../services/result.js';
import { readWardInputs, withReadOnlySnapshot } from '../../services/result-loader.js';
import { reauthenticate, resetFailedLogins } from '../auth/auth.service.js';
import { readWard, withWriteTransaction } from '../counting/counting.db.js';
import {
  checkBoothChange,
  checkPostalChange,
  plainVotes,
  readBoothEntry,
  readPostalEntry,
  writeBoothChange,
  writePostalChange,
} from '../counting/counting.service.js';
import type {
  LiveBoothEntry,
  LivePostalEntry,
  WriteContext,
} from '../counting/counting.service.js';

// ---------------------------------------------------------------- types

export interface LotteryInput {
  winnerCandidateId: number;
  conductedBy: string;
  note: string;
}

interface DecisionFields {
  confirmWinnerCandidateId: number;
  confirmTotalValidVotes: number;
  lottery?: LotteryInput | undefined;
  acknowledgeNotaHighest?: true | undefined;
}

export interface DeclareBody extends DecisionFields {
  password: string;
}

export type CorrectionChange =
  | {
      kind: 'BOOTH';
      entryId: number;
      rowVersion: number;
      roundNo?: number | undefined;
      sheetTotal: number;
      votes: SheetVote[];
    }
  | {
      kind: 'POSTAL';
      entryId: number;
      rowVersion: number;
      sheetTotal: number;
      rejectedCount?: number | null | undefined;
      votes: SheetVote[];
    };

export interface CorrectionBody extends DecisionFields {
  password: string;
  reason: string;
  changes: CorrectionChange[];
}

/** What a declaration (or correction) would store. */
export interface DeclarationPlan {
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  /** null while a lottery is still needed (preview of a tie). */
  winnerCandidateId: number | null;
  margin: number;
  snapshot: DeclarationSnapshot;
  needsLottery: boolean;
  tiedCandidateIds: number[];
  notaHighest: boolean;
}

interface Decision {
  status: 'DECLARED' | 'TIE_RESOLVED';
  winnerCandidateId: number;
  margin: number;
  lotteryDetails: (LotteryInput & { tiedCandidateIds: number[] }) | null;
  notaHighestAck: boolean;
}

interface LatestDeclaration {
  version: number;
  status: string;
  winnerCandidateId: number;
  margin: number;
  snapshot: unknown;
}

// ---------------------------------------------------------------- shared rules

async function authorizeWard(pool: Pool, ctx: WriteContext, wardId: number): Promise<void> {
  await readWard(pool, wardId, false); // 404 for an unknown ward
  if (!(await canWriteWard(pool, ctx.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
}

/** Password re-check before any lock. Failures are counted (lockout) and audited by reauthenticate. */
async function requireReauth(pool: Pool, ctx: WriteContext, password: string): Promise<void> {
  const outcome = await reauthenticate(pool, ctx.user.id, password, ctx.ip);
  if (outcome.kind === 'locked') {
    throw new ApiError(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: outcome.retryAfterSeconds });
  }
  if (outcome.kind === 'invalid') throw new ApiError(401, 'REAUTH_FAILED');
}

/** Real candidates sharing the top vote count (from the engine's output; nothing is added here). */
function topTiedIds(result: WardResult): number[] {
  const top = result.leader?.totalVotes;
  return result.candidates.filter((c) => !c.isNota && c.totalVotes === top).map((c) => c.id);
}

function assertComplete(result: WardResult): void {
  if (result.status !== 'READY_TO_DECLARE' && result.status !== 'TIE_NEEDS_LOTTERY') {
    throw new ApiError(409, 'COUNTING_INCOMPLETE', {
      status: result.status,
      boothsEntered: result.boothsEntered,
      boothsTotal: result.boothsTotal,
      postalEntered: result.postalEntered,
    });
  }
}

function plan(result: WardResult, version: number): DeclarationPlan {
  const tie = result.status === 'TIE_NEEDS_LOTTERY';
  return {
    version,
    status: tie ? 'TIE_RESOLVED' : 'DECLARED',
    winnerCandidateId: tie ? null : (result.leader?.candidateId ?? null),
    margin: tie ? 0 : (result.margin ?? 0),
    snapshot: buildDeclarationSnapshot(result),
    needsLottery: tie,
    tiedCandidateIds: tie ? topTiedIds(result) : [],
    notaHighest: result.notaHighest,
  };
}

/**
 * The lottery, confirmation and NOTA rules shared by declare and correction.
 * `result` is the freshly computed result WITHOUT any declaration (status READY or TIE).
 */
function decide(result: WardResult, body: DecisionFields): Decision {
  const tie = result.status === 'TIE_NEEDS_LOTTERY';
  let winnerCandidateId: number;
  let lotteryDetails: Decision['lotteryDetails'] = null;
  if (!tie) {
    if (body.lottery !== undefined) throw new ApiError(400, 'LOTTERY_NOT_ALLOWED');
    winnerCandidateId = result.leader?.candidateId ?? 0;
  } else {
    if (body.lottery === undefined) {
      throw new ApiError(400, 'LOTTERY_REQUIRED', { tiedCandidateIds: topTiedIds(result) });
    }
    const tied = topTiedIds(result);
    if (!tied.includes(body.lottery.winnerCandidateId)) {
      throw new ApiError(400, 'LOTTERY_WINNER_NOT_TIED', { tiedCandidateIds: tied });
    }
    winnerCandidateId = body.lottery.winnerCandidateId;
    lotteryDetails = { ...body.lottery, tiedCandidateIds: tied };
  }
  // The RO confirms what the screen showed; a stale screen must not declare.
  if (
    body.confirmTotalValidVotes !== result.totalValidVotes ||
    body.confirmWinnerCandidateId !== winnerCandidateId
  ) {
    throw new ApiError(409, 'RESULT_CHANGED', { result });
  }
  if (result.notaHighest && body.acknowledgeNotaHighest !== true) {
    throw new ApiError(409, 'NOTA_HIGHEST_ACK_REQUIRED', { notaVotes: result.notaVotes });
  }
  return {
    status: tie ? 'TIE_RESOLVED' : 'DECLARED',
    winnerCandidateId,
    margin: tie ? 0 : (result.margin ?? 0),
    lotteryDetails,
    notaHighestAck: result.notaHighest && body.acknowledgeNotaHighest === true,
  };
}

async function readLatestDeclaration(
  conn: Pool | PoolConnection,
  wardId: number,
): Promise<LatestDeclaration | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT version, status, winner_candidate_id, margin, snapshot FROM ward_declarations
      WHERE ward_id = ? ORDER BY version DESC LIMIT 1`,
    [wardId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    version: Number(r.version),
    status: String(r.status),
    winnerCandidateId: Number(r.winner_candidate_id),
    margin: Number(r.margin),
    snapshot: r.snapshot as unknown,
  };
}

async function readInput(conn: PoolConnection, wardId: number): Promise<WardResultInput> {
  const [input] = await readWardInputs(conn, [wardId]);
  if (!input) throw new ApiError(404, 'NOT_FOUND');
  return input;
}

async function insertDeclaration(
  conn: PoolConnection,
  ctx: WriteContext,
  wardId: number,
  version: number,
  decision: Decision,
  snapshot: DeclarationSnapshot,
  correctionReason: string | null,
): Promise<number> {
  const [inserted] = await conn.execute<ResultSetHeader>(
    `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot,
       lottery_details, nota_highest_ack, declared_by, correction_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wardId,
      version,
      decision.status,
      decision.winnerCandidateId,
      decision.margin,
      JSON.stringify(snapshot),
      decision.lotteryDetails === null ? null : JSON.stringify(decision.lotteryDetails),
      decision.notaHighestAck ? 1 : 0,
      ctx.user.id,
      correctionReason,
    ],
  );
  return inserted.insertId;
}

/** Deep equality of plain JSON values (key order does not matter; array order does). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

// ---------------------------------------------------------------- declare

export async function previewDeclaration(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
): Promise<{ result: WardResult; wouldStore: DeclarationPlan }> {
  await authorizeWard(pool, ctx, wardId);
  return withReadOnlySnapshot(pool, async (conn) => {
    const ward = await readWard(conn, wardId, false);
    if (ward.isUnopposed) throw new ApiError(409, 'WARD_UNOPPOSED');
    if ((await readLatestDeclaration(conn, wardId)) !== null)
      throw new ApiError(409, 'ALREADY_DECLARED');
    const result = computeWardResult(await readInput(conn, wardId));
    assertComplete(result);
    return { result, wouldStore: plan(result, 1) };
  });
}

export async function declareWard(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
  body: DeclareBody,
): Promise<{ wardId: number; version: number }> {
  await authorizeWard(pool, ctx, wardId);
  await requireReauth(pool, ctx, body.password); // before the ward lock (bcrypt is slow)
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const ward = await readWard(conn, wardId, true); // the ward lock: always first
    if (ward.isUnopposed) throw new ApiError(409, 'WARD_UNOPPOSED');
    if ((await readLatestDeclaration(conn, wardId)) !== null)
      throw new ApiError(409, 'ALREADY_DECLARED');
    const result = computeWardResult(await readInput(conn, wardId));
    assertComplete(result);
    const decision = decide(result, body);
    await insertDeclaration(conn, ctx, wardId, 1, decision, buildDeclarationSnapshot(result), null);
    await resetFailedLogins(conn, ctx.user.id);
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'WARD_DECLARED',
      entity: 'ward',
      entityId: wardId,
      newValue: {
        version: 1,
        status: decision.status,
        winner_candidate_id: decision.winnerCandidateId,
        margin: decision.margin,
        total_valid_votes: result.totalValidVotes,
        nota_votes: result.notaVotes,
        rejected_postal: result.rejectedPostal,
        lottery: decision.lotteryDetails,
        nota_highest: result.notaHighest,
        nota_highest_ack: decision.notaHighestAck,
      },
      ip: ctx.ip,
    });
    return { wardId, version: 1 };
  });
  emitWardChanged(wardId); // only after a successful commit
  return outcome;
}

// ---------------------------------------------------------------- correction

interface CheckedChange {
  change: CorrectionChange;
  booth: LiveBoothEntry | null;
  postal: LivePostalEntry | null;
  roundNo: number;
  rejectedCount: number | null;
  candidates: Awaited<ReturnType<typeof checkPostalChange>>;
}

function assertNoDuplicateChanges(changes: readonly CorrectionChange[]): void {
  const seen = new Set<string>();
  for (const c of changes) {
    const key = `${c.kind}:${c.entryId}`;
    if (seen.has(key))
      throw new ApiError(400, 'DUPLICATE_CHANGE', { kind: c.kind, entryId: c.entryId });
    seen.add(key);
  }
}

/** Locks (or reads) every changed entry, checks ward, rowVersion and the Part 5 sheet rules. */
async function checkChanges(
  conn: PoolConnection,
  ctx: WriteContext,
  wardId: number,
  changes: readonly CorrectionChange[],
  lock: boolean,
): Promise<{ checked: CheckedChange[]; warnings: string[] }> {
  const ordered = [...changes].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.entryId - b.entryId,
  );
  const checked: CheckedChange[] = [];
  const warnings = new Set<string>();
  for (const change of ordered) {
    if (change.kind === 'BOOTH') {
      const entry = await readBoothEntry(conn, change.entryId, lock);
      if (entry.wardId !== wardId)
        throw new ApiError(400, 'ENTRY_NOT_IN_WARD', { kind: 'BOOTH', entryId: change.entryId });
      if (entry.rowVersion !== change.rowVersion) {
        throw new ApiError(409, 'STALE_VERSION', {
          entryId: entry.id,
          currentRowVersion: entry.rowVersion,
        });
      }
      const result = await checkBoothChange(conn, ctx, entry, change);
      for (const w of result.warnings) warnings.add(w);
      checked.push({
        change,
        booth: entry,
        postal: null,
        roundNo: change.roundNo ?? entry.roundNo,
        rejectedCount: null,
        candidates: result.candidates,
      });
    } else {
      const entry = await readPostalEntry(conn, change.entryId, lock);
      if (entry.wardId !== wardId)
        throw new ApiError(400, 'ENTRY_NOT_IN_WARD', { kind: 'POSTAL', entryId: change.entryId });
      if (entry.rowVersion !== change.rowVersion) {
        throw new ApiError(409, 'STALE_VERSION', {
          entryId: entry.id,
          currentRowVersion: entry.rowVersion,
        });
      }
      const rejectedCount =
        change.rejectedCount === undefined ? entry.rejectedCount : change.rejectedCount;
      const candidates = await checkPostalChange(conn, entry, { ...change, rejectedCount });
      checked.push({ change, booth: null, postal: entry, roundNo: 0, rejectedCount, candidates });
    }
  }
  return { checked, warnings: [...warnings] };
}

/** The ward's inputs with the corrections applied in memory, without the declaration. */
function applyChanges(input: WardResultInput, checked: readonly CheckedChange[]): WardResultInput {
  let boothEntries = [...input.boothEntries];
  let postalEntry = input.postalEntry;
  for (const c of checked) {
    if (c.booth !== null) {
      const boothId = c.booth.boothId;
      boothEntries = boothEntries.map((e) =>
        e.boothId === boothId
          ? {
              boothId,
              roundNo: c.roundNo,
              sheetTotal: c.change.sheetTotal,
              votes: plainVotes(c.change.votes),
            }
          : e,
      );
    } else {
      postalEntry = {
        sheetTotal: c.change.sheetTotal,
        rejectedCount: c.rejectedCount,
        votes: plainVotes(c.change.votes),
      };
    }
  }
  return { ...input, boothEntries, postalEntry, latestDeclaration: null };
}

async function prepareCorrection(
  conn: PoolConnection,
  ctx: WriteContext,
  wardId: number,
  changes: readonly CorrectionChange[],
  lock: boolean,
) {
  await readWard(conn, wardId, lock); // with lock: the ward lock, always first
  const latest = await readLatestDeclaration(conn, wardId);
  if (latest === null) throw new ApiError(409, 'NOT_DECLARED');
  const { checked, warnings } = await checkChanges(conn, ctx, wardId, changes, lock);
  const input = await readInput(conn, wardId);
  const before = computeWardResult(input);
  const after = computeWardResult(applyChanges(input, checked));
  assertComplete(after);
  const snapshot = buildDeclarationSnapshot(after);
  if (sameJson(snapshot, latest.snapshot)) throw new ApiError(400, 'NO_CHANGE');
  return { latest, checked, warnings, before, after, snapshot };
}

export async function previewCorrection(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
  changes: CorrectionChange[],
) {
  assertNoDuplicateChanges(changes);
  await authorizeWard(pool, ctx, wardId);
  return withReadOnlySnapshot(pool, async (conn) => {
    const p = await prepareCorrection(conn, ctx, wardId, changes, false);
    return {
      before: p.before,
      after: p.after,
      wouldStore: plan(p.after, p.latest.version + 1),
      warnings: p.warnings,
    };
  });
}

export async function correctWard(
  pool: Pool,
  ctx: WriteContext,
  wardId: number,
  body: CorrectionBody,
): Promise<{ wardId: number; version: number; warnings: string[] }> {
  assertNoDuplicateChanges(body.changes);
  await authorizeWard(pool, ctx, wardId);
  await requireReauth(pool, ctx, body.password);
  const outcome = await withWriteTransaction(pool, async (conn) => {
    const p = await prepareCorrection(conn, ctx, wardId, body.changes, true);
    const decision = decide(p.after, body);
    const version = p.latest.version + 1;
    const auditExtra = { correction_version: version };
    for (const c of p.checked) {
      if (c.booth !== null) {
        await writeBoothChange(
          conn,
          ctx,
          c.booth,
          {
            rowVersion: c.change.rowVersion,
            roundNo: c.roundNo,
            sheetTotal: c.change.sheetTotal,
            votes: c.change.votes,
            reason: body.reason,
          },
          c.candidates,
          auditExtra,
        );
      } else if (c.postal !== null) {
        await writePostalChange(
          conn,
          ctx,
          c.postal,
          {
            rowVersion: c.change.rowVersion,
            sheetTotal: c.change.sheetTotal,
            rejectedCount: c.rejectedCount,
            votes: c.change.votes,
            reason: body.reason,
          },
          c.candidates,
          auditExtra,
        );
      }
    }
    await insertDeclaration(conn, ctx, wardId, version, decision, p.snapshot, body.reason);
    await resetFailedLogins(conn, ctx.user.id);
    const oldTotal = (p.latest.snapshot as { totalValidVotes?: unknown } | null)?.totalValidVotes;
    await writeAudit(conn, {
      userId: ctx.user.id,
      action: 'WARD_CORRECTED',
      entity: 'ward',
      entityId: wardId,
      oldValue: {
        version: p.latest.version,
        status: p.latest.status,
        winner_candidate_id: p.latest.winnerCandidateId,
        margin: p.latest.margin,
        total_valid_votes: typeof oldTotal === 'number' ? oldTotal : null,
      },
      newValue: {
        version,
        status: decision.status,
        winner_candidate_id: decision.winnerCandidateId,
        margin: decision.margin,
        total_valid_votes: p.after.totalValidVotes,
        lottery: decision.lotteryDetails,
        nota_highest: p.after.notaHighest,
        nota_highest_ack: decision.notaHighestAck,
        changed_entries: p.checked.map((c) => ({
          kind: c.change.kind,
          entry_id: c.change.entryId,
        })),
      },
      reason: body.reason,
      ip: ctx.ip,
    });
    return { wardId, version, warnings: p.warnings };
  });
  emitWardChanged(wardId);
  return outcome;
}

// ---------------------------------------------------------------- read

/** All declaration versions of a ward, oldest first (for the ward's RO). */
export async function listDeclarations(pool: Pool, ctx: WriteContext, wardId: number) {
  await authorizeWard(pool, ctx, wardId);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.version, d.status, d.winner_candidate_id, c.name_hindi AS winner_name, d.margin, d.snapshot,
            d.lottery_details, d.nota_highest_ack, u.username, u.full_name, d.declared_at, d.correction_reason
       FROM ward_declarations d
       JOIN candidate c ON c.id = d.winner_candidate_id
       JOIN users u ON u.id = d.declared_by
      WHERE d.ward_id = ? ORDER BY d.version`,
    [wardId],
  );
  return rows.map((r) => {
    const snapshot = r.snapshot as {
      totalValidVotes?: unknown;
      rejectedPostal?: unknown;
      candidates?: unknown;
    } | null;
    return {
      version: Number(r.version),
      status: String(r.status),
      winner: { id: Number(r.winner_candidate_id), nameHindi: String(r.winner_name) },
      margin: Number(r.margin),
      totalValidVotes:
        typeof snapshot?.totalValidVotes === 'number' ? snapshot.totalValidVotes : null,
      rejectedPostal: typeof snapshot?.rejectedPostal === 'number' ? snapshot.rejectedPostal : null,
      snapshot,
      lottery: (r.lottery_details as unknown) ?? null,
      notaHighestAck: Number(r.nota_highest_ack) === 1,
      declaredBy: {
        username: String(r.username),
        fullName: r.full_name === null ? null : String(r.full_name),
      },
      declaredAt: r.declared_at as Date,
      correctionReason: r.correction_reason === null ? null : String(r.correction_reason),
    };
  });
}
