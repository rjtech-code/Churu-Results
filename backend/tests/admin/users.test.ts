import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { login } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildAdminWorld(pool);
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

interface Credentials {
  username: string;
  password: string;
}

async function user(id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT username, full_name, role, panchayat_samiti_id, is_active, password_hash, failed_login_count, locked_until FROM users WHERE id = ?',
    [id],
  );
  return rows[0];
}
async function userByName(username: string) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  return Number(rows[0]?.id);
}
const loginStatus = async (username: string, password: string) =>
  (await login(request.agent(app), username, password)).status;

/** The whole audit log as text: a new password must never appear in it. */
async function auditText(): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM audit_log');
  return JSON.stringify(rows);
}

describe('DM RO management', () => {
  it('lists the 13 PS seats (here 2) and the ZP seat', async () => {
    const res = await dm.get('/api/admin/users');
    const seats = (res.body as { seats: { seat: string; account: { username: string } | null }[] })
      .seats;
    expect(seats.map((s) => s.seat).sort()).toEqual([`PS:${w.ps1}`, `PS:${w.ps2}`, 'ZP'].sort());
    expect(seats.find((s) => s.seat === 'ZP')?.account?.username).toBe('zp_ro_x3');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('create: only for an empty seat; the password is shown once, never stored or cached', async () => {
    const taken = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps1}`,
      fullName: 'नया अधिकारी',
      password: PASSWORD,
    });
    expect([taken.status, taken.body]).toEqual([409, { error: 'SEAT_TAKEN' }]);

    // Make the PS2 seat empty (that RO never logged in, so it has no audit rows yet).
    await pool.execute('DELETE FROM users WHERE id = ?', [w.users.ro2]);

    const logs = vi.spyOn(console, 'log');
    const errors = vi.spyOn(console, 'error');
    const res = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps2}`,
      fullName: '  नया   अधिकारी ',
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = res.body as Credentials;
    expect(out.username).toMatch(/^ro_raj_[a-z2-9]{4}$/);
    expect(out.password).toMatch(/^[A-Za-z2-9]{16}$/);
    const id = await userByName(out.username);
    const row = await user(id);
    expect(row).toMatchObject({
      full_name: 'नया अधिकारी',
      role: 'PS_RO',
      panchayat_samiti_id: w.ps2,
      is_active: 1,
    });
    expect(String(row?.password_hash)).toMatch(/^\$2b\$12\$/);
    expect(await auditText()).not.toContain(out.password);
    for (const spy of [logs, errors])
      expect(JSON.stringify(spy.mock.calls)).not.toContain(out.password);
    expect(await loginStatus(out.username, out.password)).toBe(200);
    logs.mockRestore();
    errors.mockRestore();
  });

  it('replace: old account disabled and logged out, new account works, audit has no password', async () => {
    const old = await apiClient(app, 'ro_ps1_x1');
    expect((await old.get('/api/candidates/wards')).status).toBe(200);

    const res = await dm.post(`/api/admin/users/${w.users.ro1}/replace`, {
      fullName: 'नए RO',
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = res.body as Credentials;
    expect(out.username).toMatch(/^ro_chu_[a-z2-9]{4}$/);
    expect((await user(w.users.ro1))?.is_active).toBe(0);
    expect((await old.get('/api/candidates/wards')).status).toBe(401);
    expect(await loginStatus('ro_ps1_x1', PASSWORD)).toBe(401);
    expect(await loginStatus(out.username, out.password)).toBe(200);
    const [audit] = await auditOf(pool, 'USER_REPLACE');
    expect(audit?.old_value).toMatchObject({ id: w.users.ro1, username: 'ro_ps1_x1' });
    expect(audit?.new_value).toMatchObject({ username: out.username, old_account_disabled: true });
    expect(await auditText()).not.toContain(out.password);

    // The old account can't be enabled again while the seat has an active account.
    const enable = await dm.post(`/api/admin/users/${w.users.ro1}/enable`, { password: PASSWORD });
    expect([enable.status, enable.body]).toEqual([409, { error: 'SEAT_TAKEN' }]);
    // Plain create stays strict for that seat.
    const create = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps1}`,
      fullName: 'तीसरा',
      password: PASSWORD,
    });
    expect(create.body).toEqual({ error: 'SEAT_TAKEN' });
  });

  it('reset password: new password works, old does not, sessions end, lockout cleared', async () => {
    await pool.execute(
      'UPDATE users SET failed_login_count = 3, locked_until = NOW(3) + INTERVAL 10 MINUTE WHERE id = ?',
      [w.users.zp],
    );
    const res = await dm.post(`/api/admin/users/${w.users.zp}/reset-password`, {
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = res.body as Credentials;
    expect(out.username).toBe('zp_ro_x3');
    expect(await user(w.users.zp)).toMatchObject({ failed_login_count: 0, locked_until: null });
    expect(await loginStatus('zp_ro_x3', PASSWORD)).toBe(401);
    expect(await loginStatus('zp_ro_x3', out.password)).toBe(200);
    expect(await auditText()).not.toContain(out.password);
  });

  it('a running session of the RO ends on password reset', async () => {
    const ro = await apiClient(app, 'ro_ps2_x2');
    expect((await ro.get('/api/candidates/wards')).status).toBe(200);
    await dm.post(`/api/admin/users/${w.users.ro2}/reset-password`, { password: PASSWORD });
    expect((await ro.get('/api/candidates/wards')).status).toBe(401);
  });

  it('disable / enable / unlock, each audited; the DM account is never managed here', async () => {
    const off = await dm.post(`/api/admin/users/${w.users.ro2}/disable`, { password: PASSWORD });
    expect(off.status).toBe(200);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(401);
    expect(
      (await dm.post(`/api/admin/users/${w.users.ro2}/disable`, { password: PASSWORD })).body,
    ).toEqual({
      error: 'NO_CHANGE',
    });
    expect(
      (await dm.post(`/api/admin/users/${w.users.ro2}/enable`, { password: PASSWORD })).status,
    ).toBe(200);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(200);

    await pool.execute(
      'UPDATE users SET failed_login_count = 0, locked_until = NOW(3) + INTERVAL 10 MINUTE WHERE id = ?',
      [w.users.ro2],
    );
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(423);
    expect(
      (await dm.post(`/api/admin/users/${w.users.ro2}/unlock`, { password: PASSWORD })).status,
    ).toBe(200);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(200);
    expect(
      (await dm.post(`/api/admin/users/${w.users.ro2}/unlock`, { password: PASSWORD })).body,
    ).toEqual({
      error: 'NO_CHANGE',
    });

    for (const action of ['USER_DISABLE', 'USER_ENABLE', 'USER_UNLOCKED'])
      expect((await auditOf(pool, action)).length).toBe(1);

    for (const path of ['disable', 'reset-password', 'unlock']) {
      const res = await dm.post(`/api/admin/users/${w.users.dm}/${path}`, { password: PASSWORD });
      expect([path, res.status]).toEqual([path, 403]);
    }
    const replaceDm = await dm.post(`/api/admin/users/${w.users.dm}/replace`, {
      fullName: 'नया DM',
      password: PASSWORD,
    });
    expect(replaceDm.status).toBe(403);
  });

  it('wrong password: REAUTH_FAILED and nothing written', async () => {
    const before = JSON.parse(await masterSnapshot(pool)) as unknown[][];
    for (const [path, body] of [
      [`/api/admin/users/${w.users.ro1}/replace`, { fullName: 'कोई', password: 'bad' }],
      [`/api/admin/users/${w.users.ro1}/reset-password`, { password: 'bad' }],
      [`/api/admin/users/${w.users.ro1}/disable`, { password: 'bad' }],
    ] as const) {
      const res = await dm.post(path, body);
      expect([path, res.body]).toEqual([path, { error: 'REAUTH_FAILED' }]);
    }
    const after = JSON.parse(await masterSnapshot(pool)) as unknown[][];
    // Only the DM's own failed-login counter moved.
    const strip = (users: unknown[]) =>
      (users as { id: number; failed_login_count: number }[]).map((u) =>
        u.id === w.users.dm ? { ...u, failed_login_count: 0 } : u,
      );
    expect(strip(after[4] ?? [])).toEqual(strip(before[4] ?? []));
    expect((await auditOf(pool, 'USER_REPLACE')).length).toBe(0);
  });
});
