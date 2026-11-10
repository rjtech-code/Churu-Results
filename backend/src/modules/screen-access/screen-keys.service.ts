// Screen access keys and screen sessions (DB side). Pure key rules: services/screen-key.ts.
//
// Rules:
// - Only the DM creates, lists, revokes and renews keys (routes: requireRole('DM')).
// - A typed key is compared in constant time against EVERY non-revoked key (no early exit); an
//   unknown, revoked or expired key all give the same answer.
// - A revoke wipes the encrypted copy, deletes the key's screen sessions and (in the route) closes
//   their live streams, in one transaction with its audit row.
// - The plain key never goes to the audit log, the server log or any response except the DM list.
import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { decryptPassword, encryptPassword } from '../../services/master-data/password-vault.js';
import {
  formatScreenKey,
  generateScreenKey,
  hashScreenKey,
  hashesEqual,
  newSessionToken,
  normalizeScreenKey,
} from '../../services/screen-key.js';
import type { Actor } from '../admin/http.js';

export type ScreenKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

/** A screen session counts as "on screen now" when it was seen this recently. */
export const ACTIVE_SCREEN_WINDOW_MINUTES = 5;

export interface ScreenKeyRow {
  id: number;
  label: string;
  /** The key (XXXX-XXXX-XXXX) for an ACTIVE key only, else null. DM list only. */
  key: string | null;
  status: ScreenKeyStatus;
  createdAt: Date;
  createdByName: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** Screen sessions of this key seen in the last ACTIVE_SCREEN_WINDOW_MINUTES minutes. */
  activeScreens: number;
}

export interface KeySecrets {
  /** AES key of the vault (RO_PASSWORD_KEY): encrypts the DM's copy. */
  vaultKey: Buffer;
  /** HMAC secret for key hashes (screenKeyHashSecret(vaultKey)). */
  hashSecret: Buffer;
}

const STATUS_SQL = `CASE WHEN k.revoked_at IS NOT NULL THEN 'REVOKED'
       WHEN k.expires_at IS NOT NULL AND k.expires_at <= NOW(3) THEN 'EXPIRED'
       ELSE 'ACTIVE' END`;

const KEY_SELECT = `
  SELECT k.id, k.label, k.key_enc, k.created_at, k.expires_at, k.last_used_at, k.revoked_at,
         COALESCE(u.full_name, u.username) AS created_by_name,
         ${STATUS_SQL} AS status,
         (SELECT COUNT(*) FROM screen_session s
           WHERE s.screen_key_id = k.id AND s.expires_at > NOW(3)
             AND s.last_seen_at > NOW(3) - INTERVAL ${String(ACTIVE_SCREEN_WINDOW_MINUTES)} MINUTE
         ) AS active_screens
    FROM screen_key k
    JOIN users u ON u.id = k.created_by`;

function toRow(r: RowDataPacket, vaultKey: Buffer): ScreenKeyRow {
  const status = String(r.status) as ScreenKeyStatus;
  let key: string | null = null;
  if (status === 'ACTIVE' && Buffer.isBuffer(r.key_enc)) {
    try {
      key = decryptPassword(r.key_enc, vaultKey);
    } catch {
      key = null; // wrong RO_PASSWORD_KEY: the key still works, it just cannot be shown again
    }
  }
  return {
    id: Number(r.id),
    label: String(r.label),
    key,
    status,
    createdAt: r.created_at as Date,
    createdByName: String(r.created_by_name),
    expiresAt: (r.expires_at as Date | null) ?? null,
    lastUsedAt: (r.last_used_at as Date | null) ?? null,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    activeScreens: Number(r.active_screens),
  };
}

