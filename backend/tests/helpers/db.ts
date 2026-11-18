import mysql from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPool } from '../../src/config/db.js';
import { APP_TABLE_PRIVILEGES } from '../../src/db/grants.js';
import { DEFAULT_SCREEN_LAYOUT, SCREEN_LAYOUT_KEY } from '../../src/services/screen-layout.js';
import { loadTestEnv } from './env.js';

export const testEnv = loadTestEnv();

/** Tables the app user may not DELETE from are append-only (triggers block DELETE): truncate those. */
const APPEND_ONLY_TABLES = new Set(
  Object.entries(APP_TABLE_PRIVILEGES)
    .filter(([, privileges]) => !privileges.includes('DELETE'))
    .map(([table]) => table),
);

/** Pool connected as the least-privilege APP user, to the test database. */
export function createTestAppPool(): Pool {
  return createPool({
    host: testEnv.DB_HOST,
    port: testEnv.DB_PORT,
    database: testEnv.TEST_DB,
    user: testEnv.DB_APP_USER,
    password: testEnv.DB_APP_PASSWORD,
  });
}

/** Pool connected as the MIGRATION user, to the test database (same session settings). */
export function createTestMigrationPool(): Pool {
  return createPool({
    host: testEnv.DB_HOST,
    port: testEnv.DB_PORT,
    database: testEnv.TEST_DB,
    user: testEnv.DB_MIGRATION_USER,
    password: testEnv.DB_MIGRATION_PASSWORD,
  });
}

/** A pool that can never connect (nothing listens on port 1). */
export function createUnreachablePool(): Pool {
  return mysql.createPool({
    host: '127.0.0.1',
    port: 1,
    user: 'nobody',
    password: 'nothing',
    connectTimeout: 1000,
  });
}

/** Deletes all data from the test database (migration user; TRUNCATE skips triggers). */
export async function resetData(migrationPool: Pool): Promise<void> {
  const [rows] = await migrationPool.query<RowDataPacket[]>('SELECT DATABASE() AS db');
  const current: unknown = rows[0]?.db;
  if (typeof current !== 'string' || !current.endsWith('_test')) {
    throw new Error('resetData refused: not connected to a *_test database');
  }
  const conn = await migrationPool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of Object.keys(APP_TABLE_PRIVILEGES)) {
      // DELETE is much faster than TRUNCATE (DDL). Append-only tables block DELETE with
      // triggers, so only those are truncated (TRUNCATE does not fire triggers).
      const sql = APPEND_ONLY_TABLES.has(table) ? 'TRUNCATE TABLE ??' : 'DELETE FROM ??';
      await conn.query(sql, [table]);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.execute(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('public_site_enabled', 'false')",
    );
    await conn.execute('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', [
      SCREEN_LAYOUT_KEY,
      JSON.stringify(DEFAULT_SCREEN_LAYOUT),
    ]);
  } finally {
    conn.release();
  }
}

export async function insert(
  pool: Pool,
  sql: string,
  params: (string | number | null)[],
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result.insertId;
}

/**
 * Empties EVERY table of the test database (knex bookkeeping excepted), whatever earlier runs left.
 * Used before rolling migrations back: down migrations are written for an empty schema (e.g. the
 * Part 2 lock check cannot be restored while wards are locked by name).
 */
/**
 * Knex takes a row-lock flag (knex_migrations_lock.is_locked) while it migrates and clears it when
 * it is done. A run that is KILLED mid-migration — Ctrl+C, a crashed worker — leaves that flag set,
 * and then every later run of the suite fails at setup with "Migration table is already locked",
 * which looks like hundreds of broken tests instead of one stale flag.
 *
 * This waits for the flag to clear by itself first: a run that is genuinely migrating finishes in a
 * few seconds, so anything still locked after `waitMs` was left behind. Only then is it released,
 * loudly, and only ever on a *_test database.
 */
export async function releaseStaleMigrationLock(
  migrationPool: Pool,
  waitMs = 20_000,
  stepMs = 1000,
): Promise<void> {
  const [db] = await migrationPool.query<RowDataPacket[]>('SELECT DATABASE() AS db');
  const name: unknown = db[0]?.db;
  if (typeof name !== 'string' || !name.endsWith('_test')) {
    throw new Error('releaseStaleMigrationLock refused: not connected to a *_test database');
  }
  const locked = async (): Promise<boolean> => {
    const [rows] = await migrationPool.query<RowDataPacket[]>(
      'SELECT is_locked FROM knex_migrations_lock WHERE is_locked <> 0',
    );
    return rows.length > 0;
  };
  // No lock table yet (a brand-new database), or nothing is locked: nothing to do.
  try {
    if (!(await locked())) return;
  } catch {
    return;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    if (!(await locked())) return; // a real migration finished: never touched.
  }
  console.warn(
    `[test-setup] knex_migrations_lock on "${name}" was still held after ${String(
      Math.round(waitMs / 1000),
    )}s. Treating it as left behind by a killed run and releasing it. If a migration really is ` +
      'running somewhere, stop it and run the suite again.',
  );
  await migrationPool.query('UPDATE knex_migrations_lock SET is_locked = 0');
}

export async function wipeAllData(migrationPool: Pool): Promise<void> {
  const [db] = await migrationPool.query<RowDataPacket[]>('SELECT DATABASE() AS db');
  const name: unknown = db[0]?.db;
  if (typeof name !== 'string' || !name.endsWith('_test')) {
    throw new Error('wipeAllData refused: not connected to a *_test database');
  }
  const [tables] = await migrationPool.execute<RowDataPacket[]>(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT LIKE 'knex%'",
    [name],
  );
  const conn = await migrationPool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) await conn.query('TRUNCATE TABLE ??', [String(row.t)]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}
