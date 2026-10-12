// Login-account rules, shared by the users:* scripts and the DM's "RO सूची" page.
//   Exactly 15 logins: 13 PS_RO (one per PS), 1 ZP_RO, 1 DM. Disabled accounts count.
//   The one exception is "replace" (DM only): the seat's old account is disabled and a new one is
//   created in the same transaction. The database still allows only one ACTIVE account per seat
//   (users.active_slot is UNIQUE), so there are never more than 15 active logins.
import { randomInt } from 'node:crypto';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { countOf } from './db-count.js';
import { generatePassword, hashPassword } from './passwords.js';

export type Role = 'PS_RO' | 'ZP_RO' | 'DM';
export const ROLES: readonly Role[] = ['PS_RO', 'ZP_RO', 'DM'];

/** Exactly 15 logins in total: 13 PS_RO (one per PS), 1 ZP_RO, 1 DM. Disabled accounts count. */
export const ROLE_LIMITS: Readonly<Record<Role, number>> = { PS_RO: 13, ZP_RO: 1, DM: 1 };

export const USERNAME_PATTERN = /^[a-z0-9_]{4,30}$/;
export const MAX_FULL_NAME_LENGTH = 100;

export type AccountIssue =
  | { code: 'USERNAME_TAKEN'; username: string }
  | { code: 'PS_SEAT_TAKEN'; psName: string }
  | { code: 'ROLE_LIMIT'; role: Role; count: number; limit: number };

/** English text, exactly as the users:create report has always said it. */
export function accountIssueTextEn(issue: AccountIssue): string {
  switch (issue.code) {
    case 'USERNAME_TAKEN':
      return `Username "${issue.username}" already exists.`;
    case 'PS_SEAT_TAKEN':
      return `${issue.psName} already has a PS_RO account (one per PS).`;
    case 'ROLE_LIMIT':
      return `There are already ${issue.count} ${issue.role} account(s); the limit is ${issue.limit} (disabled accounts count).`;
  }
}

/** The account limits for a brand-new account on a seat (never used by "replace"). */
export async function checkNewAccount(
  conn: PoolConnection,
  account: { role: Role; username: string; psId: number | null; psName: string | null },
): Promise<AccountIssue[]> {
  const issues: AccountIssue[] = [];
  if (
    (await countOf(conn, 'SELECT COUNT(*) AS n FROM users WHERE username = ?', [
      account.username,
    ])) > 0
  )
    issues.push({ code: 'USERNAME_TAKEN', username: account.username });
  if (account.role === 'PS_RO' && account.psId !== null) {
    const forPs = await countOf(
      conn,
      "SELECT COUNT(*) AS n FROM users WHERE role = 'PS_RO' AND panchayat_samiti_id = ?",
      [account.psId],
    );
    if (forPs > 0) issues.push({ code: 'PS_SEAT_TAKEN', psName: account.psName ?? '' });
  }
  const sameRole = await countOf(conn, 'SELECT COUNT(*) AS n FROM users WHERE role = ?', [
    account.role,
  ]);
  if (sameRole >= ROLE_LIMITS[account.role]) {
    issues.push({
      code: 'ROLE_LIMIT',
      role: account.role,
      count: sameRole,
      limit: ROLE_LIMITS[account.role],
    });
  }
  return issues;
}

/**
 * Inserts the account with a fresh random password (bcrypt cost 12). The password is returned once
 * for the officer; it is never stored, logged or audited.
 */
export async function insertAccount(
  conn: PoolConnection,
  account: { username: string; fullName: string; role: Role; psId: number | null },
): Promise<{ id: number; password: string }> {
  const password = generatePassword();
  const [inserted] = await conn.execute<ResultSetHeader>(
    `INSERT INTO users (username, full_name, password_hash, role, panchayat_samiti_id)
     VALUES (?, ?, ?, ?, ?)`,
    [account.username, account.fullName, await hashPassword(password), account.role, account.psId],
  );
  return { id: inserted.insertId, password };
}

/** New random password; clears the failed-login count and any lockout. Returns it once. */
export async function setNewPassword(conn: PoolConnection, userId: number): Promise<string> {
  const password = generatePassword();
  await conn.execute(
    'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
    [await hashPassword(password), userId],
  );
  return password;
}

export async function setAccountActive(
  conn: PoolConnection,
  userId: number,
  active: boolean,
): Promise<void> {
  await conn.execute('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, userId]);
}

/** Clears a login lockout (lock time and failed count). The password is unchanged. */
export async function clearLoginLock(conn: PoolConnection, userId: number): Promise<void> {
  await conn.execute('UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = ?', [
    userId,
  ]);
}

// No look-alike characters (0/o, 1/l).
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomSuffix(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += SUFFIX_ALPHABET.charAt(randomInt(SUFFIX_ALPHABET.length));
  return s;
}

/**
 * A username that can't be guessed: a short prefix plus 4 random characters, e.g. ro_chu_k7m2
 * (PS_RO, from the English PS name) or zp_ro_p4x9. Never derived from the PS name alone.
 */
export function generateUsername(role: Role, psNameEnglish: string | null): string {
  if (role === 'ZP_RO') return `zp_ro_${randomSuffix()}`;
  if (role === 'DM') return `dm_${randomSuffix()}`;
  const letters = (psNameEnglish ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const prefix = (letters.slice(0, 3) || 'ps').padEnd(3, 'x');
  return `ro_${prefix}_${randomSuffix()}`;
}