/** Every key, active ones first, newest first. */
export async function listScreenKeys(pool: Pool, vaultKey: Buffer): Promise<ScreenKeyRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${KEY_SELECT} ORDER BY (k.revoked_at IS NULL) DESC, k.id DESC`,
  );
  return rows.map((r) => toRow(r, vaultKey));
}

async function loadKey(conn: PoolConnection, id: number, vaultKey: Buffer): Promise<ScreenKeyRow> {
  const [rows] = await conn.execute<RowDataPacket[]>(`${KEY_SELECT} WHERE k.id = ?`, [id]);
  const row = rows[0];
  if (row === undefined) throw new Error('screen key vanished');
  return toRow(row, vaultKey);
}

async function inTransaction<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await work(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** "YYYY-MM-DDTHH:MM" (IST, from the form) -> "YYYY-MM-DD HH:MM:00" for the IST DB session. */
export function expiryForDb(expiresAt: string | null): string | null {
  return expiresAt === null ? null : `${expiresAt.replace('T', ' ')}:00`;
}

/** Longest expiry the form allows. */
export const MAX_EXPIRY_DAYS = 90;

async function insertKey(
  conn: PoolConnection,
  who: Actor,
  label: string,
  expiresAt: string | null,
  secrets: KeySecrets,
): Promise<number> {
  const key = generateScreenKey();
  const canonical = normalizeScreenKey(key);
  if (canonical === null) throw new Error('generated screen key is not valid');
  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO screen_key (label, key_hash, key_enc, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      label,
      hashScreenKey(canonical, secrets.hashSecret),
      encryptPassword(formatScreenKey(canonical), secrets.vaultKey),
      expiresAt,
      who.user.id,
    ],
  );
  return r.insertId;
}

async function checkExpiry(conn: PoolConnection, expiresAt: string | null): Promise<void> {
  if (expiresAt === null) return;
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT CAST(? AS DATETIME(3)) > NOW(3) + INTERVAL 5 MINUTE AS future,
            CAST(? AS DATETIME(3)) <= NOW(3) + INTERVAL ${String(MAX_EXPIRY_DAYS)} DAY AS near`,
    [expiresAt, expiresAt],
  );
  if (Number(rows[0]?.future) !== 1) throw new ApiError(400, 'EXPIRY_NOT_IN_FUTURE');
  if (Number(rows[0]?.near) !== 1) throw new ApiError(400, 'EXPIRY_TOO_FAR');
}

/** New key (one transaction with its audit row). `expiresAt`: "YYYY-MM-DDTHH:MM" IST or null. */
export async function createScreenKey(
  pool: Pool,
  who: Actor,
  input: { label: string; expiresAt: string | null },
  secrets: KeySecrets,
): Promise<ScreenKeyRow> {
  const expiresAt = expiryForDb(input.expiresAt);
  return inTransaction(pool, async (conn) => {
    await checkExpiry(conn, expiresAt);
    const id = await insertKey(conn, who, input.label, expiresAt, secrets);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'SCREEN_KEY_CREATED',
      entity: 'screen_key',
      entityId: id,
      newValue: { label: input.label, expiresAt },
      ip: who.ip,
    });
    return loadKey(conn, id, secrets.vaultKey);
  });
}

interface LockedKey {
  id: number;
  label: string;
  revoked: boolean;
  expiresAt: string | null;
  expiryInFuture: boolean;
}

