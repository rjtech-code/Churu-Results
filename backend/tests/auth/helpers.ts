import bcrypt from 'bcrypt';
import type { Router } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../../src/app.js';
import { API_RATE_LIMIT, LOGIN_RATE_LIMIT } from '../../src/config/app-config.js';
import type { AppConfig } from '../../src/config/app-config.js';
import type { Role } from '../../src/types/auth.js';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Real production defaults except where a test overrides them. */
export function testAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    production: false,
    sessionSecret: 'test-session-secret-that-is-long-enough-1234',
    appOrigin: TEST_ORIGIN,
    sessionIdleMs: 30 * 60_000,
    sessionAbsoluteMs: 14 * 3_600_000,
    trustProxy: false,
    loginRateLimit: LOGIN_RATE_LIMIT,
    apiRateLimit: API_RATE_LIMIT,
    ...overrides,
  };
}

/** A fresh app (fresh in-memory rate limits) on the test database. */
export function buildApp(
  pool: Pool,
  overrides: Partial<AppConfig> = {},
  routes: { path: string; router: Router }[] = [],
) {
  return createApp({ pool, config: testAppConfig(overrides), routes });
}

export type Agent = ReturnType<typeof request.agent>;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function seedTwoPs(pool: Pool): Promise<{ ps1: number; ps2: number }> {
  const [d] = await pool.execute<ResultSetHeader>(
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
  );
  const ids: number[] = [];
  for (const [en, hi] of [
    ['CHURU PANCHAYAT SAMITI', 'पंचायत समिति चूरू'],
    ['RAJGARH PANCHAYAT SAMITI', 'पंचायत समिति राजगढ़'],
  ] as const) {
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
      [d.insertId, en, hi],
    );
    ids.push(r.insertId);
  }
  return { ps1: ids[0] ?? 0, ps2: ids[1] ?? 0 };
}

/** Inserts a user directly (bcrypt cost 4 keeps tests fast; login only compares). */
export async function createUser(
  pool: Pool,
  u: { username: string; role: Role; psId?: number | null; password: string; active?: boolean },
): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO users (username, full_name, password_hash, role, panchayat_samiti_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      u.username,
      `Full ${u.username}`,
      await bcrypt.hash(u.password, 4),
      u.role,
      u.psId ?? null,
      u.active === false ? 0 : 1,
    ],
  );
  return r.insertId;
}

export async function csrfToken(agent: Agent): Promise<string> {
  const res = await agent.get('/api/auth/csrf');
  const token: unknown = (res.body as { csrfToken?: unknown }).csrfToken;
  if (res.status !== 200 || typeof token !== 'string')
    throw new Error(`csrf failed: ${res.status}`);
  return token;
}

/** Fetches a CSRF token, then logs in (like a real client). */
export async function login(agent: Agent, username: string, password: string): Promise<Response> {
  const token = await csrfToken(agent);
  return agent.post('/api/auth/login').set('X-CSRF-Token', token).send({ username, password });
}

export async function logout(agent: Agent): Promise<Response> {
  const token = await csrfToken(agent);
  return agent.post('/api/auth/logout').set('X-CSRF-Token', token).send();
}

/** The raw churu.sid Set-Cookie header of a response, if any. */
export function sessionSetCookie(res: Response): string | undefined {
  const header: unknown = res.headers['set-cookie'];
  const list = Array.isArray(header) ? (header as string[]) : [];
  return list.find((c) => c.startsWith('churu.sid='));
}

/** The session id inside a churu.sid cookie ("s:<id>.<signature>", URL-encoded). */
export function sessionIdFrom(res: Response): string | undefined {
  const cookie = sessionSetCookie(res);
  if (cookie === undefined) return undefined;
  const value = decodeURIComponent(cookie.slice('churu.sid='.length).split(';')[0] ?? '');
  return value.startsWith('s:') ? value.slice(2).split('.')[0] : undefined;
}
