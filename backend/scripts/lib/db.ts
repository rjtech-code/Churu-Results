import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

/** Problems that stop a script outright (as opposed to data validation errors). */
export class ScriptError extends Error {}

const LOCK_NAME = 'churu_master_data';

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

/** Runs a COUNT-style query (BIGINTs arrive as strings from the pool) and returns a number. */
export async function countOf(
  conn: PoolConnection | Pool,
  sql: string,
  params: (string | number)[] = [],
): Promise<number> {
  const [rows] = await conn.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** Describes a database error for the operator (CLI only, never sent to web clients). */
export function describeDbError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && 'sqlMessage' in err) {
    return `${String(err.code)}: ${String(err.sqlMessage)}`;
  }
  return err instanceof Error ? err.message : String(err);
}
