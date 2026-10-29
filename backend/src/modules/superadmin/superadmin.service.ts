// The Super Admin panel's glue. Every action runs in the same order:
//   1 pre-checks (counting lock, ward data, files…)  2 confirmation (typed word; password unless the
//   15-minute confirm window is open)  3 backup (only now)  4 the change (same code as the CLI)
// Messages for the screen are plain (officerLines); technical details stay in the server log.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Request } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AppConfig, SetupConfig } from '../../config/app-config.js';
import type { DbConnectionConfig } from '../../config/db.js';
import { ApiError } from '../../middleware/errors.js';
import { maskEmail } from '../../services/mailer.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { decodeXlsxUpload } from '../../services/master-data/upload.js';
import { writeAudit } from '../../services/setup/audit.js';
import type { AuditActor } from '../../services/setup/audit.js';
import { createBackup } from '../../services/setup/backup.js';
import {
  assertCountingUnlocked,
  isCountingLocked,
  writeCountingLock,
} from '../../services/setup/counting-lock.js';
import { runTestDataReset, testDataImpact } from '../../services/setup/data-reset.js';
import { runSetDmEmail } from '../../services/setup/dm-email.js';
import {
  checkMasterFiles,
  masterDataImpact,
  runMasterDataReplace,
} from '../../services/setup/master-data.js';
import type { MasterCheck, MasterFiles, SourcedLine } from '../../services/setup/master-data.js';
import type { ScriptContext, ScriptResult } from '../../services/setup/run.js';
import { runUsersResetPassword } from '../../services/setup/users-reset-password.js';
import { runUsersUnlock } from '../../services/setup/users-unlock.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import type { Actor } from '../admin/http.js';
import { officerLine, officerLines } from './officer-lines.js';

export const MAX_JSON_UPLOAD_CHARS = 1024 * 1024;
/** After one password check, dangerous actions need only the typed word for this long. */
export const CONFIRM_WINDOW_MS = 15 * 60_000;

const auditActor = (who: Actor): AuditActor => ({ userId: who.user.id, ip: who.ip });

/** 503 SETUP_NOT_CONFIGURED unless backups can be written. */
function backupSetup(config: AppConfig): SetupConfig {
  if (config.setup === undefined) throw new ApiError(503, 'SETUP_NOT_CONFIGURED');
  return config.setup;
}

/** The two data resets also need the migration user (its only users at runtime). */
function resetSetup(config: AppConfig): SetupConfig & { migrationDb: DbConnectionConfig } {
  const setup = backupSetup(config);
  if (setup.migrationDb === null) throw new ApiError(503, 'SETUP_NOT_CONFIGURED');
  return { ...setup, migrationDb: setup.migrationDb };
}

// ---------------------------------------------------------------- confirm window

/** Until when the Super Admin may skip the password (epoch ms), or null. */
export function confirmedUntil(req: Request): number | null {
  const at = req.session.superAdminConfirmedAt;
  if (at === undefined) return null;
  const until = at + CONFIRM_WINDOW_MS;
  return until > Date.now() ? until : null;
}

/**
 * A dangerous action's password step. With a password: checked (wrong = 401 REAUTH_FAILED, counted
 * toward the lockout) and the 15-minute window starts. Without: only inside the window, else
 * 401 PASSWORD_REQUIRED. The window lives in the server-side session (gone on logout).
 */
export async function confirmDanger(
  pool: Pool,
  req: Request,
  who: Actor,
  password: string | undefined,
): Promise<void> {
  if (password === undefined) {
    if (confirmedUntil(req) === null) throw new ApiError(401, 'PASSWORD_REQUIRED');
    return;
  }
  await requireReauth(pool, who.user.id, password, who.ip);
  const conn = await pool.getConnection();
  try {
    await resetFailedLogins(conn, who.user.id);
  } finally {
    conn.release();
  }
  req.session.superAdminConfirmedAt = Date.now();
}

function scriptContext(pool: Pool, config: AppConfig, who: Actor): ScriptContext {
  return {
    pool,
    reportsDir: join(config.setup?.backupDir ?? 'backups', 'reports'),
    roPasswordKey: config.roPasswordKey,
    out: () => undefined,
    confirm: () => Promise.resolve(''),
    now: () => new Date(),
    actor: auditActor(who),
  };
}

// ---------------------------------------------------------------- overview (pre-checks for the UI)

const LOCKED_REASON = 'Counting Lock ON है — पहले Lock OFF करें';
const NOT_CONFIGURED_REASON = 'Server पर backup/reset setup पूरा नहीं है — technical team को बताएँ';

