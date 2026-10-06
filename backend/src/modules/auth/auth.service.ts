import bcrypt from 'bcrypt';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { writeAudit } from '../../services/audit.js';
import { loadActiveUser } from '../../services/users.js';
import type { AuthUser } from '../../types/auth.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/**
 * bcrypt (cost 12) hash of a random value nobody knows. Compared against when the username does
 * not exist, so an unknown username takes as long as a wrong password.
 */
const DUMMY_HASH = '$2b$12$xv0W7HE.6/YoV.2l95lawOvMKW6a/DA2tliMojo4k3Z3xckrfQCji';

export type LoginOutcome =
  | { kind: 'success'; user: AuthUser }
  | { kind: 'invalid' }
  | { kind: 'locked'; retryAfterSeconds: number };

interface LoginRow extends RowDataPacket {
  id: number;
  password_hash: string;
  is_active: number;
  failed_login_count: number;
  /** A SQL boolean expression: the pool returns it as a BIGINT string, so always use Number(). */
  is_locked: string | number;
  retry_after: string | number | null;
}

// Lock state is evaluated in database time (NOW(3)) so app and DB clocks cannot disagree.
const LOGIN_COLUMNS = `id, password_hash, is_active, failed_login_count,
  (locked_until IS NOT NULL AND locked_until > NOW(3)) AS is_locked,
  CEIL(TIMESTAMPDIFF(MICROSECOND, NOW(3), locked_until) / 1000000) AS retry_after`;

/** Attempted usernames are logged truncated, never the password. */
function attempted(username: string): string {
  return username.slice(0, 30);
}

/**
 * Checks a username/password. Same "invalid" outcome for unknown user, wrong password and
 * disabled user. While an account is locked the password is NOT checked at all.
 * Counter, lockout and audit rows are written in one transaction.
 */
export async function attemptLogin(
  pool: Pool,
  username: string,
  password: string,
  ip: string | null,
): Promise<LoginOutcome> {
  const [rows] = await pool.execute<LoginRow[]>(
    `SELECT ${LOGIN_COLUMNS} FROM users WHERE username = ?`,
    [username],
  );
  const found = rows[0];

  if (!found) {
    await bcrypt.compare(password, DUMMY_HASH);
    await writeAudit(pool, {
      userId: null,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: null,
      newValue: { username: attempted(username), note: 'unknown user' },
      ip,
    });
    return { kind: 'invalid' };
  }

  if (found.is_active !== 1) {
    await bcrypt.compare(password, found.password_hash);
    await writeAudit(pool, {
      userId: found.id,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: found.id,
      newValue: { username: attempted(username), note: 'disabled' },
      ip,
    });
    return { kind: 'invalid' };
  }

  const lockedOutcome = async (row: LoginRow): Promise<LoginOutcome> => {
    await writeAudit(pool, {
      userId: row.id,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: row.id,
      newValue: { username: attempted(username), note: 'locked' },
      ip,
    });
    return { kind: 'locked', retryAfterSeconds: Math.max(1, Number(row.retry_after ?? 1)) };
  };

  if (Number(found.is_locked) === 1) return lockedOutcome(found);

  const passwordOk = await bcrypt.compare(password, found.password_hash);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Re-read under a row lock so concurrent attempts cannot lose a failed-login count.
    const [lockedRows] = await conn.execute<LoginRow[]>(
      `SELECT ${LOGIN_COLUMNS} FROM users WHERE id = ? FOR UPDATE`,
      [found.id],
    );
    const row = lockedRows[0];
    if (!row) throw new Error('user vanished during login');
    if (Number(row.is_locked) === 1) {
      await conn.rollback();
      return await lockedOutcome(row);
    }

    if (!passwordOk) {
      const failures = row.failed_login_count + 1;
      const lockNow = failures >= MAX_FAILED_LOGINS;
      await conn.execute(
        lockNow
          ? `UPDATE users SET failed_login_count = 0, locked_until = NOW(3) + INTERVAL ${LOCK_MINUTES} MINUTE WHERE id = ?`
          : 'UPDATE users SET failed_login_count = ? WHERE id = ?',
        lockNow ? [row.id] : [failures, row.id],
      );
      await writeAudit(conn, {
        userId: row.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: row.id,
        newValue: { username: attempted(username), note: 'wrong password', failed_count: failures },
        ip,
      });
      if (lockNow) {
        await writeAudit(conn, {
          userId: row.id,
          action: 'ACCOUNT_LOCKED',
          entity: 'users',
          entityId: row.id,
          newValue: {
            username: attempted(username),
            failed_count: failures,
            lock_minutes: LOCK_MINUTES,
          },
          ip,
        });
      }
      await conn.commit();
      return { kind: 'invalid' };
    }

    await conn.execute(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?',
      [row.id],
    );
    const user = await loadActiveUser(conn, row.id);
    if (!user) throw new Error('user not active after login');
    await writeAudit(conn, {
      userId: row.id,
      action: 'LOGIN_SUCCESS',
      entity: 'users',
      entityId: row.id,
      newValue: { username: user.username, role: user.role },
      ip,
    });
    await conn.commit();
    return { kind: 'success', user };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
