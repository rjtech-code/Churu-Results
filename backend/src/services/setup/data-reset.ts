// The ONE controlled routine that empties tables, shared by the Super Admin's "परीक्षण डेटा साफ़ करें"
// (test-data reset) and "मास्टर डेटा बदलें" (master-data replace). It is the only server code that
// uses the MIGRATION user at runtime.
//
// Why the migration user: the append-only tables (declarations, voided entries) block DELETE with
// triggers, and TRUNCATE (DDL, does not fire triggers) needs the DROP privilege, which the app user
// never has. The triggers stay in place and active the whole time. audit_log is NEVER emptied: it is
// not in any list here, and the lists are checked against grants.ts by the tests.
//
// While the work runs, the migration connection holds the master-data lock (the same named lock the
// counting-lock switch and every master-data write take), and the counting lock is checked under it.
import mysql from 'mysql2/promise';
import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { SESSION_INIT_SQL } from '../../config/db.js';
import type { DbConnectionConfig } from '../../config/db.js';
import { ApiError } from '../../middleware/errors.js';
import { APP_TABLE_PRIVILEGES } from '../../db/grants.js';
import { MASTER_DATA_LOCK } from '../master-data/lock.js';
import { writeAudit } from './audit.js';
import type { AuditActor } from './audit.js';
import { isCountingLocked } from './counting-lock.js';
import { RESET_WARDS_SQL } from './reset-candidates.js';

/** Test-data reset: everything counting and candidates produced. Booths, wards, voters, parties stay. */
export const TEST_DATA_TABLES: readonly string[] = [
  'candidate',
  'booth_entry',
  'booth_entry_vote',
  'postal_entry',
  'postal_entry_vote',
  'ward_declarations',
  'voided_entry',
];

/**
 * Kept by a master-data replace: the audit log (never emptied), the 15 + 1 logins (and their
 * sessions / OTP codes), the district and the Panchayat Samiti rows the RO accounts point to (re-used
 * and renamed by the geography import), and the settings. Everything else is emptied.
 */
export const KEPT_TABLES: ReadonlySet<string> = new Set([
  'audit_log',
  'users',
  'sessions',
  'user_otp',
  'district',
  'panchayat_samiti',
  'app_settings',
]);
export const MASTER_DATA_TABLES: readonly string[] = Object.keys(APP_TABLE_PRIVILEGES).filter(
  (t) => !KEPT_TABLES.has(t),
);

/**
 * Opens a migration-user connection to the SAME database as the app pool, takes the master-data lock,
 * refuses while the counting lock is ON (423 COUNTING_LOCKED), runs `work`, and always cleans up.
 */
export async function withMigrationConnection<T>(
  migrationDb: DbConnectionConfig,
  pool: Pool,
  work: (conn: Connection) => Promise<T>,
): Promise<T> {
  const [appDb] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  const conn = await mysql.createConnection({ ...migrationDb, connectTimeout: 5000 });
  try {
    await conn.query(SESSION_INIT_SQL);
    const [migDb] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    const name = String(migDb[0]?.name ?? '');
    if (name === '' || name !== String(appDb[0]?.name ?? '')) {
      throw new Error('data reset refused: migration and app connections use different databases');
    }
    const [got] = await conn.execute<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS got', [
      MASTER_DATA_LOCK,
    ]);
    if (Number(got[0]?.got) !== 1) throw new ApiError(409, 'MASTER_DATA_BUSY');
    try {
      if (await isCountingLocked(conn)) throw new ApiError(423, 'COUNTING_LOCKED');
      return await work(conn);
    } finally {
      await conn.execute('SELECT RELEASE_LOCK(?)', [MASTER_DATA_LOCK]);
    }
  } finally {
    await conn.end();
  }
}

/** TRUNCATE (fixed table lists above only; never audit_log). */
export async function truncateTables(conn: Connection, tables: readonly string[]): Promise<void> {
  if (tables.includes('audit_log')) throw new Error('audit_log is never emptied');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of tables) await conn.query(`TRUNCATE TABLE ${mysql.escapeId(table)}`);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** What a test-data reset deletes (shown before it runs). */
export async function testDataImpact(db: Pool | Connection) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM candidate WHERE is_nota = 0) AS candidates,
    (SELECT COUNT(*) FROM booth_entry) AS boothEntries,
    (SELECT COUNT(*) FROM postal_entry) AS postalEntries,
    (SELECT COUNT(DISTINCT ward_id) FROM ward_declarations) AS declaredWards,
    (SELECT COUNT(*) FROM voided_entry) AS voidedEntries,
    (SELECT COUNT(*) FROM ward WHERE is_locked = 1 OR candidates_ready_at IS NOT NULL) AS lockedWards`);
  const r: RowDataPacket | undefined = rows[0];
  return {
    candidates: Number(r?.candidates ?? 0),
    boothEntries: Number(r?.boothEntries ?? 0),
    postalEntries: Number(r?.postalEntries ?? 0),
    declaredWards: Number(r?.declaredWards ?? 0),
    voidedEntries: Number(r?.voidedEntries ?? 0),
    lockedWards: Number(r?.lockedWards ?? 0),
  };
}
export type TestDataImpact = Awaited<ReturnType<typeof testDataImpact>>;

/**
 * Test-data reset. The caller has checked role, confirmation and taken the backup. Ward lock / ready
 * fields are reset and one TEST_DATA_RESET audit row is written in one transaction after the TRUNCATE.
 */
export async function runTestDataReset(
  migrationDb: DbConnectionConfig,
  pool: Pool,
  actor: AuditActor,
  backupFile: string,
): Promise<TestDataImpact> {
  return withMigrationConnection(migrationDb, pool, async (conn) => {
    const before = await testDataImpact(conn);
    await truncateTables(conn, TEST_DATA_TABLES);
    await conn.beginTransaction();
    try {
      await conn.execute(RESET_WARDS_SQL);
      await writeAudit(
        conn,
        {
          action: 'TEST_DATA_RESET',
          entity: 'database',
          entityId: null,
          oldValue: before,
          newValue: { backup_file: backupFile, emptied_tables: TEST_DATA_TABLES },
          reason: 'Test data cleared from the Super Admin panel; the audit log is kept',
        },
        actor,
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return before;
  });
}
