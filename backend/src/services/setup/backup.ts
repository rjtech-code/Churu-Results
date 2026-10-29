// Automatic DATA backup before every Super Admin reset or booth change, made with the APP user (the
// migration user is used only inside the full-reset routine). It holds the rows of every app table,
// not the schema: restore it into the same, migrated database (same schema version), as root:
//   gunzip -c <file> | mysql -uroot -p <database>
// Restoring never drops a table, so the append-only triggers stay in place. audit_log is never
// emptied: its rows are put back with INSERT IGNORE (rows that exist stay). Sessions and one-time
// codes are not kept (live session ids / code hashes). Only the newest KEEP_BACKUPS files are kept.
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { APP_TABLE_PRIVILEGES } from '../../db/grants.js';
import { formatIst, istStamp } from './report.js';

/** Emptied on restore, never filled (live login data). */
const NO_ROW_TABLES: ReadonlySet<string> = new Set(['sessions', 'user_otp']);
/** Never emptied on restore: rows are added back with INSERT IGNORE. */
const NEVER_EMPTIED: ReadonlySet<string> = new Set(['audit_log']);
const ROWS_PER_INSERT = 200;
export const KEEP_BACKUPS = 20;
const BACKUP_FILE = /^churu-.+\.sql\.gz$/;

export interface BackupResult {
  path: string;
  bytes: number;
  tables: number;
  rows: number;
}

/** A value as SQL text. Dates, big numbers and JSON arrive as text (query options below). */
function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return value.length === 0 ? "''" : `X'${value.toString('hex')}'`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return mysql.escape(value);
  // Not expected with the options below: refuse rather than guess.
  throw new Error(`backup: unexpected column value of type ${typeof value}`);
}

/** Yields the dump piece by piece (one table's rows at a time are in memory). */
async function* dumpSql(
  conn: PoolConnection,
  startedAt: Date,
  counts: { tables: number; rows: number },
) {
  const [dbRows] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  const database = String(dbRows[0]?.name ?? '');
  yield [
    `-- Churu ZP-PS results: DATA backup by the Super Admin panel, ${formatIst(startedAt)}`,
    `-- Database: ${database}. Rows only: restore into the same migrated schema, as root:`,
    `--   gunzip -c <file> | mysql -uroot -p ${database}`,
    'SET NAMES utf8mb4;',
    "SET time_zone = '+05:30';",
    'SET FOREIGN_KEY_CHECKS = 0;',
    'SET UNIQUE_CHECKS = 0;',
    '',
  ].join('\n');

  // The fixed list of app tables (grants.ts), never anything from a request.
  for (const table of Object.keys(APP_TABLE_PRIVILEGES).sort()) {
    const id = mysql.escapeId(table);
    counts.tables++;
    if (!NEVER_EMPTIED.has(table)) yield `\nTRUNCATE TABLE ${id};\n`;
    if (NO_ROW_TABLES.has(table)) continue;

    const [cols] = await conn.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const names = cols.map((c) => String(c.name));
    const columnList = names.map((n) => mysql.escapeId(n)).join(', ');
    const [rows] = await conn.query<RowDataPacket[]>({
      sql: `SELECT ${columnList} FROM ${id}`,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      // JSON exactly as stored (a parsed scalar like "abc" could not be written back as JSON).
      typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
    });
    const insert = NEVER_EMPTIED.has(table) ? 'INSERT IGNORE' : 'INSERT';
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const values = rows
        .slice(i, i + ROWS_PER_INSERT)
        .map((r) => `(${names.map((n) => sqlValue(r[n])).join(', ')})`)
        .join(',\n');
      yield `${insert} INTO ${id} (${columnList}) VALUES\n${values};\n`;
    }
    counts.rows += rows.length;
  }
  yield '\nSET UNIQUE_CHECKS = 1;\nSET FOREIGN_KEY_CHECKS = 1;\n-- end of backup\n';
}

/** Keeps the newest KEEP_BACKUPS backup files; `keep` (the one just made) is never deleted. */
async function pruneOldBackups(backupDir: string, keep: string): Promise<void> {
  const files = await Promise.all(
    (await readdir(backupDir))
      .filter((name) => BACKUP_FILE.test(name))
      .map(async (name) => {
        const path = join(backupDir, name);
        return { path, mtime: (await stat(path)).mtimeMs };
      }),
  );
  const others = files.filter((f) => f.path !== keep).sort((a, b) => b.mtime - a.mtime);
  for (const old of others.slice(KEEP_BACKUPS - 1)) await rm(old.path, { force: true });
}

/**
 * Writes `<backupDir>/churu-<label>-<IST time>.sql.gz` (mode 600; folder 700) in one
 * consistent-snapshot read, then prunes old backups. A failed backup leaves no file behind and
 * throws: the caller must then NOT go on.
 */
export async function createBackup(
  pool: Pool,
  backupDir: string,
  label: string,
  now: Date,
): Promise<BackupResult> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const path = join(backupDir, `churu-${label}-${istStamp(now)}.sql.gz`);
  const temp = `${path}.part`;
  const counts = { tables: 0, rows: 0 };
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    try {
      await pipeline(
        Readable.from(dumpSql(conn, now, counts)),
        createGzip(),
        createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      );
    } finally {
      await conn.query('ROLLBACK');
    }
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  } finally {
    conn.release();
  }
  const { size } = await stat(path);
  await pruneOldBackups(backupDir, path);
  return { path, bytes: size, ...counts };
}
