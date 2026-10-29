// DM "RO सूची": the 13 PS_RO seats and the ZP_RO seat. Create (empty seat only, the usual limits),
// replace (the one exception to "disabled accounts count"), change username/password, view the
// current password, disable/enable, unlock. Passwords are never logged or audited. The only copy
// besides the bcrypt hash is the AES-256-GCM one (password-vault.ts) that "view" decrypts.
// The DM's own account is never managed here (CLI only).
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import {
  USERNAME_PATTERN,
  checkChosenPassword,
  checkNewAccount,
  clearLoginLock,
  generateUsername,
  insertAccount,
  phoneLast4,
  setAccountActive,
} from '../../services/master-data/accounts.js';
import type { Role } from '../../services/master-data/accounts.js';
import { hashPassword, generatePassword } from '../../services/master-data/passwords.js';
import { decryptPassword, encryptPassword } from '../../services/master-data/password-vault.js';
import { psHi } from '../../services/master-data/issues-hi.js';
import { loadPanchayatSamitis } from '../../services/master-data/lookups.js';
import { withMasterDataWrite } from '../../services/master-data/lock.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from './http.js';
import type { Actor } from './http.js';

export type Seat = { role: 'PS_RO'; psId: number } | { role: 'ZP_RO' };

export function parseSeat(text: string): Seat | null {
  if (text === 'ZP') return { role: 'ZP_RO' };
  const m = /^PS:([1-9]\d{0,9})$/.exec(text);
  return m ? { role: 'PS_RO', psId: Number(m[1]) } : null;
}

interface AccountRow {
  id: number;
  username: string;
  fullName: string | null;
  phone: string | null;
  role: Role;
  psId: number | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  lockedNow: boolean;
  failedLogins: number;
}

const ACCOUNT_COLUMNS = `id, username, full_name, phone, role, panchayat_samiti_id, is_active, last_login_at,
  failed_login_count, (locked_until IS NOT NULL AND locked_until > NOW(3)) AS locked_now`;

function toAccount(r: RowDataPacket): AccountRow {
  return {
    id: Number(r.id),
    username: String(r.username),
    fullName: r.full_name === null ? null : String(r.full_name),
    phone: r.phone === null ? null : String(r.phone),
    role: r.role as AccountRow['role'],
    psId: r.panchayat_samiti_id === null ? null : Number(r.panchayat_samiti_id),
    isActive: Number(r.is_active) === 1,
    lastLoginAt: r.last_login_at instanceof Date ? r.last_login_at : null,
    lockedNow: Number(r.locked_now) === 1,
    failedLogins: Number(r.failed_login_count),
  };
}

const publicAccount = (a: AccountRow) => ({
  id: a.id,
  username: a.username,
  fullName: a.fullName,
  phone: a.phone,
  isActive: a.isActive,
  lastLoginAt: a.lastLoginAt,
  locked: a.lockedNow,
});

/** Every seat with the account shown for it: the active one, else the newest disabled one. */
export async function listSeats(pool: Pool) {
  const psList = [...(await loadPanchayatSamitis(pool)).values()].sort((a, b) =>
    a.name_hindi.localeCompare(b.name_hindi, 'hi'),
  );
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE role IN ('PS_RO', 'ZP_RO') ORDER BY id`,
  );
  const accounts = rows.map(toAccount);
  const shown = (list: AccountRow[]) =>
    list.find((a) => a.isActive) ?? [...list].sort((a, b) => b.id - a.id)[0] ?? null;
  const seat = (key: string, label: string, list: AccountRow[]) => {
    const account = shown(list);
    return {
      seat: key,
      label,
      account: account === null ? null : publicAccount(account),
      /** Older (replaced or disabled) accounts of this seat, kept for the audit history. */
      olderAccounts: list.length - (account === null ? 0 : 1),
    };
  };
  return [
    ...psList.map((ps) =>
      seat(
        `PS:${ps.id}`,
        psHi(ps.name_hindi),
        accounts.filter((a) => a.role === 'PS_RO' && a.psId === ps.id),
      ),
    ),
    seat(
      'ZP',
      'ज़िला परिषद',
      accounts.filter((a) => a.role === 'ZP_RO'),
    ),
  ];
}

async function seatPs(conn: Pool | PoolConnection, seat: Seat) {
  if (seat.role === 'ZP_RO') return null;
  const ps = [...(await loadPanchayatSamitis(conn)).values()].find((p) => p.id === seat.psId);
  if (!ps) throw new ApiError(404, 'NOT_FOUND');
  return ps;
}

/** Locks and reads one RO account. The DM / Super Admin account (or an unknown id) is never managed here. */
async function lockRoAccount(conn: PoolConnection, userId: number): Promise<AccountRow> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = ? FOR UPDATE`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  const account = toAccount(row);
  if (account.role !== 'PS_RO' && account.role !== 'ZP_RO') throw new ApiError(403, 'FORBIDDEN');
  return account;
}