async function lockKey(conn: PoolConnection, id: number): Promise<LockedKey> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, label, revoked_at IS NOT NULL AS revoked,
            DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
            (expires_at IS NOT NULL AND expires_at > NOW(3) + INTERVAL 5 MINUTE) AS expiry_in_future
       FROM screen_key WHERE id = ? FOR UPDATE`,
    [id],
  );
  const r = rows[0];
  if (r === undefined) throw new ApiError(404, 'NOT_FOUND');
  return {
    id: Number(r.id),
    label: String(r.label),
    revoked: Number(r.revoked) === 1,
    expiresAt: r.expires_at === null ? null : String(r.expires_at),
    expiryInFuture: Number(r.expiry_in_future) === 1,
  };
}

/** Marks the key revoked, wipes its copy, deletes its sessions, writes the audit row. */
async function revokeLocked(
  conn: PoolConnection,
  who: Actor,
  key: LockedKey,
  note: 'revoke' | 'renew',
): Promise<void> {
  await conn.execute(
    'UPDATE screen_key SET revoked_at = NOW(3), revoked_by = ?, key_enc = NULL WHERE id = ?',
    [who.user.id, key.id],
  );
  const [del] = await conn.execute<ResultSetHeader>(
    'DELETE FROM screen_session WHERE screen_key_id = ?',
    [key.id],
  );
  await writeAudit(conn, {
    userId: who.user.id,
    action: 'SCREEN_KEY_REVOKED',
    entity: 'screen_key',
    entityId: key.id,
    newValue: { label: key.label, sessionsEnded: del.affectedRows, via: note },
    ip: who.ip,
  });
}

/** "रद्द करें": instant. The route then closes the key's live streams. */
export async function revokeScreenKey(pool: Pool, who: Actor, id: number): Promise<void> {
  await inTransaction(pool, async (conn) => {
    const key = await lockKey(conn, id);
    if (key.revoked) throw new ApiError(409, 'ALREADY_REVOKED');
    await revokeLocked(conn, who, key, 'revoke');
  });
}

/**
 * "नई key बनाएँ": revokes the key (if not yet revoked) and creates a new one with the same label, in
 * ONE transaction. The expiry is kept when it is still ahead, else the new key has none.
 */
export async function renewScreenKey(
  pool: Pool,
  who: Actor,
  id: number,
  secrets: KeySecrets,
): Promise<ScreenKeyRow> {
  return inTransaction(pool, async (conn) => {
    const old = await lockKey(conn, id);
    if (!old.revoked) await revokeLocked(conn, who, old, 'renew');
    const expiresAt = old.expiryInFuture ? old.expiresAt : null;
    const newId = await insertKey(conn, who, old.label, expiresAt, secrets);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'SCREEN_KEY_CREATED',
      entity: 'screen_key',
      entityId: newId,
      newValue: { label: old.label, expiresAt, replacesKeyId: old.id },
      ip: who.ip,
    });
    return loadKey(conn, newId, secrets.vaultKey);
  });
}

export interface NewScreenSession {
  token: string;
  sessionId: number;
}

async function insertSession(
  conn: PoolConnection,
  owner: { keyId: number } | { previewUserId: number },
  maxAgeMs: number,
): Promise<NewScreenSession> {
  const token = newSessionToken();
  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO screen_session (token_hash, screen_key_id, preview_user_id, expires_at)
     VALUES (?, ?, ?, NOW(3) + INTERVAL ? SECOND)`,
    [
      createHash('sha256').update(token, 'utf8').digest(),
      'keyId' in owner ? owner.keyId : null,
      'previewUserId' in owner ? owner.previewUserId : null,
      Math.floor(maxAgeMs / 1000),
    ],
  );
  // Housekeeping: sessions that ended long ago are of no use to anyone.
  await conn.execute('DELETE FROM screen_session WHERE expires_at < NOW(3) - INTERVAL 1 DAY');
  return { token, sessionId: r.insertId };
}

/** A string that is never a canonical key, hashed when the input cannot be a key (same work). */
const NOT_A_KEY = '-';

/**
 * A typed key -> a new screen session, or null for a wrong key (unknown, revoked, expired or not a
 * key at all: the caller cannot tell them apart). The comparison runs over every non-revoked key.
 */
export async function unlockWithKey(
  pool: Pool,
  typed: string,
  meta: { ip: string | null; screen: string | null; maxAgeMs: number },
  hashSecret: Buffer,
): Promise<NewScreenSession | null> {
  const canonical = normalizeScreenKey(typed);
  const given = hashScreenKey(canonical ?? NOT_A_KEY, hashSecret);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, key_hash FROM screen_key WHERE revoked_at IS NULL',
  );
  let matchId: number | null = null;
  for (const r of rows) {
    // No early exit: the time taken does not depend on which key (if any) matched.
    if (hashesEqual(r.key_hash as Buffer, given) && canonical !== null) matchId = Number(r.id);
  }
  if (matchId === null) return null;
  const keyId = matchId;
  return inTransaction(pool, async (conn) => {
    // Re-checked under the row lock: a revoke or expiry in between wins.
    const [ok] = await conn.execute<RowDataPacket[]>(
      `SELECT label FROM screen_key
        WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(3))
        FOR UPDATE`,
      [keyId],
    );
    const key = ok[0];
    if (key === undefined) return null;
    const session = await insertSession(conn, { keyId }, meta.maxAgeMs);
    await conn.execute('UPDATE screen_key SET last_used_at = NOW(3) WHERE id = ?', [keyId]);
    await writeAudit(conn, {
      userId: null,
      action: 'SCREEN_UNLOCKED',
      entity: 'screen_key',
      entityId: keyId,
      newValue: { label: String(key.label), screen: meta.screen, sessionId: session.sessionId },
      ip: meta.ip,
    });
    return session;
  });
}

