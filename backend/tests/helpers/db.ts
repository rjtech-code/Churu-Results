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
