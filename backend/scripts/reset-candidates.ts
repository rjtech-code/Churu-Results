// npm run reset-candidates -- --backup-file <path> [--max-backup-age-hours 24] [--commit] [--yes-this-is-dummy-data]
//
// Removes every candidate and all counting data that hangs off candidates (booth/postal entries and
// their votes), and resets the ward lock and "list ready" fields, so a fresh candidate list can be
// imported. Everything else is kept and verified unchanged: users, parties, geography, booths and
// voter counts, settings, the audit log (one CANDIDATES_RESET row is added).
//
// Refuses when ward_declarations or voided_entry has any row: those tables are append-only and can
// never be emptied by a script (use the full database reset procedure instead).
// Dry run by default. With NODE_ENV=production it also needs --yes-this-is-dummy-data.
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { ScriptError, countOf, inTransaction } from './lib/db.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

const USAGE =
  'npm run reset-candidates -- --backup-file <path> [--max-backup-age-hours 24] [--commit] [--yes-this-is-dummy-data]';

export const DEFAULT_MAX_BACKUP_AGE_HOURS = 24;

/** Deleted, children first (FK-safe order). Fixed SQL only. */
const DELETED_TABLES = [
  [
    'booth_entry_vote',
    'SELECT COUNT(*) AS n FROM booth_entry_vote',
    'DELETE FROM booth_entry_vote',
  ],
  [
    'postal_entry_vote',
    'SELECT COUNT(*) AS n FROM postal_entry_vote',
    'DELETE FROM postal_entry_vote',
  ],
  ['booth_entry', 'SELECT COUNT(*) AS n FROM booth_entry', 'DELETE FROM booth_entry'],
  ['postal_entry', 'SELECT COUNT(*) AS n FROM postal_entry', 'DELETE FROM postal_entry'],
  ['candidate', 'SELECT COUNT(*) AS n FROM candidate', 'DELETE FROM candidate'],
] as const;

/** Append-only tables: must be empty, never deleted. */
const PROTECTED_TABLES = [
  ['ward_declarations', 'SELECT COUNT(*) AS n FROM ward_declarations'],
  ['voided_entry', 'SELECT COUNT(*) AS n FROM voided_entry'],
] as const;

/**
 * Kept tables: row count plus a checksum of the columns that matter, compared before and after.
 * Columns a live login may change (last_login_at, failed_login_count, ...) are left out on purpose.
 */
const KEPT_TABLES = [
  [
    'district',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, code, name_english, name_hindi))), 0) AS c
       FROM district`,
  ],
  [
    'panchayat_samiti',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, district_id, name_english, name_hindi))), 0) AS c
       FROM panchayat_samiti`,
  ],
  [
    'ward',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, ward_type, district_id,
              IFNULL(panchayat_samiti_id, 0), ward_no, IFNULL(reservation_category, '')))), 0) AS c
       FROM ward`,
  ],
  [
    'booth',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, panchayat_samiti_id, booth_no, name_hindi,
              IFNULL(name_english, ''), ps_ward_id, zp_ward_id, IFNULL(registered_voters_male, -1),
              IFNULL(registered_voters_female, -1), IFNULL(registered_voters_total, -1)))), 0) AS c
       FROM booth`,
  ],
  [
    'party',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, name_hindi, name_english, short_name, symbol))), 0) AS c
       FROM party`,
  ],
  [
    'users',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, username, role, IFNULL(panchayat_samiti_id, 0),
              is_active, IFNULL(full_name, ''), IFNULL(phone, ''), IFNULL(email, ''),
              password_enc IS NULL))), 0) AS c
       FROM users`,
  ],
  [
    'app_settings',
    `SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', setting_key, setting_value))), 0) AS c
       FROM app_settings`,
  ],
  ['audit_log', 'SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS c FROM audit_log'],
] as const;

/** Printed only: they change whenever somebody logs in on a live site. */
const INFO_TABLES = [
  ['sessions', 'SELECT COUNT(*) AS n FROM sessions'],
  ['user_otp', 'SELECT COUNT(*) AS n FROM user_otp'],
] as const;

const WARD_STATE_SQL = `
  SELECT COALESCE(SUM(is_locked), 0) AS is_locked,
         COUNT(locked_at) AS locked_at,
         COUNT(locked_by) AS locked_by,
         COUNT(locked_by_name) AS locked_by_name,
         COUNT(candidates_ready_at) AS candidates_ready_at,
         COUNT(candidates_ready_by) AS candidates_ready_by,
         COUNT(candidates_return_reason) AS candidates_return_reason,
         COALESCE(SUM(is_unopposed), 0) AS is_unopposed
    FROM ward`;
