// "मेरी प्रोफ़ाइल": the DM's own account. Name: current password only. Username and password: current
// password AND a 6-digit OTP mailed to the DM's saved email (set only by the dm-set-email script;
// never changed here). Only an HMAC of the OTP is stored. Passwords and OTPs are never logged.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { USERNAME_PATTERN, checkChosenPassword } from '../../services/master-data/accounts.js';
import { hashPassword } from '../../services/master-data/passwords.js';
import { maskEmail } from '../../services/mailer.js';
import type { Mailer } from '../../services/mailer.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import type { Actor } from '../admin/http.js';

export const OTP_VALID_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;

export type OtpPurpose = 'USERNAME' | 'PASSWORD';

export interface Profile {
  username: string;
  fullName: string | null;
  /** Masked (c*****u@gmail.com), or null when no email is set. */
  email: string | null;
}

async function inTx<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const value = await work(conn);
    await conn.commit();
    return value;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** The DM's own row, locked for the rest of the transaction. */
async function lockSelf(conn: PoolConnection, userId: number) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    "SELECT id, username, full_name, email FROM users WHERE id = ? AND role = 'DM' FOR UPDATE",
    [userId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(403, 'FORBIDDEN');
  return {
    id: Number(row.id),
    username: String(row.username),
    fullName: row.full_name === null ? null : String(row.full_name),
    email: row.email === null ? null : String(row.email),
  };
}

export async function getProfile(pool: Pool, userId: number): Promise<Profile> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT username, full_name, email FROM users WHERE id = ?',
    [userId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    username: String(row.username),
    fullName: row.full_name === null ? null : String(row.full_name),
    email: row.email === null ? null : maskEmail(String(row.email)),
  };
}

/** "नाम बदलें": current password only, no OTP. */
export async function changeName(
  pool: Pool,
  who: Actor,
  body: { fullName: string; password: string },
): Promise<void> {
  await requireReauth(pool, who.user.id, body.password, who.ip);
  await inTx(pool, async (conn) => {
    await resetFailedLogins(conn, who.user.id);
    const self = await lockSelf(conn, who.user.id);
    if (self.fullName === body.fullName) throw new ApiError(409, 'NO_CHANGE');
    await conn.execute('UPDATE users SET full_name = ? WHERE id = ?', [body.fullName, self.id]);
    await writeAudit(conn, {
      userId: self.id,
      action: 'DM_NAME_CHANGED',
      entity: 'users',
      entityId: self.id,
      oldValue: { full_name: self.fullName },
      newValue: { via: 'web', full_name: body.fullName },
      ip: who.ip,
    });
  });
}

function otpHash(secret: string, userId: number, purpose: OtpPurpose, code: string): string {
  return createHmac('sha256', secret).update(`${userId}:${purpose}:${code}`).digest('hex');
}

/**
 * "OTP भेजें": a new 6-digit code to the DM's saved email; every older unused code of this purpose
 * dies at once. Refused without an email (409 EMAIL_NOT_SET), without a mail service
 * (503 MAIL_NOT_CONFIGURED) and within 60 s of the last code (429 OTP_COOLDOWN).
 * The mail is sent before the commit: a failed send saves nothing (502 MAIL_FAILED).
 */
