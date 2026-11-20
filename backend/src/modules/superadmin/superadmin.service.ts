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
import { writeAudit as writeExportAudit } from '../../services/audit.js';
import { emitWardChanged } from '../../services/events.js';
import { maskEmail } from '../../services/mailer.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { decodeXlsxUpload } from '../../services/master-data/upload.js';
import { writeAudit } from '../../services/setup/audit.js';
import {
  SCREEN_NUMBERS,
  readScreensOff,
  writeScreenPower,
} from '../../services/setup/screen-power.js';
import type { ScreenNumber } from '../../services/setup/screen-power.js';
import { endScreenSessions, readUnlockLockouts } from '../screen-access/screen-keys.service.js';
import type { ScreenAccess } from '../screen-access/screen-access.js';

/** One public screen in the panel's header strip. */
export interface ScreenPowerRow {
  screen: ScreenNumber;
  on: boolean;
  /** The last ON/OFF switch of this screen, from the audit log; null when it was never switched. */
  lastChange: { at: string; byName: string } | null;
}
import type { AuditActor } from '../../services/setup/audit.js';
import { createBackup, latestBackup } from '../../services/setup/backup.js';
import {
  assertCountingUnlocked,
  isCountingLocked,
  writeCountingLock,
} from '../../services/setup/counting-lock.js';
import { buildCountingExport, exportRowCounts } from '../../services/setup/counting-export.js';
import {
  countingDataImpact,
  countingDataKept,
  runCountingDataReset,
  runTestDataReset,
  testDataImpact,
} from '../../services/setup/data-reset.js';
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
  const countingData = await countingDataImpact(pool);
  const countingKept = await countingDataKept(pool);
  const master = await masterDataImpact(pool);
  const [ps] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name_english, name_hindi FROM panchayat_samiti ORDER BY name_english',
  );
  const [voters] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(registered_voters_total), 0) AS n FROM booth',
  );
  // Shown in the panel's header strip only (read only, like the counts above it).
  const [roAccounts] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM users WHERE role IN ('PS_RO', 'ZP_RO') AND is_active = 1`,
  );
  const backup = config.setup === undefined ? null : await latestBackup(config.setup.backupDir);
  const screens = await screenPowerRows(pool);
  const screenLockouts = await readUnlockLockouts(pool);
  const nothingToClear = Object.values(testData).every((n) => n === 0);
  const noCountingData = Object.values(countingData).every((n) => n === 0);
  const blocked = (extra: string | null) =>
    locked ? LOCKED_REASON : !resetReady ? NOT_CONFIGURED_REASON : extra;
  const testReason = blocked(nothingToClear ? 'साफ़ करने के लिए कोई test data नहीं है' : null);
  const countingReason = blocked(noCountingData ? 'हटाने के लिए कोई मतगणना data नहीं है' : null);
  const masterReason = blocked(null);
  return {
    countingLocked: locked,
    screens,
    screenLockouts,
    confirmedUntil: confirmedUntil(req),
    counts: {
      panchayatSamitis: ps.length,
      ...master,
      voters: Number(voters[0]?.n ?? 0),
      roAccounts: Number(roAccounts[0]?.n ?? 0),
    },
    /** When the newest backup file was written, or null when there is none yet. */
    lastBackupAt: backup?.at ?? null,
    testData: { allowed: testReason === null, reason: testReason, deletes: testData },
    countingData: {
      allowed: countingReason === null,
      reason: countingReason,
      deletes: countingData,
      keeps: countingKept,
    },
    // The download is read only: allowed even while the counting lock is ON.
    countingExport: { rows: await exportRowCounts(pool) },
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

// ---------------------------------------------------------------- counting-only reset

/**
 * "मतगणना डेटा हटाएँ": deletes only what the ROs entered (booth / postal entries and their votes,
 * declarations, voided entries). Candidates, the candidate change history and every ward's
 * candidate-list lock / ready state survive, so counting can simply be re-run. Same safety as the
 * full reset: counting lock, typed word, password (or the confirm window), backup, audit.
 */
export async function resetCountingData(
  pool: Pool,
  config: AppConfig,
  req: Request,
  who: Actor,
  password: string | undefined,
) {
  const setup = resetSetup(config);
  await assertCountingUnlocked(pool);
  await confirmDanger(pool, req, who, password);
  const backup = await createBackup(pool, setup.backupDir, 'counting-data', new Date());
  const { deleted, kept } = await runCountingDataReset(
    setup.migrationDb,
    pool,
    auditActor(who),
    backup.path,
  );
  return { ok: true, deleted, kept, backupFile: basename(backup.path) };
}

// ---------------------------------------------------------------- counting-data download

/** The .zip of counting CSVs, plus one audit row. Read only; never blocks a reset. */
export async function exportCountingData(pool: Pool, who: Actor) {
  const file = await buildCountingExport(pool, new Date());
  await writeExportAudit(pool, {
    userId: who.user.id,
    action: 'REPORT_EXPORTED',
    entity: 'database',
    entityId: null,
    newValue: { section: 'counting-data-export', format: 'zip', rows: file.counts },
    ip: who.ip,
  });
  return file;
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

/**
 * Turns ONE public screen on or off (Super Admin only; the route enforces the role). The other two
 * screens are untouched. The snapshot service notices the setting within its poll, so the TV follows
 * on its own — nobody walks to it, and the screen's key session stays valid.
 */
/** The three screens with their state and the last switch (who and when), newest audit row wins. */
export async function screenPowerRows(pool: Pool): Promise<ScreenPowerRow[]> {
  const off = await readScreensOff(pool);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.new_value, a.created_at, COALESCE(u.full_name, u.username) AS by_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action IN ('SCREEN_TURNED_ON', 'SCREEN_TURNED_OFF')
      ORDER BY a.id DESC
      LIMIT 60`,
  );
  const lastOf = (screen: ScreenNumber) => {
    for (const r of rows) {
      const value = r.new_value as { screen?: unknown } | null;
      if (value !== null && value.screen === screen) {
        return { at: (r.created_at as Date).toISOString(), byName: String(r.by_name) };
      }
    }
    return null;
  };
  return SCREEN_NUMBERS.map((screen) => ({
    screen,
    on: !off.includes(screen),
    lastChange: lastOf(screen),
  }));
}

