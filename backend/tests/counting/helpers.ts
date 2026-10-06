import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import type { AppConfig } from '../../src/config/app-config.js';
import { appEvents } from '../../src/services/events.js';
import { buildApp, createUser, csrfToken, login, seedTwoPs } from '../auth/helpers.js';
import type { Agent } from '../auth/helpers.js';

export const PASSWORD = 'Counting-Pass-1';

/**
 * A small district:
 *  ps1: PS ward 1 (psW1: booths b1, b2, b4[no voter count]); PS ward 3 (psW3: unopposed, booth b5);
 *       PS ward 4 (psW4: candidates but ballot NOT locked, booth b6)
 *  ps2: PS ward 1 (psW2: booth b3)
 *  ZP ward 1 (zW1) spans every booth of both PS.
 * Locked: psW1, psW2, psW3, zW1. Registered voters: 1000 per booth except b4 (NULL).
 */
export interface World {
  ps1: number;
  ps2: number;
  psW1: number;
  psW2: number;
  psW3: number;
  psW4: number;
  zW1: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  b6: number;
  /** candidates: psW1 A,B,N1 · psW2 C,D,N2 · zW1 E,F,N3 · psW3 U · psW4 G,H,N4 */
  c: Record<
    'A' | 'B' | 'N1' | 'C' | 'D' | 'N2' | 'E' | 'F' | 'N3' | 'U' | 'G' | 'H' | 'N4',
    number
  >;
  users: { ro1: number; ro2: number; zp: number; dm: number };
}

async function ins(pool: Pool, sql: string, params: (string | number | null)[]): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(sql, params);
  return r.insertId;
}

export async function buildWorld(pool: Pool): Promise<World> {
  const { ps1, ps2 } = await seedTwoPs(pool);
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    ins(
      pool,
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const psW1 = await ward('PS', ps1, 1);
  const psW2 = await ward('PS', ps2, 1);
  const psW3 = await ward('PS', ps1, 3);
  const psW4 = await ward('PS', ps1, 4);
  const zW1 = await ward('ZP', null, 1);
  const booth = (ps: number, no: number, pw: number, voters: number | null) =>
    ins(
      pool,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ps, no, `बूथ ${no}`, pw, zW1, voters],
    );
  const b1 = await booth(ps1, 1, psW1, 1000);
  const b2 = await booth(ps1, 2, psW1, 1000);
  const b3 = await booth(ps2, 1, psW2, 1000);
  const b4 = await booth(ps1, 4, psW1, null);
  const b5 = await booth(ps1, 5, psW3, 1000);
  const b6 = await booth(ps1, 6, psW4, 1000);
  const cand = (w: number, pos: number, name: string, nota = false) =>
    ins(
      pool,
      'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, ?, ?, ?, ?)',
      [w, pos, name, nota ? null : 'M', nota ? 1 : 0],
    );
  const c = {
    A: await cand(psW1, 1, 'ए'),
    B: await cand(psW1, 2, 'बी'),
    N1: await cand(psW1, 3, 'नोटा', true),
    C: await cand(psW2, 1, 'सी'),
    D: await cand(psW2, 2, 'डी'),
    N2: await cand(psW2, 3, 'नोटा', true),
    E: await cand(zW1, 1, 'ई'),
    F: await cand(zW1, 2, 'एफ'),
    N3: await cand(zW1, 3, 'नोटा', true),
    U: await cand(psW3, 1, 'यू'),
    G: await cand(psW4, 1, 'जी'),
    H: await cand(psW4, 2, 'एच'),
    N4: await cand(psW4, 3, 'नोटा', true),
  };
  await pool.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [psW3]);
  for (const w of [psW1, psW2, psW3, zW1]) {
    await pool.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE id = ?",
      [w],
    );
  }
  const users = {
    ro1: await createUser(pool, {
      username: 'ro_ps1_x1',
      role: 'PS_RO',
      psId: ps1,
      password: PASSWORD,
    }),
    ro2: await createUser(pool, {
      username: 'ro_ps2_x2',
      role: 'PS_RO',
      psId: ps2,
      password: PASSWORD,
    }),
    zp: await createUser(pool, { username: 'zp_ro_x3', role: 'ZP_RO', password: PASSWORD }),
    dm: await createUser(pool, { username: 'dm_x4', role: 'DM', password: PASSWORD }),
  };
  return { ps1, ps2, psW1, psW2, psW3, psW4, zW1, b1, b2, b3, b4, b5, b6, c, users };
}

/** A logged-in API client with a fresh CSRF token. */
export interface Client {
  agent: Agent;
  token: string;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
}

export async function clientFor(app: Express, username: string): Promise<Client> {
  const agent = request.agent(app);
  const res = await login(agent, username, PASSWORD);
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
  const token = await csrfToken(agent);
  return {
    agent,
    token,
    get: (path) => agent.get(`/api/counting${path}`),
    post: (path, body = {}) =>
      agent
        .post(`/api/counting${path}`)
        .set('X-CSRF-Token', token)
        .send(body as object),
    put: (path, body) =>
      agent
        .put(`/api/counting${path}`)
        .set('X-CSRF-Token', token)
        .send(body as object),
  };
}

export function countingApp(pool: Pool, overrides: Partial<AppConfig> = {}): Express {
  return buildApp(pool, overrides);
}

/** Vote rows in the API shape. */
export const v = (pairs: [number, number][]) =>
  pairs.map(([candidateId, votes]) => ({ candidateId, votes }));

/** A valid psW1 booth sheet: A=a, B=b, NOTA=n. */
export function psW1Sheet(w: World, boothId: number, a = 300, b = 200, n = 10, roundNo = 1) {
  return {
    wardId: w.psW1,
    boothId,
    ballotFor: 'PS' as const,
    roundNo,
    sheetTotal: a + b + n,
    votes: v([
      [w.c.A, a],
      [w.c.B, b],
      [w.c.N1, n],
    ]),
  };
}

/** A valid zW1 booth sheet. */
export function zW1Sheet(w: World, boothId: number, e = 100, f = 50, n = 5) {
  return {
    wardId: w.zW1,
    boothId,
    ballotFor: 'ZP' as const,
    roundNo: 1,
    sheetTotal: e + f + n,
    votes: v([
      [w.c.E, e],
      [w.c.F, f],
      [w.c.N3, n],
    ]),
  };
}

/** Collects 'ward-changed' events until stop() is called. */
export function captureEvents(): { events: { wardId: number }[]; stop: () => void } {
  const events: { wardId: number }[] = [];
  const listener = (e: { wardId: number }) => events.push(e);
  appEvents.on('ward-changed', listener);
  return { events, stop: () => appEvents.off('ward-changed', listener) };
}

export async function count(
  pool: Pool,
  sql: string,
  params: (string | number)[] = [],
): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n);
}

/** Row counts of every counting-related table (to prove "nothing written"). */
export async function tableCounts(pool: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [
    'booth_entry',
    'booth_entry_vote',
    'postal_entry',
    'postal_entry_vote',
    'voided_entry',
    'audit_log',
  ]) {
    out[t] = await count(pool, `SELECT COUNT(*) AS n FROM ${t}`);
  }
  return out;
}