export async function sendOtp(
  pool: Pool,
  who: Actor,
  purpose: OtpPurpose,
  mailer: Mailer | null,
  secret: string,
): Promise<{ email: string; validMinutes: number }> {
  await inTx(pool, async (conn) => {
    const self = await lockSelf(conn, who.user.id);
    if (self.email === null) throw new ApiError(409, 'EMAIL_NOT_SET');
    if (mailer === null) throw new ApiError(503, 'MAIL_NOT_CONFIGURED');
    const [recent] = await conn.execute<RowDataPacket[]>(
      `SELECT ? - TIMESTAMPDIFF(SECOND, created_at, NOW(3)) AS wait
         FROM user_otp WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [OTP_RESEND_SECONDS, self.id],
    );
    const wait = Number(recent[0]?.wait ?? 0);
    if (wait > 0) throw new ApiError(429, 'OTP_COOLDOWN', { retryAfterSeconds: wait });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await conn.execute(
      'UPDATE user_otp SET used_at = NOW(3) WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
      [self.id, purpose],
    );
    await conn.execute(
      `INSERT INTO user_otp (user_id, purpose, code_hash, expires_at)
       VALUES (?, ?, ?, NOW(3) + INTERVAL ${OTP_VALID_MINUTES} MINUTE)`,
      [self.id, purpose, otpHash(secret, self.id, purpose, code)],
    );
    await writeAudit(conn, {
      userId: self.id,
      action: 'DM_OTP_SENT',
      entity: 'users',
      entityId: self.id,
      newValue: { purpose, email: maskEmail(self.email) },
      ip: who.ip,
    });
    const what = purpose === 'USERNAME' ? 'यूज़रनेम' : 'पासवर्ड';
    try {
      await mailer.send(
        self.email,
        `चूरू मतगणना पोर्टल: ${what} बदलने का OTP`,
        `आपका OTP: ${code}\n\nयह ${OTP_VALID_MINUTES} मिनट तक और केवल एक बार मान्य है। इसे किसी को न बताएँ।\n` +
          'यदि आपने यह अनुरोध नहीं किया है, तो तुरंत अपना पासवर्ड बदलें।',
      );
    } catch (err) {
      console.error('OTP mail failed:', err instanceof Error ? err.message : 'unknown error');
      throw new ApiError(502, 'MAIL_FAILED');
    }
  });
  const profile = await getProfile(pool, who.user.id);
  return { email: profile.email ?? '', validMinutes: OTP_VALID_MINUTES };
}

type OtpCheck = { ok: true } | { ok: false; error: ApiError };

/**
 * Checks the newest code of this purpose (row locked on conn). Wrong code: attempts + 1; at the 5th
 * wrong try the code dies. The caller must COMMIT even on failure so the count is kept.
 */
async function checkOtp(
  conn: PoolConnection,
  who: Actor,
  purpose: OtpPurpose,
  code: string,
  secret: string,
): Promise<OtpCheck> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, code_hash, attempts, used_at IS NOT NULL AS used, expires_at <= NOW(3) AS expired
       FROM user_otp WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [who.user.id, purpose],
  );
  const row = rows[0];
  const fail = (status: number, error: string, details = {}): OtpCheck => ({
    ok: false,
    error: new ApiError(status, error, details),
  });
  if (!row) return fail(400, 'OTP_NOT_SENT');
  const attempts = Number(row.attempts);
  if (Number(row.used) === 1) {
    return attempts >= OTP_MAX_ATTEMPTS ? fail(400, 'OTP_LOCKED') : fail(400, 'OTP_NOT_SENT');
  }
  if (Number(row.expired) === 1) return fail(400, 'OTP_EXPIRED');

  const expected = Buffer.from(String(row.code_hash), 'hex');
  const given = Buffer.from(otpHash(secret, who.user.id, purpose, code), 'hex');
  if (expected.length === given.length && timingSafeEqual(expected, given)) {
    await conn.execute('UPDATE user_otp SET used_at = NOW(3) WHERE id = ?', [row.id]);
    return { ok: true };
  }
  const tries = attempts + 1;
  const dead = tries >= OTP_MAX_ATTEMPTS;
  await conn.execute(
    `UPDATE user_otp SET attempts = ?${dead ? ', used_at = NOW(3)' : ''} WHERE id = ?`,
    [tries, row.id],
  );
  await writeAudit(conn, {
    userId: who.user.id,
    action: 'DM_OTP_FAILED',
    entity: 'users',
    entityId: who.user.id,
    newValue: { purpose, attempts: tries, locked: dead },
    ip: who.ip,
  });
  return dead
    ? fail(400, 'OTP_LOCKED')
    : fail(400, 'OTP_INVALID', { attemptsLeft: OTP_MAX_ATTEMPTS - tries });
}

/**
 * Current password (counts toward the normal lockout), then ONE transaction: OTP check, change,
 * audit. A wrong OTP commits only its attempt count and audit row, then fails.
 */
async function withOtp(
  pool: Pool,
  who: Actor,
  purpose: OtpPurpose,
  body: { otp: string; password: string },
  secret: string,
  change: (conn: PoolConnection, self: Awaited<ReturnType<typeof lockSelf>>) => Promise<void>,
): Promise<void> {
  await requireReauth(pool, who.user.id, body.password, who.ip);
  const failed = await inTx(pool, async (conn) => {
    await resetFailedLogins(conn, who.user.id);
    const self = await lockSelf(conn, who.user.id);
    const check = await checkOtp(conn, who, purpose, body.otp, secret);
    if (!check.ok) return check.error;
    await change(conn, self);
    return null;
  });
  if (failed !== null) throw failed;
}

/** "यूज़रनेम बदलें": rules and NO_CHANGE first (nothing written, no OTP used), then withOtp. */
export async function changeUsername(
  pool: Pool,
  who: Actor,
  body: { newUsername: string; otp: string; password: string },
  secret: string,
): Promise<void> {
  if (!USERNAME_PATTERN.test(body.newUsername)) throw new ApiError(400, 'USERNAME_INVALID');
  if (body.newUsername === who.user.username) throw new ApiError(409, 'NO_CHANGE');
  await withOtp(pool, who, 'USERNAME', body, secret, async (conn, self) => {
    const [taken] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? AND id <> ?',
      [body.newUsername, self.id],
    );
    if (taken.length > 0) throw new ApiError(409, 'USERNAME_TAKEN');
    await conn.execute('UPDATE users SET username = ? WHERE id = ?', [body.newUsername, self.id]);
    await writeAudit(conn, {
      userId: self.id,
      action: 'DM_USERNAME_CHANGED',
      entity: 'users',
      entityId: self.id,
      oldValue: { username: self.username },
      newValue: { via: 'web', username: body.newUsername, otp_verified: true },
      ip: who.ip,
    });
  });
}

/**
 * "पासवर्ड बदलें": the usual password rules, bcrypt cost 12, never an encrypted copy for the DM.
 * Every other session of the DM ends; the current one stays.
 */
export async function changePassword(
  pool: Pool,
  who: Actor,
  body: { otp: string; password: string; newPassword: string; confirmPassword: string },
  secret: string,
  currentSessionId: string,
): Promise<void> {
  const problem = checkChosenPassword(body.newPassword, body.confirmPassword, who.user.username)[0];
  if (problem !== undefined) throw new ApiError(400, problem);
  const hash = await hashPassword(body.newPassword);
  await withOtp(pool, who, 'PASSWORD', body, secret, async (conn, self) => {
    await conn.execute(
      `UPDATE users SET password_hash = ?, password_enc = NULL, failed_login_count = 0,
         locked_until = NULL WHERE id = ?`,
      [hash, self.id],
    );
    const [ended] = await conn.execute<ResultSetHeader>(
      `DELETE FROM sessions WHERE session_id <> ? AND JSON_VALID(data)
         AND JSON_EXTRACT(data, '$.userId') = ?`,
      [currentSessionId, self.id],
    );
    await writeAudit(conn, {
      userId: self.id,
      action: 'DM_PASSWORD_CHANGED',
      entity: 'users',
      entityId: self.id,
      newValue: {
        via: 'web',
        username: self.username,
        otp_verified: true,
        other_sessions_ended: ended.affectedRows,
      },
      ip: who.ip,
    });
  });
}