const WARD_STATE_FIELDS = [
  'is_locked',
  'locked_at',
  'locked_by',
  'locked_by_name',
  'candidates_ready_at',
  'candidates_ready_by',
  'candidates_return_reason',
  'is_unopposed',
] as const;

const RESET_WARDS_SQL = `
  UPDATE ward
     SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
         candidates_ready_at = NULL, candidates_ready_by = NULL, candidates_return_reason = NULL,
         is_unopposed = 0`;

type Counts = Record<string, number>;
type Kept = Record<string, { n: number; c: string }>;

interface Snapshot {
  deleted: Counts;
  protectedRows: Counts;
  kept: Kept;
  info: Counts;
  wardState: Counts;
}

async function snapshot(conn: PoolConnection): Promise<Snapshot> {
  const deleted: Counts = {};
  for (const [table, countSql] of DELETED_TABLES) deleted[table] = await countOf(conn, countSql);
  const protectedRows: Counts = {};
  for (const [table, sql] of PROTECTED_TABLES) protectedRows[table] = await countOf(conn, sql);
  const kept: Kept = {};
  for (const [table, sql] of KEPT_TABLES) {
    const [rows] = await conn.execute<RowDataPacket[]>(sql);
    kept[table] = { n: Number(rows[0]?.n ?? 0), c: String(rows[0]?.c ?? '0') };
  }
  const info: Counts = {};
  for (const [table, sql] of INFO_TABLES) info[table] = await countOf(conn, sql);
  const [stateRows] = await conn.execute<RowDataPacket[]>(WARD_STATE_SQL);
  const wardState: Counts = {};
  for (const field of WARD_STATE_FIELDS) wardState[field] = Number(stateRows[0]?.[field] ?? 0);
  return { deleted, protectedRows, kept, info, wardState };
}

const listCounts = (counts: Counts) => Object.entries(counts).map(([k, n]) => `${k}: ${n}`);

export interface ResetCandidatesOptions {
  backupFile?: string | undefined;
  maxBackupAgeHours?: number | undefined;
  commit?: boolean | undefined;
  yesDummyData?: boolean | undefined;
  /** process.env.NODE_ENV (passed in so tests can check the production guard). */
  nodeEnv: string | undefined;
}

export interface ResetCandidatesResult extends ScriptResult {
  database: string;
  before: Snapshot | null;
}

/** Backup file must exist, be a non-empty file and be at most `maxHours` old. */
async function checkBackup(
  file: string,
  maxHours: number,
  now: Date,
  report: Report,
): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    report.error(`Backup file not found: ${file}`);
    return;
  }
  if (!info.isFile()) {
    report.error(`Backup path is not a file: ${file}`);
    return;
  }
  const ageHours = (now.getTime() - info.mtime.getTime()) / 3_600_000;
  report.line(`Backup file: ${file}`);
  report.line(`Backup size: ${info.size} bytes, age: ${ageHours.toFixed(2)} hour(s)`);
  if (info.size === 0) report.error(`Backup file is empty: ${file}`);
  if (ageHours > maxHours) {
    report.error(
      `Backup file is ${ageHours.toFixed(2)} hour(s) old; the limit is ${maxHours} (--max-backup-age-hours). Take a fresh backup first.`,
    );
  }
}

