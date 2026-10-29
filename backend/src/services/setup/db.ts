import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MASTER_DATA_LOCK } from '../master-data/lock.js';

/** Problems that stop a script outright (as opposed to data validation errors). */
export class ScriptError extends Error {}

const LOCK_NAME = MASTER_DATA_LOCK;

/**
 * Runs `work` in ONE transaction on one connection. It commits only when `work` returns
 * commit: true; otherwise (dry run, validation errors, exceptions) everything is rolled back.
 * A named MySQL lock stops two master-data scripts from running at the same time.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<{ commit: boolean; value: T }>,
): Promise<{ committed: boolean; value: T }> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
    if (Number(rows[0]?.got) !== 1) {
      throw new ScriptError('Another master-data script is running right now. Try again shortly.');
    }
    try {
      await conn.beginTransaction();
      let result: { commit: boolean; value: T };
      try {
        result = await work(conn);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
      if (result.commit) await conn.commit();
      else await conn.rollback();
      return { committed: result.commit, value: result.value };
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    conn.release();
  }
}

export { countOf } from '../master-data/db-count.js';

/** Describes a database error for the operator (CLI only, never sent to web clients). */
export function describeDbError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && 'sqlMessage' in err) {
    return `${String(err.code)}: ${String(err.sqlMessage)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * inTransaction, or, when the context carries an open transaction (`joinConnection`), runs `work`
 * inside that one. Then `committed` only says whether the run WANTED to commit; the owner of the
 * outer transaction commits or rolls back.
 */
export async function inContextTransaction<T>(
  ctx: { pool: Pool; joinConnection?: PoolConnection },
  work: (conn: PoolConnection) => Promise<{ commit: boolean; value: T }>,
): Promise<{ committed: boolean; value: T }> {
  if (ctx.joinConnection === undefined) return inTransaction(ctx.pool, work);
  const result = await work(ctx.joinConnection);
  return { committed: result.commit, value: result.value };
}
