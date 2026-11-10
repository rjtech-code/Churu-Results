// Test helpers for the screen access keys. Keys are created with the real service and unlocked
// through the real POST /api/screen-auth/unlock (no shortcut into the session table).
import express from 'express';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { createScreenKey } from '../../src/modules/screen-access/screen-keys.service.js';
import type { ScreenKeyRow } from '../../src/modules/screen-access/screen-keys.service.js';
import { SCREEN_COOKIE } from '../../src/modules/screen-access/screen-access.js';
import { screenKeyHashSecret } from '../../src/services/screen-key.js';
import { TEST_ORIGIN, TEST_RO_PASSWORD_KEY, createUser } from '../auth/helpers.js';

export const TEST_SECRETS = {
  vaultKey: TEST_RO_PASSWORD_KEY,
  hashSecret: screenKeyHashSecret(TEST_RO_PASSWORD_KEY),
};

let dmCounter = 0;

/** The active DM account (there is only ever one), created when the test world has none. */
export async function createDm(pool: Pool, password = 'Dm-Password-123'): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'DM' AND is_active = 1",
  );
  if (rows[0] !== undefined) return Number(rows[0].id);
  dmCounter += 1;
  return createUser(pool, {
    username: `screen_dm_${String(process.pid)}_${String(dmCounter)}`,
    role: 'DM',
    password,
  });
}

/** A key made by the real service (as if the DM pressed "Key बनाएँ"). */
export async function createKeyDirect(
  pool: Pool,
  dmId: number,
  input: { label?: string; expiresAt?: string | null } = {},
): Promise<ScreenKeyRow & { key: string }> {
  const row = await createScreenKey(
    pool,
    {
      user: {
        id: dmId,
        username: 'dm',
        fullName: null,
        role: 'DM',
        panchayatSamitiId: null,
        panchayatSamitiName: null,
      },
      ip: '127.0.0.1',
    },
    { label: input.label ?? 'मुख्य हॉल TV', expiresAt: input.expiresAt ?? null },
    TEST_SECRETS,
  );
  if (row.key === null) throw new Error('new key has no copy');
  return { ...row, key: row.key };
}

/** POST /api/screen-auth/unlock as the TV's popup does (own Origin, JSON). */
export function unlock(app: Express, key: unknown, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/screen-auth/unlock')
    .set('Origin', TEST_ORIGIN)
    .send({ key, ...extra });
}

/** "churu.screen=<token>" from a response, if it set one. */
export function screenCookieOf(res: Response): string | undefined {
  const header: unknown = res.headers['set-cookie'];
  const list = Array.isArray(header) ? (header as string[]) : [];
  return list.find((c) => c.startsWith(`${SCREEN_COOKIE}=`))?.split(';')[0];
}

/** Unlocks with `key` and returns the cookie (throws when refused). */
export async function unlockCookie(app: Express, key: string): Promise<string> {
  const res = await unlock(app, key);
  const cookie = screenCookieOf(res);
  if (res.status !== 200 || cookie === undefined) throw new Error(`unlock failed: ${res.status}`);
  return cookie;
}

/**
 * Test-only wrapper: every request to `app` also carries `cookie` (added to any Cookie header the
 * test sets itself). Lets the older public-screen tests keep their assertions unchanged while the
 * real app still requires a screen session. The production app has no bypass of any kind.
 */
export function withCookie(app: Express, cookie: string): Express {
  const outer = express();
  outer.use((req, _res, next) => {
    const own = req.headers.cookie;
    req.headers.cookie = own === undefined || own === '' ? cookie : `${own}; ${cookie}`;
    next();
  });
  outer.use(app);
  return outer;
}