/**
 * Clears the key popup's attempt lockout so a blocked screen can be unlocked at once instead of
 * waiting out the window.
 *
 * It clears COUNTERS and nothing else: no key is read, changed or revoked, no screen session is
 * touched, and no TV's picture changes. The audit row keeps which lockouts were in effect when it
 * was pressed, so the reason for pressing it is on record.
 */
export async function clearScreenUnlockLockout(
  pool: Pool,
  who: Actor,
  access: ScreenAccess,
): Promise<void> {
  const cleared = await readUnlockLockouts(pool);
  await access.clearUnlockLockouts();
  await writeAudit(
    pool,
    {
      action: 'SCREEN_UNLOCK_LOCKOUT_CLEARED',
      entity: 'screen_key',
      entityId: null,
      newValue: { cleared: cleared.map((l) => ({ screen: l.screen, until: l.until })) },
    },
    auditActor(who),
  );
}

/**
 * Turns ONE public screen on or off.
 *
 * Switching it EITHER WAY also ends that screen's screen sessions, in the same transaction as the
 * setting and the audit row — and only that screen's (the other two TVs keep running untouched).
 * Off is the moment the screen's access is withdrawn; on is checked again because a key typed during
 * the off window must not survive into the next showing. So after an off-and-on the TV asks for its
 * key again by itself, while a plain reload of a screen that stayed on never does.
 */
export async function setScreenPower(
  pool: Pool,
  who: Actor,
  screen: ScreenNumber,
  on: boolean,
): Promise<{ screensOff: ScreenNumber[]; sessionsEnded: number }> {
  return withMasterDataWrite(pool, async (conn) => {
    const before = await readScreensOff(conn);
    if (before.includes(screen) === !on) throw new ApiError(409, 'NO_CHANGE');
    const after = await writeScreenPower(conn, screen, on);
    const sessionsEnded = await endScreenSessions(conn, screen);
    await writeAudit(
      conn,
      {
        action: on ? 'SCREEN_TURNED_ON' : 'SCREEN_TURNED_OFF',
        entity: 'app_settings',
        entityId: null,
        oldValue: { screen, screens_off: before },
        newValue: { screen, screens_off: after, sessionsEnded },
      },
      auditActor(who),
    );
    return { screensOff: after, sessionsEnded };
  });
}

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

// ---------------------------------------------------------------- undeclare a ZP ward

/**
 * "घोषित ZP ward वापस खोलें" (DEO, Nov 2026). A Zila Parishad ward declared by mistake can be put
 * back to "गिनती चल रही है" so the ZP RO can declare it again.
 *
 * NOTHING IS LOST. Every declaration version of the ward is copied into `undeclared_ward` —
 * append-only, kept for ever, with who undeclared it, when and why — in the SAME transaction that
 * removes it from `ward_declarations`. The ward row is locked first, exactly as a declare or a
 * correction does, so an undeclare can never interleave with either of them.
 *
 * It is deliberately NOT blocked by the Counting Lock: its whole purpose is counting day.
 */
export interface DeclaredZpWard {
  wardId: number;
  wardNo: number;
  versions: number;
  status: string;
  winnerName: string;
  margin: number;
  declaredAt: string;
}

