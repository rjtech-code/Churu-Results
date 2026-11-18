// Test helpers for the screen access keys. Keys are created with the real service and unlocked
// through the real POST /api/screen-auth/unlock (no shortcut into the session table).
import express from 'express';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { createScreenKey } from '../../src/modules/screen-access/screen-keys.service.js';
import type { ScreenKeyRow } from '../../src/modules/screen-access/screen-keys.service.js';
import { screenCookieName } from '../../src/modules/screen-access/screen-access.js';
import type { ScreenNumber } from '../../src/services/setup/screen-power.js';
import { screenKeyHashSecret } from '../../src/services/screen-key.js';
import { TEST_ORIGIN, TEST_RO_PASSWORD_KEY, createUser } from '../auth/helpers.js';

export const TEST_SECRETS = {
  vaultKey: TEST_RO_PASSWORD_KEY,
  hashSecret: screenKeyHashSecret(TEST_RO_PASSWORD_KEY),
};

let saCounter = 0;

/**
 * The active SUPER_ADMIN account (there is only ever one: active_slot), created when the test world
 * has none. Since Nov 2026 the screen keys are the Super Admin's, so this is who makes them.
 */
export async function createSuperAdmin(
  pool: Pool,
  password = 'Super-Admin-Pass-1',
): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1",
  );
  if (rows[0] !== undefined) return Number(rows[0].id);
  saCounter += 1;
  return createUser(pool, {
    username: `screen_sa_${String(process.pid)}_${String(saCounter)}`,
    role: 'SUPER_ADMIN',
    password,
  });
}

/** A key made by the real service (as if the Super Admin pressed "Key बनाएँ"). */
export async function createKeyDirect(
  pool: Pool,
  userId: number,
  input: { label?: string; expiresAt?: string | null } = {},
): Promise<ScreenKeyRow & { key: string }> {
  const row = await createScreenKey(
    pool,
    {
      user: {
        id: userId,
        username: 'super_admin',
        fullName: null,
        role: 'SUPER_ADMIN',
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

/**
 * POST /api/screen-auth/unlock as the TV's popup does (own Origin, JSON). `screen` is required by
 * the server now, so it is a plain argument; pass it through `extra` to test a bad one.
 */
export function unlock(
  app: Express,
  key: unknown,
  screen: ScreenNumber | null = '1',
  extra: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = { key, ...(screen === null ? {} : { screen }), ...extra };
  return request(app).post('/api/screen-auth/unlock').set('Origin', TEST_ORIGIN).send(body);
}

/** "churu.screen2=<token>" from a response, if it set that screen's cookie. */
export function screenCookieOf(res: Response, screen: ScreenNumber = '1'): string | undefined {
  const header: unknown = res.headers['set-cookie'];
  const list = Array.isArray(header) ? (header as string[]) : [];
  return list.find((c) => c.startsWith(`${screenCookieName(screen)}=`))?.split(';')[0];
}

/** Unlocks ONE screen with `key` and returns that screen's cookie (throws when refused). */
export async function unlockCookie(
  app: Express,
  key: string,
  screen: ScreenNumber = '1',
): Promise<string> {
  const res = await unlock(app, key, screen);
  const cookie = screenCookieOf(res, screen);
  if (res.status !== 200 || cookie === undefined) throw new Error(`unlock failed: ${res.status}`);
  return cookie;
}

/** Unlocks all three screens with the same key: three sessions, one per screen. */
export async function unlockAllCookies(app: Express, key: string): Promise<string> {
  const cookies: string[] = [];
  for (const screen of ['1', '2', '3'] as const) cookies.push(await unlockCookie(app, key, screen));
  return cookies.join('; ');
}

/**
 * Test-only wrapper: every request to `app` also carries `cookie` (added to any Cookie header the
 * test sets itself). Lets the older public-screen tests keep their assertions unchanged while the
 * real app still requires a screen session per screen. The production app has no bypass of any kind.
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