async function activeDm(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT username, full_name, email, failed_login_count,
            (locked_until IS NOT NULL AND locked_until > NOW(3)) AS locked_now
       FROM users WHERE role = 'DM' AND is_active = 1`,
  );
  const dm = rows[0];
  if (dm === undefined) return null;
  return {
    username: String(dm.username),
    fullName: dm.full_name === null ? null : String(dm.full_name),
    email: dm.email === null ? null : maskEmail(String(dm.email)),
    failedLogins: Number(dm.failed_login_count),
    lockedNow: Number(dm.locked_now) === 1,
  };
}

const savedFixesPath = (setup: SetupConfig) => join(setup.backupDir, 'master', 'fixes.json');

async function savedFixes(setup: SetupConfig | undefined) {
  if (setup === undefined) return null;
  try {
    const path = savedFixesPath(setup);
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    const { mtime } = await stat(path);
    return { entries: Array.isArray(raw) ? raw.length : 0, savedAt: mtime.toISOString() };
  } catch {
    return null;
  }
}

export async function overview(pool: Pool, config: AppConfig, req: Request) {
  const locked = await isCountingLocked(pool);
  const resetReady = config.setup?.migrationDb != null;
  const testData = await testDataImpact(pool);
  const master = await masterDataImpact(pool);
  const [ps] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name_english, name_hindi FROM panchayat_samiti ORDER BY name_english',
  );
  const [voters] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(registered_voters_total), 0) AS n FROM booth',
  );
  const nothingToClear = Object.values(testData).every((n) => n === 0);
  const blocked = (extra: string | null) =>
    locked ? LOCKED_REASON : !resetReady ? NOT_CONFIGURED_REASON : extra;
  const testReason = blocked(nothingToClear ? 'साफ़ करने के लिए कोई test data नहीं है' : null);
  const masterReason = blocked(null);
  return {
    countingLocked: locked,
    confirmedUntil: confirmedUntil(req),
    counts: {
      panchayatSamitis: ps.length,
      ...master,
      voters: Number(voters[0]?.n ?? 0),
    },
    testData: { allowed: testReason === null, reason: testReason, deletes: testData },
    masterData: {
      allowed: masterReason === null,
      reason: masterReason,
      deletes: master,
      defaults: {
        hindiNames: ps.filter((r) => String(r.name_hindi) !== String(r.name_english)).length,
        fixes: await savedFixes(config.setup),
      },
    },
    booths: {
      allowed: !locked && config.setup !== undefined,
      reason: locked ? LOCKED_REASON : config.setup === undefined ? NOT_CONFIGURED_REASON : null,
    },
    dm: await activeDm(pool),
    panchayatSamitis: ps.map((r) => ({
      id: Number(r.id),
      nameEnglish: String(r.name_english),
      nameHindi: String(r.name_hindi),
    })),
  };
}

// ---------------------------------------------------------------- DM account

function dmOutcome(result: ScriptResult) {
  return { ok: result.ok, changed: result.committed, problems: officerLines('dm', result.errors) };
}

async function dmUsername(pool: Pool): Promise<string> {
  const dm = await activeDm(pool);
  if (dm === null) throw new ApiError(404, 'DM_NOT_FOUND');
  return dm.username;
}

export async function resetDmPassword(
  pool: Pool,
  config: AppConfig,
  req: Request,
  who: Actor,
  password: string | undefined,
) {
  const username = await dmUsername(pool);
  await confirmDanger(pool, req, who, password);
  const result = await runUsersResetPassword(
    { username, commit: true },
    scriptContext(pool, config, who),
  );
  return { ...dmOutcome(result), username, newPassword: result.password };
}

export async function unlockDm(pool: Pool, config: AppConfig, who: Actor) {
  const username = await dmUsername(pool);
  const by = who.user.fullName ?? who.user.username;
  return dmOutcome(
    await runUsersUnlock({ username, by, commit: true }, scriptContext(pool, config, who)),
  );
}

export async function setDmEmail(pool: Pool, config: AppConfig, who: Actor, email: string) {
  await dmUsername(pool);
  return dmOutcome(await runSetDmEmail({ email, commit: true }, scriptContext(pool, config, who)));
}

// ---------------------------------------------------------------- test-data reset

export async function resetTestData(
  pool: Pool,
  config: AppConfig,
  req: Request,
  who: Actor,
  password: string | undefined,
) {
  const setup = resetSetup(config);
  await assertCountingUnlocked(pool);
  await confirmDanger(pool, req, who, password);
  const backup = await createBackup(pool, setup.backupDir, 'test-data', new Date());
  const deleted = await runTestDataReset(setup.migrationDb, pool, auditActor(who), backup.path);
  return { ok: true, deleted, backupFile: basename(backup.path) };
}

// ---------------------------------------------------------------- master-data replace

export interface XlsxUpload {
  fileName: string;
  fileBase64: string;
}
export interface JsonUpload {
  fileName: string;
  text: string;
}
export interface MasterUploads {
  geography: XlsxUpload;
  voters: XlsxUpload;
  fixes?: JsonUpload | undefined;
  psNames?: JsonUpload | undefined;
  /** true: no fixes at all (ignore the saved fixes file). */
  noFixes?: boolean | undefined;
}

function checkJson(upload: JsonUpload): string {
  if (upload.text.length > MAX_JSON_UPLOAD_CHARS) throw new ApiError(400, 'FILE_TOO_LARGE');
  try {
    JSON.parse(upload.text);
  } catch {
    throw new ApiError(400, 'NOT_JSON');
  }
  return upload.text;
}

/** The system's Hindi names, as the names file the geography import reads. */
async function hindiNamesFromDb(pool: Pool): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_english, name_hindi FROM panchayat_samiti WHERE name_hindi <> name_english',
  );
  return JSON.stringify(
    Object.fromEntries(rows.map((r) => [String(r.name_english), String(r.name_hindi)])),
  );
}

/**
 * Writes the files to a fresh folder under the backup folder (names chosen here, never the
 * uploader's), filling in the defaults (Hindi names from the system, the last used fixes), runs
 * `work`, then deletes the folder again.
 */
async function withStagedFiles<T>(
  pool: Pool,
  setup: SetupConfig,
  uploads: MasterUploads,
  work: (files: MasterFiles) => Promise<T>,
): Promise<T> {
  const geography = decodeXlsxUpload(uploads.geography.fileBase64).data;
  const voters = decodeXlsxUpload(uploads.voters.fileBase64).data;
  let fixes: string | undefined;
  if (uploads.fixes !== undefined) fixes = checkJson(uploads.fixes);
  else if (uploads.noFixes !== true) {
    fixes = await readFile(savedFixesPath(setup), 'utf8').catch(() => undefined);
  }
  const psNames =
    uploads.psNames === undefined ? await hindiNamesFromDb(pool) : checkJson(uploads.psNames);
  const root = join(setup.backupDir, 'uploads');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(root, 'run-'));
  try {
    const files: MasterFiles = {
      geography: join(dir, 'geography.xlsx'),
      voters: join(dir, 'voters.xlsx'),
      psNames: join(dir, 'ps-names.json'),
      fixes: fixes === undefined ? undefined : join(dir, 'fixes.json'),
      psNamesLenient: uploads.psNames === undefined,
    };
    await writeFile(files.geography, geography, { mode: 0o600 });
    await writeFile(files.voters, voters, { mode: 0o600 });
    await writeFile(join(dir, 'ps-names.json'), psNames, { mode: 0o600 });
    if (files.fixes !== undefined && fixes !== undefined)
      await writeFile(files.fixes, fixes, { mode: 0o600 });
    return await work(files);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const plain = (lines: readonly SourcedLine[]) => lines.map((l) => officerLine(l.source, l.text));

function checkBody(check: MasterCheck) {
  return {
    ok: check.ok,
    counts: check.counts,
    totalVoters: check.totalVoters,
    problems: plain(check.errors),
    warnings: plain(check.warnings),
  };
}

/** The dry run: counts and problems; nothing in the database is read or changed. */
export async function checkMasterData(
  pool: Pool,
  config: AppConfig,
  who: Actor,
  uploads: MasterUploads,
) {
  const setup = backupSetup(config);
  return withStagedFiles(pool, setup, uploads, async (files) =>
    checkBody(await checkMasterFiles(files, scriptContext(pool, config, who))),
  );
}

export async function replaceMasterData(
  pool: Pool,
  config: AppConfig,
  req: Request,
  who: Actor,
  uploads: MasterUploads,
  password: string | undefined,
) {
  const setup = resetSetup(config);
  await assertCountingUnlocked(pool);
  await confirmDanger(pool, req, who, password);
  const ctx = { ...scriptContext(pool, config, who), actor: auditActor(who) };
  const result = await withStagedFiles(pool, setup, uploads, (files) =>
    runMasterDataReplace(files, ctx, setup),
  );
  switch (result.kind) {
    case 'CHECK_FAILED':
      return { status: result.kind, ...checkBody(result.check) };
    case 'IMPORT_FAILED':
      return {
        status: result.kind,
        ok: false,
        problems: plain(result.errors),
        backupFile: basename(result.backup.path),
      };
    case 'DONE':
      // The fixes file just used becomes the default for next time.
      if (uploads.fixes !== undefined) {
        await mkdir(join(setup.backupDir, 'master'), { recursive: true, mode: 0o700 });
        await writeFile(savedFixesPath(setup), uploads.fixes.text, { mode: 0o600 });
      }
      return {
        status: result.kind,
        ...checkBody(result.check),
        backupFile: basename(result.backup.path),
      };
  }
}

// ---------------------------------------------------------------- booths (backup after the checks)

export async function backupNow(config: AppConfig, pool: Pool, label: string): Promise<string> {
  const setup = backupSetup(config);
  return basename((await createBackup(pool, setup.backupDir, label, new Date())).path);
}

// ---------------------------------------------------------------- counting lock

export async function setCountingLock(pool: Pool, who: Actor, on: boolean): Promise<void> {
  await withMasterDataWrite(pool, async (conn) => {
    if ((await isCountingLocked(conn)) === on) throw new ApiError(409, 'NO_CHANGE');
    await writeCountingLock(conn, on);
    await writeAudit(
      conn,
      {
        action: on ? 'COUNTING_LOCK_ON' : 'COUNTING_LOCK_OFF',
        entity: 'app_settings',
        entityId: null,
        oldValue: { counting_lock: on ? 'off' : 'on' },
        newValue: { counting_lock: on ? 'on' : 'off' },
      },
      auditActor(who),
    );
  });
}