/** Every declared Zila Parishad ward, newest declaration first (the panel's undeclare list). */
export async function listDeclaredZpWards(pool: Pool): Promise<DeclaredZpWard[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.id, w.ward_no, d.version, d.status, d.margin, d.declared_at,
            c.name_hindi AS winner_name,
            (SELECT COUNT(*) FROM ward_declarations x WHERE x.ward_id = w.id) AS versions
       FROM ward w
       JOIN ward_declarations d ON d.ward_id = w.id
       LEFT JOIN candidate c ON c.id = d.winner_candidate_id
      WHERE w.ward_type = 'ZP'
        AND d.version = (SELECT MAX(y.version) FROM ward_declarations y WHERE y.ward_id = w.id)
      ORDER BY d.declared_at DESC, w.ward_no`,
  );
  return rows.map((r) => ({
    wardId: Number(r.id),
    wardNo: Number(r.ward_no),
    versions: Number(r.versions),
    status: String(r.status),
    winnerName: r.winner_name === null ? '' : String(r.winner_name),
    margin: Number(r.margin),
    declaredAt: (r.declared_at as Date).toISOString(),
  }));
}

/** Every refusal of an undeclare, before the password is asked and before any backup is made. */
export async function checkUndeclare(pool: Pool, wardId: number): Promise<{ wardNo: number }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT ward_no, ward_type FROM ward WHERE id = ?',
    [wardId],
  );
  const ward = rows[0];
  if (ward === undefined) throw new ApiError(404, 'NOT_FOUND');
  // PS wards are the PS RO's; only Zila Parishad wards may be undeclared from this panel.
  if (String(ward.ward_type) !== 'ZP') throw new ApiError(400, 'NOT_A_ZP_WARD');
  const [declared] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 AS x FROM ward_declarations WHERE ward_id = ? LIMIT 1',
    [wardId],
  );
  if (declared.length === 0) throw new ApiError(409, 'NOT_DECLARED');
  return { wardNo: Number(ward.ward_no) };
}

export async function undeclareZpWard(
  pool: Pool,
  who: Actor,
  wardId: number,
  reason: string,
): Promise<{ ok: true; wardId: number; wardNo: number; versionsArchived: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      // The ward lock, always first — the same lock declare and correction take.
      const [wardRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id, ward_no FROM ward WHERE id = ? AND ward_type = 'ZP' FOR UPDATE",
        [wardId],
      );
      const ward = wardRows[0];
      if (ward === undefined) throw new ApiError(404, 'NOT_FOUND');
      const [declarations] = await conn.execute<RowDataPacket[]>(
        `SELECT d.version, d.status, d.winner_candidate_id, d.margin, d.snapshot, d.lottery_details,
                d.nota_highest_ack, d.declared_by, d.declared_at, d.correction_reason,
                c.name_hindi AS winner_name
           FROM ward_declarations d
           LEFT JOIN candidate c ON c.id = d.winner_candidate_id
          WHERE d.ward_id = ? ORDER BY d.version`,
        [wardId],
      );
      if (declarations.length === 0) throw new ApiError(409, 'NOT_DECLARED');
      // Archive FIRST, delete after: if anything fails the whole transaction rolls back and the
      // declaration is untouched.
      for (const d of declarations) {
        await conn.execute(
          `INSERT INTO undeclared_ward (ward_id, version, status, winner_candidate_id, winner_name,
             margin, snapshot, lottery_details, nota_highest_ack, declared_by, declared_at,
             correction_reason, undeclared_by, undeclare_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            wardId,
            Number(d.version),
            String(d.status),
            Number(d.winner_candidate_id),
            d.winner_name === null ? null : String(d.winner_name),
            Number(d.margin),
            JSON.stringify(d.snapshot ?? null),
            d.lottery_details === null || d.lottery_details === undefined
              ? null
              : JSON.stringify(d.lottery_details),
            Number(d.nota_highest_ack) === 1 ? 1 : 0,
            Number(d.declared_by),
            d.declared_at as Date,
            d.correction_reason === null ? null : String(d.correction_reason),
            who.user.id,
            reason,
          ],
        );
      }
      await conn.execute('DELETE FROM ward_declarations WHERE ward_id = ?', [wardId]);
      await writeAudit(
        conn,
        {
          action: 'WARD_UNDECLARED',
          entity: 'ward',
          entityId: wardId,
          oldValue: {
            ward_no: Number(ward.ward_no),
            versions: declarations.map((d) => ({
              version: Number(d.version),
              status: String(d.status),
              winner_candidate_id: Number(d.winner_candidate_id),
              margin: Number(d.margin),
              declared_at: (d.declared_at as Date).toISOString(),
            })),
          },
          newValue: { undeclared: true, versions_archived: declarations.length },
          reason,
        },
        auditActor(who),
      );
      await conn.commit();
      const outcome = {
        ok: true as const,
        wardId,
        wardNo: Number(ward.ward_no),
        versionsArchived: declarations.length,
      };
      // Only after a successful commit: the TV screens and every report pick the ward up again.
      emitWardChanged(wardId);
      return outcome;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    conn.release();
  }
}