/** The DM's preview from the dashboard: a screen session without a key, tied to the DM account. */
export async function openPreviewSession(
  pool: Pool,
  who: Actor,
  maxAgeMs: number,
): Promise<NewScreenSession> {
  return inTransaction(pool, async (conn) => {
    const session = await insertSession(conn, { previewUserId: who.user.id }, maxAgeMs);
    await writeAudit(conn, {
      userId: who.user.id,
      action: 'SCREEN_PREVIEW_OPENED',
      entity: 'screen_session',
      entityId: session.sessionId,
      newValue: { hours: Math.round(maxAgeMs / 3_600_000) },
      ip: who.ip,
    });
    return session;
  });
}

/** One audit row when an IP is locked out of the key popup (not one per failed attempt). */
export async function auditUnlockLockout(
  pool: Pool,
  ip: string | null,
  info: { failures: number; windowMinutes: number },
): Promise<void> {
  await writeAudit(pool, {
    userId: null,
    action: 'SCREEN_UNLOCK_LOCKED_OUT',
    entity: 'screen_key',
    entityId: null,
    newValue: info,
    ip,
  });
}

/** Valid-session condition (key alive, or preview of an active DM), shared by both checks below. */
const LIVE_SESSION_SQL = `
  SELECT s.id, s.screen_key_id,
         UNIX_TIMESTAMP(LEAST(s.expires_at, COALESCE(k.expires_at, s.expires_at))) AS valid_until,
         s.last_seen_at < NOW(3) - INTERVAL 60 SECOND AS stale_seen
    FROM screen_session s
    LEFT JOIN screen_key k ON k.id = s.screen_key_id
    LEFT JOIN users u ON u.id = s.preview_user_id
   WHERE s.expires_at > NOW(3)
     AND ((s.screen_key_id IS NOT NULL AND k.revoked_at IS NULL
           AND (k.expires_at IS NULL OR k.expires_at > NOW(3)))
       OR (s.preview_user_id IS NOT NULL AND u.is_active = 1 AND u.role = 'DM'))`;

export interface LiveScreenSession {
  sessionId: number;
  keyId: number | null;
  /** Epoch ms. */
  validUntil: number;
}

/**
 * The live session of this token hash, or null. Marks it (and its key) as seen at most once a
 * minute, in one statement, so the TVs do not write on every request.
 */
export async function findLiveSession(
  pool: Pool,
  tokenHash: Buffer,
): Promise<LiveScreenSession | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`${LIVE_SESSION_SQL} AND s.token_hash = ?`, [
    tokenHash,
  ]);
  const r = rows[0];
  if (r === undefined) return null;
  const sessionId = Number(r.id);
  if (Number(r.stale_seen) === 1) {
    await pool.execute(
      `UPDATE screen_session s LEFT JOIN screen_key k ON k.id = s.screen_key_id
          SET s.last_seen_at = NOW(3), k.last_used_at = NOW(3)
        WHERE s.id = ?`,
      [sessionId],
    );
  }
  return {
    sessionId,
    keyId: r.screen_key_id === null ? null : Number(r.screen_key_id),
    validUntil: Math.floor(Number(r.valid_until) * 1000),
  };
}

/** Is this session still allowed to watch? (Re-check of open live-update streams.) */
export async function isSessionLive(pool: Pool, sessionId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(`${LIVE_SESSION_SQL} AND s.id = ?`, [
    sessionId,
  ]);
  return rows.length > 0;
}
