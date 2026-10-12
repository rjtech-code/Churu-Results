import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { csrfToken, login } from '../auth/helpers.js';
import type { Agent } from '../auth/helpers.js';
import { PASSWORD, buildWorld, countingApp } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';

export { PASSWORD };

/**
 * The counting test world plus master-data work in progress:
 *  ps1 "CHURU PANCHAYAT SAMITI": PS ward 5 (psW5, unlocked, no candidates, booth b7)
 *  ZP ward 2 (zW2, unlocked, no candidates; booth b7)
 *  parties P1 (भाजपा-like) and P2.
 * From the counting world: psW1 / psW2 / zW1 locked with candidates; psW4 unlocked with candidates.
 */
export interface AdminWorld extends World {
  psW5: number;
  zW2: number;
  b7: number;
  p1: number;
  p2: number;
}

export const PS1_NAME = 'CHURU PANCHAYAT SAMITI';

export async function buildAdminWorld(pool: Pool): Promise<AdminWorld> {
  const w = await buildWorld(pool);
  const ins = async (sql: string, params: (string | number | null)[]) => {
    const [r] = await pool.execute<ResultSetHeader>(sql, params);
    return r.insertId;
  };
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    ins(
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, w.ps1],
    );
  const psW5 = await ward('PS', w.ps1, 5);
  const zW2 = await ward('ZP', null, 2);
  const b7 = await ins(
    `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id,
                        registered_voters_male, registered_voters_female, registered_voters_total)
     VALUES (?, 7, 'बूथ सात', ?, ?, 400, 350, 760)`,
    [w.ps1, psW5, zW2],
  );
  const p1 = await ins(
    "INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES ('पार्टी एक', 'Party One', 'P1', 'Lamp')",
    [],
  );
  const p2 = await ins(
    "INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES ('पार्टी दो', 'Party Two', 'P2', 'Tree')",
    [],
  );
  return { ...w, psW5, zW2, b7, p1, p2 };
}

export function adminApp(pool: Pool): Express {
  return countingApp(pool);
}

/** A logged-in client for any path (full paths, e.g. /api/admin/users). */
export interface ApiClient {
  agent: Agent;
  token: string;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
}

export async function apiClient(
  app: Express,
  username: string,
  password = PASSWORD,
): Promise<ApiClient> {
  const agent = request.agent(app);
  const res = await login(agent, username, password);
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
  const token = await csrfToken(agent);
  return {
    agent,
    token,
    get: (path) => agent.get(path),
    post: (path, body = {}) =>
      agent
        .post(path)
        .set('X-CSRF-Token', token)
        .send(body as object),
    put: (path, body) =>
      agent
        .put(path)
        .set('X-CSRF-Token', token)
        .send(body as object),
  };
}

export type Value = string | number | null;

/** An .xlsx (base64) built in the test: one sheet, header row + rows. */
export async function xlsxBase64(headers: readonly string[], rows: readonly (readonly Value[])[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow([...headers]);
  for (const row of rows) sheet.addRow([...row]);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

export const PARTY_HEADERS = ['name_hindi', 'name_english', 'short_name', 'symbol'];
export const CANDIDATE_HEADERS = [
  'panchayat_samiti',
  'election',
  'ward_no',
  'ballot_position',
  'name_hindi',
  'party_short_name',
  'gender',
  'reservation_category',
];

export async function countRows(pool: Pool, sql: string, params: (string | number)[] = []) {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** A snapshot of everything master data may touch, to prove "nothing was written". */
export async function masterSnapshot(pool: Pool): Promise<string> {
  const parts: unknown[] = [];
  for (const sql of [
    'SELECT * FROM party ORDER BY id',
    'SELECT * FROM candidate ORDER BY id',
    'SELECT id, is_locked, is_unopposed, reservation_category, candidates_ready_at, candidates_ready_by, candidates_return_reason FROM ward ORDER BY id',
    'SELECT * FROM booth ORDER BY id',
    'SELECT id, username, full_name, password_hash, is_active, failed_login_count, locked_until FROM users ORDER BY id',
  ]) {
    const [rows] = await pool.query<RowDataPacket[]>(sql);
    parts.push(rows);
  }
  return JSON.stringify(parts);
}

/** Audit rows other than login/logout/re-auth bookkeeping. */
export async function dataAuditCount(pool: Pool): Promise<number> {
  return countRows(
    pool,
    "SELECT COUNT(*) AS n FROM audit_log WHERE action NOT IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REAUTH_FAILED', 'ACCOUNT_LOCKED')",
  );
}

export async function auditOf(pool: Pool, action: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT user_id, entity_id, old_value, new_value, reason FROM audit_log WHERE action = ? ORDER BY id',
    [action],
  );
  return rows;
}