/** Ends every open session of a user (password reset, disable, replace). */
async function endSessions(conn: PoolConnection, userId: number): Promise<void> {
  await conn.execute(
    "DELETE FROM sessions WHERE JSON_VALID(data) AND JSON_EXTRACT(data, '$.userId') = ?",
    [userId],
  );
}

/** Another active account on the same seat? (one active login per seat) */
async function seatHasOtherActive(conn: PoolConnection, a: AccountRow): Promise<boolean> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE role = ? AND IFNULL(panchayat_samiti_id, 0) = ? AND is_active = 1
        AND id <> ? FOR UPDATE`,
    [a.role, a.psId ?? 0, a.id],
  );
  return rows.length > 0;
}

/** A free random username (retries on the rare collision). */
async function freeUsername(conn: PoolConnection, seat: Seat, psEnglish: string | null) {
  for (let i = 0; i < 10; i++) {
    const username = generateUsername(seat.role, psEnglish);
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
      username,
    ]);
    if (rows.length === 0) return username;
  }
  throw new Error('could not find a free username');
}

/** An account write that needs the DM's password again (create, credentials, lockout). */
async function inUserWrite<T>(
  pool: Pool,
  who: Actor,
  password: string,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  await requireReauth(pool, who.user.id, password, who.ip);
  return userWrite(pool, async (conn) => {
    await resetFailedLogins(conn, who.user.id);
    return work(conn);
  });
}

/** An account write without a password re-check (phone, replace, disable/enable, view). */
function userWrite<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  return busyAsConflict(() => withMasterDataWrite(pool, work));
}

export interface NewCredentials {
  username: string;
  password: string;
}

/** "नया RO बनाएँ": only for a seat that never had an account (the Part 2 limits, unchanged). */
export async function createSeatAccount(
  pool: Pool,
  who: Actor,
  body: { seat: Seat; fullName: string; phone: string; password: string },
  vaultKey: Buffer,
): Promise<NewCredentials> {
  const ps = await seatPs(pool, body.seat);
  return inUserWrite(pool, who, body.password, async (conn) => {
    const role = body.seat.role;
    const username = await freeUsername(conn, body.seat, ps?.name_english ?? null);
    const issues = await checkNewAccount(conn, {
      role,
      username,
      psId: ps?.id ?? null,
      psName: ps?.name_english ?? null,
    });
    if (issues.length > 0) throw new ApiError(409, 'SEAT_TAKEN');
    const created = await insertAccount(
      conn,
      {
        username,
        fullName: body.fullName,
        role,
        psId: ps?.id ?? null,
        phone: body.phone,
      },
      vaultKey,
    );
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'USER_CREATE',
      entity: 'users',
      entityId: created.id,
      newValue: {
        via: 'web',
        username,
        full_name: body.fullName,
        phone_last4: phoneLast4(body.phone),
        role,
        panchayat_samiti: ps?.name_english ?? null,
      },
      ip: who.ip,
    });
    return { username, password: created.password };
  });
}

/** "RO बदलें": the old account is disabled (and logged out) and a new account is created. */
export async function replaceAccount(
  pool: Pool,
  who: Actor,
  userId: number,
  body: { fullName: string; phone: string },
  vaultKey: Buffer,
): Promise<NewCredentials> {
  return userWrite(pool, async (conn) => {
    const old = await lockRoAccount(conn, userId);
    if (await seatHasOtherActive(conn, old)) throw new ApiError(409, 'SEAT_TAKEN');
    const seat: Seat =
      old.role === 'PS_RO' ? { role: 'PS_RO', psId: old.psId ?? 0 } : { role: 'ZP_RO' };
    const ps = await seatPs(conn, seat);
    if (old.isActive) await setAccountActive(conn, old.id, false);
    await endSessions(conn, old.id);
    const username = await freeUsername(conn, seat, ps?.name_english ?? null);
    const created = await insertAccount(
      conn,
      {
        username,
        fullName: body.fullName,
        role: seat.role,
        psId: ps?.id ?? null,
        phone: body.phone,
      },
      vaultKey,
    );
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'USER_REPLACE',
      entity: 'users',
      entityId: created.id,
      oldValue: {
        id: old.id,
        username: old.username,
        full_name: old.fullName,
        is_active: old.isActive,
      },
      newValue: {
        id: created.id,
        username,
        full_name: body.fullName,
        phone_last4: phoneLast4(body.phone),
        role: seat.role,
        panchayat_samiti: ps?.name_english ?? null,
        old_account_disabled: true,
      },
      ip: who.ip,
    });
    return { username, password: created.password };
  });
}

/** password is null only after a rename of an account that has no readable password copy. */
export interface SavedCredentials {
  username: string;
  password: string | null;
  /** Present (false) only when just the mobile number changed: the login and the RO's session stay. */
  credentialsChanged?: false;
}

export interface ViewedPassword {
  username: string;
  password: string;
}

/**
 * "देखें": shows the RO's current password. DM only (after a confirm popup in the UI), audit
 * RO_PASSWORD_VIEWED (who/which account, never the password). 409 NO_COPY when the account has no
 * readable encrypted copy (older accounts): the DM sets a new password instead.
 */
export async function viewAccountPassword(
  pool: Pool,
  who: Actor,
  userId: number,
  vaultKey: Buffer,
): Promise<ViewedPassword> {
  return userWrite(pool, async (conn) => {
    const account = await lockRoAccount(conn, userId);
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT password_enc FROM users WHERE id = ?',
      [account.id],
    );
    const blob: unknown = rows[0]?.password_enc;
    if (!Buffer.isBuffer(blob)) throw new ApiError(409, 'NO_COPY');
    let password: string;
    try {
      password = decryptPassword(blob, vaultKey);
    } catch {
      throw new ApiError(409, 'NO_COPY');
    }
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'RO_PASSWORD_VIEWED',
      entity: 'users',
      entityId: account.id,
      newValue: { via: 'web', username: account.username },
      ip: who.ip,
    });
    return { username: account.username, password };
  });
}

/** A new strong, easy-to-read password for the form's "अपने आप बनाएं" (nothing is saved). */
export function suggestPassword(): string {
  return generatePassword();
}

/**
 * "बदलें": one form changes the username and/or the password of an RO. Rules checked first (nothing
 * written), then the DM's password, then ONE transaction: username unique, bcrypt hash + encrypted
 * copy, lockout cleared, the RO's sessions ended, one audit row (RO_CREDENTIALS_CHANGED, no password).
 */
export async function updateCredentials(
  pool: Pool,
  who: Actor,
  userId: number,
  body: {
    username: string;
    newPassword?: string | undefined;
    phone?: string | undefined;
    password: string;
  },
  vaultKey: Buffer,
): Promise<SavedCredentials> {
  if (!USERNAME_PATTERN.test(body.username)) throw new ApiError(400, 'USERNAME_INVALID');
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT role FROM users WHERE id = ?', [
    userId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND');
  if (rows[0].role !== 'PS_RO' && rows[0].role !== 'ZP_RO') throw new ApiError(403, 'FORBIDDEN');
  const chosen = body.newPassword;
  if (chosen !== undefined) {
    const problem = checkChosenPassword(chosen, chosen, body.username)[0];
    if (problem !== undefined) throw new ApiError(400, problem);
  }

  return inUserWrite(pool, who, body.password, async (conn) => {
    const account = await lockRoAccount(conn, userId);
    const renamed = body.username !== account.username;
    const phoneChanged = body.phone !== undefined && body.phone !== account.phone;
    const loginChanged = renamed || chosen !== undefined;
    if (!loginChanged && !phoneChanged) throw new ApiError(409, 'NO_CHANGE');
    if (renamed) {
      const [taken] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ? AND id <> ?',
        [body.username, account.id],
      );
      if (taken.length > 0) throw new ApiError(409, 'USERNAME_TAKEN');
    }
    if (loginChanged) {
      if (chosen !== undefined) {
        await conn.execute(
          'UPDATE users SET username = ?, password_hash = ?, password_enc = ? WHERE id = ?',
          [
            body.username,
            await hashPassword(chosen),
            encryptPassword(chosen, vaultKey),
            account.id,
          ],
        );
      } else {
        await conn.execute('UPDATE users SET username = ? WHERE id = ?', [
          body.username,
          account.id,
        ]);
      }
      await clearLoginLock(conn, account.id);
      await endSessions(conn, account.id);
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'RO_CREDENTIALS_CHANGED',
        entity: 'users',
        entityId: account.id,
        oldValue: { username: account.username },
        newValue: {
          via: 'web',
          username: body.username,
          username_changed: renamed,
          password_changed: chosen !== undefined,
          failed_login_count: 0,
          locked_until: null,
        },
        ip: who.ip,
      });
    }
    if (phoneChanged && body.phone !== undefined) {
      await writeAccountPhone(conn, who, account, body.phone);
    }
    return {
      username: body.username,
      password: loginChanged
        ? (chosen ?? (await currentPassword(conn, account.id, vaultKey)))
        : null,
      ...(loginChanged ? {} : { credentialsChanged: false as const }),
    };
  });
}

/** The saved password again (for the "copy" screen after a rename without a password change). */
async function currentPassword(conn: PoolConnection, userId: number, vaultKey: Buffer) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT password_enc FROM users WHERE id = ?',
    [userId],
  );
  const blob: unknown = rows[0]?.password_enc;
  if (!Buffer.isBuffer(blob)) return null;
  try {
    return decryptPassword(blob, vaultKey);
  } catch {
    return null;
  }
}

/** Saves the number and audits it (only the last 4 digits are logged). */
async function writeAccountPhone(
  conn: PoolConnection,
  who: Actor,
  account: AccountRow,
  phone: string,
): Promise<void> {
  await conn.execute('UPDATE users SET phone = ? WHERE id = ?', [phone, account.id]);
  await writeAudit(conn, {
    userId: who.user.id,
    action: account.phone === null ? 'RO_PHONE_ADDED' : 'RO_PHONE_CHANGED',
    entity: 'users',
    entityId: account.id,
    oldValue: { phone_last4: phoneLast4(account.phone) },
    newValue: { via: 'web', username: account.username, phone_last4: phoneLast4(phone) },
    ip: who.ip,
  });
}

/** "मोबाइल जोड़ें / बदलें": sets the RO's mobile number. Audit keeps only the last 4 digits. */
export async function setAccountPhone(
  pool: Pool,
  who: Actor,
  userId: number,
  body: { phone: string },
): Promise<void> {
  await userWrite(pool, async (conn) => {
    const account = await lockRoAccount(conn, userId);
    if (account.phone === body.phone) throw new ApiError(409, 'NO_CHANGE');
    await writeAccountPhone(conn, who, account, body.phone);
  });
}

/** "बंद करें" / "चालू करें". Enabling needs a free seat (one active login per seat). */
export async function setRoActive(
  pool: Pool,
  who: Actor,
  userId: number,
  active: boolean,
): Promise<void> {
  await userWrite(pool, async (conn) => {
    const account = await lockRoAccount(conn, userId);
    if (account.isActive === active) throw new ApiError(409, 'NO_CHANGE');
    if (active && (await seatHasOtherActive(conn, account))) throw new ApiError(409, 'SEAT_TAKEN');
    await setAccountActive(conn, account.id, active);
    if (!active) await endSessions(conn, account.id);
    await writeAudit(conn, {
      userId: who.user.id,
      action: active ? 'USER_ENABLE' : 'USER_DISABLE',
      entity: 'users',
      entityId: account.id,
      oldValue: { is_active: !active },
      newValue: { via: 'web', username: account.username, is_active: active },
      ip: who.ip,
    });
  });
}

/** "लॉक खोलें": clears a login lockout; the password is unchanged. */
export async function unlockAccount(
  pool: Pool,
  who: Actor,
  userId: number,
  body: { password: string },
): Promise<void> {
  await inUserWrite(pool, who, body.password, async (conn) => {
    const account = await lockRoAccount(conn, userId);
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT locked_until FROM users WHERE id = ?',
      [account.id],
    );
    const lockedUntil = rows[0]?.locked_until instanceof Date ? rows[0].locked_until : null;
    if (lockedUntil === null && account.failedLogins === 0) throw new ApiError(409, 'NO_CHANGE');
    await clearLoginLock(conn, account.id);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'USER_UNLOCKED',
      entity: 'users',
      entityId: account.id,
      oldValue: {
        failed_login_count: account.failedLogins,
        locked_until: lockedUntil === null ? null : lockedUntil.toISOString(),
      },
      newValue: {
        via: 'web',
        username: account.username,
        unlocked_by_name: who.user.fullName ?? who.user.username,
        failed_login_count: 0,
        locked_until: null,
      },
      ip: who.ip,
    });
  });
}
