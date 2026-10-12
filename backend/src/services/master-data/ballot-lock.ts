// Ballot lock rules, shared by `npm run ballot:lock` and the DM's "लॉक करें".
// A ward with no candidates can never be locked (all or nothing); already-locked wards are skipped.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { loadWards } from './lookups.js';
import type { WardRow } from './lookups.js';

export interface LockPlan {
  toLock: WardRow[];
  alreadyLocked: WardRow[];
  /** Wards in `toLock` without candidates: the lock is refused while this is not empty. */
  noCandidates: WardRow[];
  /** Wards in `toLock` whose list nobody marked ready (a warning only). */
  notReady: WardRow[];
}

/** Which wards a lock of `select` would touch. Reads only. */
export async function planLock(
  db: Pool | PoolConnection,
  select: (w: WardRow) => boolean,
  wards?: readonly WardRow[],
): Promise<LockPlan> {
  const targets = (wards ?? (await loadWards(db))).filter(select);
  const [counts] = await db.query<RowDataPacket[]>(
    'SELECT ward_id, COUNT(*) AS n FROM candidate WHERE is_nota = 0 GROUP BY ward_id',
  );
  const candidates = new Map(counts.map((r) => [Number(r.ward_id), Number(r.n)]));
  const alreadyLocked = targets.filter((w) => w.is_locked === 1);
  const toLock = targets.filter((w) => w.is_locked !== 1);
  return {
    toLock,
    alreadyLocked,
    noCandidates: toLock.filter((w) => (candidates.get(w.id) ?? 0) === 0),
    notReady: toLock.filter((w) => w.candidates_ready !== 1),
  };
}

/** Locks the planned wards (only after planLock found no ward without candidates). */
export async function applyLock(
  conn: PoolConnection,
  toLock: readonly WardRow[],
  by: { userId: number | null; name: string },
): Promise<void> {
  for (const w of toLock) {
    await conn.execute(
      'UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by = ?, locked_by_name = ? WHERE id = ? AND is_locked = 0',
      [by.userId, by.name, w.id],
    );
  }
}
