import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dmWriteAllowed } from '../../src/middleware/auth.js';
import { checkChosenPassword, isWeakPassword } from '../../src/services/master-data/accounts.js';
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
      phone: '9876543210',
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
      phone: '9876543210',
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
      phone: '9876543210',
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
      phone: '9876543210',
      password: PASSWORD,
    });
    expect(create.body).toEqual({ error: 'SEAT_TAKEN' });
  });

  it('change password: new password works, old does not, sessions end, lockout cleared', async () => {
    await pool.execute(
      'UPDATE users SET failed_login_count = 3, locked_until = NOW(3) + INTERVAL 10 MINUTE WHERE id = ?',
      [w.users.zp],
    );
    const suggested = await dm.post('/api/admin/users/generate-password', {});
    expect(suggested.status).toBe(200);
    const generated = (suggested.body as { password: string }).password;
    expect(generated).toMatch(/^[A-Za-z2-9]{16}$/);
    const res = await dm.post(`/api/admin/users/${w.users.zp}/update-credentials`, {
      username: 'zp_ro_x3',
      newPassword: generated,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ username: 'zp_ro_x3', password: generated });
    expect(await user(w.users.zp)).toMatchObject({ failed_login_count: 0, locked_until: null });
    expect(await loginStatus('zp_ro_x3', PASSWORD)).toBe(401);
    expect(await loginStatus('zp_ro_x3', generated)).toBe(200);
    expect(await auditText()).not.toContain(generated);
  });

  it('a running session of the RO ends on a credentials change', async () => {
    const ro = await apiClient(app, 'ro_ps2_x2');
    expect((await ro.get('/api/candidates/wards')).status).toBe(200);
    await dm.post(`/api/admin/users/${w.users.ro2}/update-credentials`, {
      username: 'ro_ps2_x2',
      newPassword: 'Kesar7Tila9mor',
      password: PASSWORD,
    });
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

    for (const path of ['disable', 'view-password', 'update-credentials', 'unlock']) {
      const res = await dm.post(`/api/admin/users/${w.users.dm}/${path}`, {
        ...(path === 'update-credentials' ? { username: 'dm_renamed' } : {}),
        password: PASSWORD,
      });
      expect([path, res.status]).toEqual([path, 403]);
    }
    const replaceDm = await dm.post(`/api/admin/users/${w.users.dm}/replace`, {
      fullName: 'नया DM',
      phone: '9876543210',
      password: PASSWORD,
    });
    expect(replaceDm.status).toBe(403);
  });

  it('wrong password: REAUTH_FAILED and nothing written', async () => {
    const before = JSON.parse(await masterSnapshot(pool)) as unknown[][];
    for (const [path, body] of [
      [
        `/api/admin/users/${w.users.ro1}/replace`,
        { fullName: 'कोई', phone: '9876543210', password: 'bad' },
      ],
      [
        `/api/admin/users/${w.users.ro1}/update-credentials`,
        { username: 'ro_new_name', newPassword: 'Kesar7Tila9mor', password: 'bad' },
      ],
      [`/api/admin/users/${w.users.ro1}/view-password`, { password: 'bad' }],
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

describe('DM types an RO password in the one form', () => {
  const GOOD = 'Kesar7Tila9mor';
  const setPassword = (userId: number, body: Record<string, string>) =>
    dm.post(`/api/admin/users/${userId}/update-credentials`, {
      username: userId === w.users.ro2 ? 'ro_ps2_x2' : 'ro_other',
      ...body,
    });

  it('the chosen password works, the old one stops, sessions end, lockout cleared, audit without it', async () => {
    const ro = await apiClient(app, 'ro_ps2_x2');
    expect((await ro.get('/api/candidates/wards')).status).toBe(200);
    await pool.execute(
      'UPDATE users SET failed_login_count = 2, locked_until = NOW(3) + INTERVAL 5 MINUTE WHERE id = ?',
      [w.users.ro2],
    );
    const res = await setPassword(w.users.ro2, { newPassword: GOOD, password: PASSWORD });
    expect([res.status, res.body]).toEqual([200, { username: 'ro_ps2_x2', password: GOOD }]);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await user(w.users.ro2)).toMatchObject({ failed_login_count: 0, locked_until: null });
    expect(String((await user(w.users.ro2))?.password_hash)).toMatch(/^\$2b\$12\$/);
    expect((await ro.get('/api/candidates/wards')).status).toBe(401);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(401);
    expect(await loginStatus('ro_ps2_x2', GOOD)).toBe(200);
    const [audit] = await auditOf(pool, 'RO_CREDENTIALS_CHANGED');
    expect([audit?.user_id, Number(audit?.entity_id)]).toEqual([w.users.dm, w.users.ro2]);
    expect(audit?.new_value).toEqual({
      via: 'web',
      username: 'ro_ps2_x2',
      username_changed: false,
      password_changed: true,
      failed_login_count: 0,
      locked_until: null,
    });
    expect(await auditText()).not.toContain(GOOD);
  });

  it('each rule is refused with its own code, and nothing changes', async () => {
    const before = await masterSnapshot(pool);
    for (const [newPassword, , code] of [
      ['Ab3short', 'Ab3short', 'PASSWORD_TOO_SHORT'],
      [`A1${'x'.repeat(130)}`, `A1${'x'.repeat(130)}`, 'PASSWORD_TOO_LONG'],
      ['onlyletterspassphrase', 'onlyletterspassphrase', 'PASSWORD_NEEDS_LETTER_AND_DIGIT'],
      ['12345678901234', '12345678901234', 'PASSWORD_NEEDS_LETTER_AND_DIGIT'],
      ['RO_PS2_X2-tila9', 'RO_PS2_X2-tila9', 'PASSWORD_HAS_USERNAME'],
      ['Churu2026!', 'Churu2026!', 'PASSWORD_TOO_COMMON'],
      ['P@ssword123', 'P@ssword123', 'PASSWORD_TOO_COMMON'],
      ['Admin12345', 'Admin12345', 'PASSWORD_TOO_COMMON'],
    ] as const) {
      const res = await setPassword(w.users.ro2, { newPassword, password: PASSWORD });
      expect([newPassword, res.status, res.body]).toEqual([newPassword, 400, { error: code }]);
    }
    // Rules are checked before the DM's password: nothing written, no re-auth counted.
    expect(await masterSnapshot(pool)).toBe(before);
    expect((await auditOf(pool, 'RO_CREDENTIALS_CHANGED')).length).toBe(0);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(200);
  });

  it('wrong DM password: REAUTH_FAILED and the RO password is unchanged', async () => {
    const hash = (await user(w.users.ro2))?.password_hash as unknown;
    const res = await setPassword(w.users.ro2, {
      newPassword: GOOD,
      password: 'wrong-dm-password',
    });
    expect([res.status, res.body]).toEqual([401, { error: 'REAUTH_FAILED' }]);
    expect((await user(w.users.ro2))?.password_hash).toBe(hash);
    expect((await auditOf(pool, 'RO_CREDENTIALS_CHANGED')).length).toBe(0);
    expect(await loginStatus('ro_ps2_x2', GOOD)).toBe(401);
  });

  it('never for the DM account; an unknown user is 404', async () => {
    const body = { newPassword: GOOD, password: PASSWORD };
    expect((await setPassword(w.users.dm, body)).status).toBe(403);
    expect((await setPassword(999_999, body)).status).toBe(404);
  });

  it('the rules as a pure function, and the exact allow-list path', () => {
    expect(checkChosenPassword(GOOD, GOOD, 'ro_chu_k7m2')).toEqual([]);
    expect(checkChosenPassword('abc', 'abd', 'ro_chu_k7m2')).toEqual([
      'PASSWORD_TOO_SHORT',
      'PASSWORD_NEEDS_LETTER_AND_DIGIT',
      'PASSWORD_TOO_COMMON',
      'PASSWORD_MISMATCH',
    ]);
    for (const weak of [
      'password',
      'Password1234',
      'P4ssw0rd!',
      '2026churu',
      'Election2026',
      'qwerty12345',
    ])
      expect([weak, isWeakPassword(weak)]).toEqual([weak, true]);
    for (const ok of [GOOD, 'Ramgarh2026x', 'नीलकमल7तालाब3'])
      expect([ok, isWeakPassword(ok)]).toEqual([ok, false]);
    expect(checkChosenPassword('नीलकमल7तालाब3', 'नीलकमल7तालाब3', 'ro_x')).toEqual([]);
    expect(dmWriteAllowed('POST', '/api/admin/users/5/update-credentials')).toBe(true);
    expect(dmWriteAllowed('PUT', '/api/admin/users/5/update-credentials')).toBe(false);
    expect(dmWriteAllowed('POST', '/api/admin/users/5/update-credentials/x')).toBe(false);
  });
});
