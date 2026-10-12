// One named MySQL lock for every master-data change (CLI scripts and the web), so a web edit and a
// CLI import can never run at the same time.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export const MASTER_DATA_LOCK = 'churu_master_data';

/** Error thrown when another master-data change holds the lock. */
export class MasterDataBusyError extends Error {
  constructor() {
    super('master data busy');
    this.name = 'MasterDataBusyError';
  }
}

/**
 * Runs `work` in ONE transaction while holding the master-data lock (waits up to `waitSeconds`).
 * Commits only if `work` returns; any exception rolls everything back.
 */
export async function withMasterDataWrite<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
  waitSeconds = 5,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS got', [
      MASTER_DATA_LOCK,
      waitSeconds,
    ]);
    if (Number(rows[0]?.got) !== 1) throw new MasterDataBusyError();
    try {
      // READ COMMITTED: a check after locking a ward row FOR UPDATE reads the latest committed data,
      // not a snapshot taken before the lock.
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      try {
        const value = await work(conn);
        await conn.commit();
        return value;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      await conn.execute('SELECT RELEASE_LOCK(?)', [MASTER_DATA_LOCK]);
    }
  } finally {
    conn.release();
  }
}

/** Runs `work` in a READ ONLY transaction (checks that must never write). Always rolled back. */
export async function withReadOnly<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    try {
      return await work(conn);
    } finally {
      await conn.query('ROLLBACK');
    }
  } finally {
    conn.release();
  }
}
