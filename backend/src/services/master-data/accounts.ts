// Login-account rules, shared by the users:* scripts and the DM's "RO सूची" page.
//   Exactly 15 logins: 13 PS_RO (one per PS), 1 ZP_RO, 1 DM. Disabled accounts count.
//   The one exception is "replace" (DM only): the seat's old account is disabled and a new one is
//   created in the same transaction. The database still allows only one ACTIVE account per seat
//   (users.active_slot is UNIQUE), so there are never more than 15 active logins.
import { randomInt } from 'node:crypto';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { countOf } from './db-count.js';
import { encryptPassword } from './password-vault.js';
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
  vaultKey: Buffer,
): Promise<{ id: number; password: string }> {
  const password = generatePassword();
  // The encrypted copy exists for PS_RO / ZP_RO only, never for the DM.
  const copy = account.role === 'DM' ? null : encryptPassword(password, vaultKey);
  const [inserted] = await conn.execute<ResultSetHeader>(
    `INSERT INTO users (username, full_name, password_hash, password_enc, role, panchayat_samiti_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      account.username,
      account.fullName,
      await hashPassword(password),
      copy,
      account.role,
      account.psId,
    ],
  );
  return { id: inserted.insertId, password };
}

/** New random password; clears the failed-login count and any lockout. Returns it once. */
export async function setNewPassword(
  conn: PoolConnection,
  userId: number,
  vaultKey: Buffer,
): Promise<string> {
  const password = generatePassword();
  await conn.execute(
    `UPDATE users SET password_hash = ?, password_enc = IF(role = 'DM', NULL, ?),
       failed_login_count = 0, locked_until = NULL WHERE id = ?`,
    [await hashPassword(password), encryptPassword(password, vaultKey), userId],
  );
  return password;
}

/** Sets a password the DM chose (bcrypt cost 12); clears the failed-login count and any lockout. */
export async function setChosenPassword(
  conn: PoolConnection,
  userId: number,
  password: string,
  vaultKey: Buffer,
): Promise<void> {
  await conn.execute(
    `UPDATE users SET password_hash = ?, password_enc = IF(role = 'DM', NULL, ?),
       failed_login_count = 0, locked_until = NULL WHERE id = ?`,
    [await hashPassword(password), encryptPassword(password, vaultKey), userId],
  );
}

// ---------------------------------------------------------------- DM-chosen passwords

export const CHOSEN_PASSWORD_MIN = 10;
export const CHOSEN_PASSWORD_MAX = 128;

export type ChosenPasswordProblem =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_NEEDS_LETTER_AND_DIGIT'
  | 'PASSWORD_HAS_USERNAME'
  | 'PASSWORD_TOO_COMMON'
  | 'PASSWORD_MISMATCH';

/** Common / guessable words (lowercase). Checked after undoing simple variations, see below. */
const WEAK_PASSWORDS = new Set([
  'password',
  'passwd',
  'pass',
  'admin',
  'administrator',
  'churu',
  'churu2026',
  'chunav',
  'chunav2026',
  'election',
  'election2026',
  'nirvachan',
  'rajasthan',
  'india',
  'bharat',
  'welcome',
  'qwerty',
  'qwertyuiop',
  'asdf',
  'asdfgh',
  'abcd',
  'abc',
  'abcdef',
  'letmein',
  'test',
  'user',
  'login',
  'dm',
  'ro',
  'iloveyou',
  'secret',
  '123456',
  '1234567890',
]);

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/**
 * True for a common password or a simple variation of one: any case, common letter swaps
 * (0->o, 1->i, 3->e, 4->a, 5->s, @->a, $->s), and digits/symbols added before or after,
 * e.g. "Churu2026!", "P@ssword123", "Admin12345".
 */
export function isWeakPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const swap = (t: string) => t.replace(/[01345@$!]/g, (ch) => LEET[ch] ?? ch);
  const lettersOnlyEdges = (t: string) => t.replace(/^[^a-z]+|[^a-z]+$/g, '');
  // Digits and symbols added before or after the word, e.g. "2026Churu", "Admin12345!".
  const core = lower.replace(/^[\d\W_]+|[\d\W_]+$/g, '');
  const variants = [
    lower,
    lettersOnlyEdges(lower),
    swap(core),
    swap(lower),
    lettersOnlyEdges(swap(lower)),
  ];
  return variants.some((v) => v !== '' && WEAK_PASSWORDS.has(v));
}

/**
 * The rules for a password the DM types for an RO (the server decides; the page shows the same
 * rules as hints). Returns every problem, in this order; empty = acceptable.
 */
export function checkChosenPassword(
  password: string,
  confirm: string,
  username: string,
): ChosenPasswordProblem[] {
  const problems: ChosenPasswordProblem[] = [];
  if (password.length < CHOSEN_PASSWORD_MIN) problems.push('PASSWORD_TOO_SHORT');
  if (password.length > CHOSEN_PASSWORD_MAX) problems.push('PASSWORD_TOO_LONG');
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password))
    problems.push('PASSWORD_NEEDS_LETTER_AND_DIGIT');
  if (username !== '' && password.toLowerCase().includes(username.toLowerCase()))
    problems.push('PASSWORD_HAS_USERNAME');
  if (isWeakPassword(password)) problems.push('PASSWORD_TOO_COMMON');
  if (password !== confirm) problems.push('PASSWORD_MISMATCH');
  return problems;
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