export async function runResetCandidates(
  options: ResetCandidatesOptions,
  ctx: ScriptContext,
): Promise<ResetCandidatesResult> {
  const startedAt = ctx.now();
  const commit = options.commit === true;
  const report = new Report('reset-candidates', commit ? 'commit' : 'dry-run');
  let committed = false;
  let database = '';
  let before: Snapshot | null = null;
  const done = async (): Promise<ResetCandidatesResult> => ({
    ...(await finishReport(ctx, report, startedAt, committed)),
    database,
    before,
  });

  // 0. Which database? Printed before anything else.
  try {
    const [db] = await ctx.pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    database = String(db[0]?.name ?? '');
  } catch (err) {
    reportFailure(report, err);
    return done();
  }
  ctx.out(`Database: ${database}`);
  report.line(`Database: ${database}`);
  report.line(`NODE_ENV: ${options.nodeEnv ?? '(not set)'}`);

  // 1. Guards, before any write.
  if (options.nodeEnv === 'production' && options.yesDummyData !== true) {
    report.error(
      'Refused: NODE_ENV=production. This deletes ALL candidates; on a site with dummy data add --yes-this-is-dummy-data.',
    );
  }
  const maxHours = options.maxBackupAgeHours ?? DEFAULT_MAX_BACKUP_AGE_HOURS;
  if (!Number.isFinite(maxHours) || maxHours <= 0) {
    report.error('--max-backup-age-hours must be a number greater than 0.');
  }
  if (options.backupFile === undefined || options.backupFile.trim() === '') {
    report.error('--backup-file <path> is required: take a backup first and name the exact file.');
  } else if (Number.isFinite(maxHours) && maxHours > 0) {
    await checkBackup(options.backupFile, maxHours, startedAt, report);
  }
  if (!report.isOk()) return done();

  // 2. One transaction: lock wards, count, (commit:) delete, reset, verify, audit.
  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      // Locking read first: blocks new counting entries on any ward until we finish.
      await conn.execute('SELECT id FROM ward FOR UPDATE');
      const b = await snapshot(conn);
      before = b;

      report.section('WILL BE DELETED (rows)', listCounts(b.deleted));
      report.section('Ward fields WILL BE RESET (wards with a value)', listCounts(b.wardState));
      report.section('Append-only tables (must be 0; never deleted)', listCounts(b.protectedRows));
      report.section(
        'KEPT unchanged (rows)',
        Object.entries(b.kept).map(([t, v]) => `${t}: ${v.n}`),
      );
      report.section('Kept, not checked (change on every login)', listCounts(b.info));

      const decl = b.protectedRows.ward_declarations ?? 0;
      const voided = b.protectedRows.voided_entry ?? 0;
      if (decl > 0 || voided > 0) {
        report.error(
          `Refused: ward_declarations has ${decl} row(s) and voided_entry has ${voided} row(s). ` +
            'These tables are append-only and are never deleted by a script. ' +
            'Use the full database reset procedure instead.',
        );
        return { commit: false, value: undefined };
      }
      if (!commit) return { commit: false, value: undefined };

      for (const [, , deleteSql] of DELETED_TABLES) await conn.execute(deleteSql);
      await conn.execute(RESET_WARDS_SQL);

      const after = await snapshot(conn);
      const problems: string[] = [];
      for (const [table, n] of Object.entries(after.deleted)) {
        if (n !== 0) problems.push(`${table} still has ${n} row(s)`);
      }
      for (const [field, n] of Object.entries(after.wardState)) {
        if (n !== 0) problems.push(`ward.${field} still set on ${n} ward(s)`);
      }
      for (const [table, n] of Object.entries(after.protectedRows)) {
        if (n !== (b.protectedRows[table] ?? -1)) problems.push(`${table} changed`);
      }
      for (const [table, v] of Object.entries(after.kept)) {
        const old = b.kept[table];
        if (old?.n !== v.n || old.c !== v.c) problems.push(`kept table ${table} changed`);
      }
      if (problems.length > 0) {
        throw new ScriptError(`Verification failed, rolled back: ${problems.join('; ')}`);
      }

      await writeAudit(conn, {
        action: 'CANDIDATES_RESET',
        entity: 'candidate',
        entityId: null,
        oldValue: { deleted: b.deleted, ward_fields_reset: b.wardState },
        newValue: {
          database,
          backup_file: basename(options.backupFile ?? ''),
          kept: Object.fromEntries(Object.entries(b.kept).map(([t, v]) => [t, v.n])),
        },
        reason: 'Candidate list reset before a fresh candidate import',
      });
      const auditAfter = await countOf(conn, 'SELECT COUNT(*) AS n FROM audit_log');
      if (auditAfter !== (b.kept.audit_log?.n ?? -1) + 1) {
        throw new ScriptError(
          'Verification failed, rolled back: audit_log did not grow by exactly 1',
        );
      }
      report.line('');
      report.line('Verified: deleted tables are 0, ward fields reset, kept tables unchanged.');
      return { commit: true, value: undefined };
    });
    committed = result.committed;
  } catch (err) {
    reportFailure(report, err);
  }
  return done();
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    {
      'backup-file': { type: 'string' },
      'max-backup-age-hours': { type: 'string' },
      commit: { type: 'boolean' },
      'yes-this-is-dummy-data': { type: 'boolean' },
    },
    USAGE,
  );
  const maxAge = values['max-backup-age-hours'];
  return runResetCandidates(
    {
      backupFile:
        values['backup-file'] === undefined ? undefined : resolveUserPath(values['backup-file']),
      maxBackupAgeHours: maxAge === undefined ? undefined : Number(maxAge),
      commit: values.commit,
      yesDummyData: values['yes-this-is-dummy-data'],
      nodeEnv: process.env.NODE_ENV,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
