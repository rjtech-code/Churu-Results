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
  'candidate_name_change',
];

/**
 * Counting-only reset ("मतगणना डेटा हटाएँ"): ONLY what the ROs entered during counting. The setup
 * survives, so a mock counting can simply be re-run: candidates, the candidate detail/name change
 * history, every ward's candidate-list lock / ready / returned state, booths, wards, Panchayat
 * Samitis, voters, parties, users, settings, the ZP postal assignment, screen keys and the audit log
 * are all untouched.
 *
 * No `ward` column is reset, on purpose: the `ward` table records only the candidate-list lock
 * (is_locked, locked_at, locked_by, locked_by_name), the list ready / returned state
 * (candidates_ready_at, candidates_ready_by, candidates_return_reason) and master data
 * (is_unopposed, reservation_category) — NOT counting progress or declaration. Progress is counted
 * from the live booth entries (services/booth-progress.ts) and declaration lives only in
 * ward_declarations, so emptying the tables below is enough for every ward to read
 * "शुरू नहीं हुआ" again with its ballot still locked.
 */
export const COUNTING_DATA_TABLES: readonly string[] = [
  'booth_entry',
  'booth_entry_vote',
  'postal_entry',
  'postal_entry_vote',
  'ward_declarations',
  'voided_entry',
];

/**
 * Kept by a master-data replace: the audit log (never emptied), the 15 + 1 logins (and their
 * sessions / OTP codes), the screen keys and screen sessions, the district and the Panchayat Samiti rows the RO accounts point to (re-used
 * and renamed by the geography import), and the settings. Everything else is emptied.
 */
export const KEPT_TABLES: ReadonlySet<string> = new Set([
  'audit_log',
  'users',
  'sessions',
  'user_otp',
  // Screen access: the DM's keys and the unlocked TVs survive a master-data replace (not master data).
  'screen_key',
  'screen_session',
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
    (SELECT COUNT(*) FROM candidate_name_change) AS nameChanges,
    (SELECT COUNT(*) FROM ward WHERE is_locked = 1 OR candidates_ready_at IS NOT NULL) AS lockedWards`);
  const r: RowDataPacket | undefined = rows[0];
  return {
    candidates: Number(r?.candidates ?? 0),
    boothEntries: Number(r?.boothEntries ?? 0),
    postalEntries: Number(r?.postalEntries ?? 0),
    declaredWards: Number(r?.declaredWards ?? 0),
    voidedEntries: Number(r?.voidedEntries ?? 0),
    nameChanges: Number(r?.nameChanges ?? 0),
    lockedWards: Number(r?.lockedWards ?? 0),
  };
}
export type TestDataImpact = Awaited<ReturnType<typeof testDataImpact>>;

/** What a counting-only reset deletes (shown before it runs). */
export async function countingDataImpact(db: Pool | Connection) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM booth_entry) AS boothEntries,
    (SELECT COUNT(*) FROM postal_entry) AS postalEntries,
    (SELECT COUNT(DISTINCT ward_id) FROM ward_declarations) AS declaredWards,
    (SELECT COUNT(*) FROM ward_declarations) AS declarationVersions,
    (SELECT COUNT(*) FROM voided_entry) AS voidedEntries`);
  const r: RowDataPacket | undefined = rows[0];
  return {
    boothEntries: Number(r?.boothEntries ?? 0),
    postalEntries: Number(r?.postalEntries ?? 0),
    declaredWards: Number(r?.declaredWards ?? 0),
    declarationVersions: Number(r?.declarationVersions ?? 0),
    voidedEntries: Number(r?.voidedEntries ?? 0),
  };
}
export type CountingDataImpact = Awaited<ReturnType<typeof countingDataImpact>>;

/** What a counting-only reset KEEPS, with real counts (shown next to the deletes). */
export async function countingDataKept(db: Pool | Connection) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM candidate WHERE is_nota = 0) AS candidates,
    (SELECT COUNT(*) FROM ward WHERE is_locked = 1) AS lockedWards,
    (SELECT COUNT(*) FROM ward WHERE candidates_ready_at IS NOT NULL) AS readyWards,
    (SELECT COUNT(*) FROM candidate_name_change) AS nameChanges,
    (SELECT COUNT(*) FROM booth) AS booths,
    (SELECT COUNT(*) FROM ward) AS wards`);
  const r: RowDataPacket | undefined = rows[0];
  return {
    candidates: Number(r?.candidates ?? 0),
    lockedWards: Number(r?.lockedWards ?? 0),
    readyWards: Number(r?.readyWards ?? 0),
    nameChanges: Number(r?.nameChanges ?? 0),
    booths: Number(r?.booths ?? 0),
    wards: Number(r?.wards ?? 0),
  };
}
export type CountingDataKept = Awaited<ReturnType<typeof countingDataKept>>;

/**
 * Counting-only reset. The caller has checked role, confirmation and taken the backup. Deletes ONLY
 * COUNTING_DATA_TABLES; no ward column is touched and candidates, their change history and the ward
 * candidate-list locks stay exactly as they were. One COUNTING_DATA_RESET audit row is written in a
 * transaction after the TRUNCATE. Running it on an already-empty system is safe (and still audited).
 */
export async function runCountingDataReset(
  migrationDb: DbConnectionConfig,
  pool: Pool,
  actor: AuditActor,
  backupFile: string,
): Promise<{ deleted: CountingDataImpact; kept: CountingDataKept }> {
  return withMigrationConnection(migrationDb, pool, async (conn) => {
    const deleted = await countingDataImpact(conn);
    const kept = await countingDataKept(conn);
    await truncateTables(conn, COUNTING_DATA_TABLES);
    await conn.beginTransaction();
    try {
      await writeAudit(
        conn,
        {
          action: 'COUNTING_DATA_RESET',
          entity: 'database',
          entityId: null,
          oldValue: deleted,
          newValue: {
            backup_file: backupFile,
            emptied_tables: COUNTING_DATA_TABLES,
            kept,
          },
          reason:
            'Counting data cleared from the Super Admin panel; candidates, ward locks, the candidate change history and the audit log are kept',
        },
        actor,
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return { deleted, kept };
  });
}

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
