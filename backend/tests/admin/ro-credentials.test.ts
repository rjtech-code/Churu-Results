import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptPassword,
  encryptPassword,
  parseVaultKey,
} from '../../src/services/master-data/password-vault.js';
import { login } from '../auth/helpers.js';
import { TEST_RO_PASSWORD_KEY } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  auditWhoWhen,
  buildAdminWorld,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

describe('password vault (AES-256-GCM)', () => {
  const key = TEST_RO_PASSWORD_KEY;

  it('round-trips, including Hindi text, with a fresh IV every time', () => {
    for (const text of ['Kesar7Tila9mor', 'नीलकमल7तालाब3']) {
      const a = encryptPassword(text, key);
      const b = encryptPassword(text, key);
      expect(a.equals(b)).toBe(false);
      expect(a.includes(Buffer.from(text))).toBe(false);
      expect(decryptPassword(a, key)).toBe(text);
    }
  });

  it('a wrong key, a changed byte or a truncated value is refused', () => {
    const blob = encryptPassword('Kesar7Tila9mor', key);
    expect(() => decryptPassword(blob, Buffer.alloc(32, 9))).toThrow();
    const changed = Buffer.from(blob);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(() => decryptPassword(changed, key)).toThrow();
    expect(() => decryptPassword(blob.subarray(0, 20), key)).toThrow();
  });

  it('the env key must be base64 of exactly 32 bytes', () => {
    expect(parseVaultKey(key.toString('base64'))?.equals(key)).toBe(true);
    for (const bad of ['', 'short', Buffer.alloc(16, 1).toString('base64'), 'A'.repeat(44)])
      expect([bad, parseVaultKey(bad)]).toEqual([bad, null]);
  });
});

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

const GOOD = 'Kesar7Tila9mor';
const loginStatus = async (username: string, password: string) =>
  (await login(request.agent(app), username, password)).status;
async function auditText(): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM audit_log');
  return JSON.stringify(rows);
}
const setPassword = (userId: number, username: string, newPassword = GOOD) =>
  dm.post(`/api/admin/users/${userId}/update-credentials`, {
    username,
    newPassword,
    password: PASSWORD,
  });

describe('DM views an RO password', () => {
  it('after a save, "view" returns exactly that password, audited without it', async () => {
    expect((await setPassword(w.users.ro2, 'ro_ps2_x2')).status).toBe(200);
    const res = await dm.post(`/api/admin/users/${w.users.ro2}/view-password`, {});
    expect([res.status, res.body]).toEqual([200, { username: 'ro_ps2_x2', password: GOOD }]);
    expect(res.headers['cache-control']).toBe('no-store');
    const [audit] = await auditOf(pool, 'RO_PASSWORD_VIEWED');
    expect([audit?.user_id, Number(audit?.entity_id)]).toEqual([w.users.dm, w.users.ro2]);
    expect(await auditText()).not.toContain(GOOD);
  });

  it('no DM password: a body with one is refused; every view writes its own audit row', async () => {
    await setPassword(w.users.ro2, 'ro_ps2_x2');
    const extra = await dm.post(`/api/admin/users/${w.users.ro2}/view-password`, {
      password: PASSWORD,
    });
    expect(extra.status).toBe(400);
    expect(JSON.stringify(extra.body)).not.toContain(GOOD);
    expect((await auditOf(pool, 'RO_PASSWORD_VIEWED')).length).toBe(0);

    for (let i = 0; i < 2; i++)
      expect((await dm.post(`/api/admin/users/${w.users.ro2}/view-password`, {})).status).toBe(200);
    expect(await auditWhoWhen(pool, 'RO_PASSWORD_VIEWED')).toEqual([
      { userId: w.users.dm, entityId: w.users.ro2, at: 'date' },
      { userId: w.users.dm, entityId: w.users.ro2, at: 'date' },
    ]);
  });

  it('an account with no stored copy says NO_COPY (409), nothing audited', async () => {
    const res = await dm.post(`/api/admin/users/${w.users.ro1}/view-password`, {});
    expect([res.status, res.body]).toEqual([409, { error: 'NO_COPY' }]);
    expect((await auditOf(pool, 'RO_PASSWORD_VIEWED')).length).toBe(0);
  });

  it('a PS_RO / ZP_RO (or anyone not logged in) is refused on every new route', async () => {
    const ro = await apiClient(app, 'ro_ps2_x2');
    const zp = await apiClient(app, 'zp_ro_x3');
    const paths = [
      [`/api/admin/users/${w.users.ro2}/view-password`, {}],
      [
        `/api/admin/users/${w.users.ro2}/update-credentials`,
        { username: 'ro_hacker', newPassword: GOOD, password: PASSWORD },
      ],
      ['/api/admin/users/generate-password', {}],
    ] as const;
    for (const client of [ro, zp])
      for (const [path, body] of paths) {
        const res = await client.post(path, body);
        expect([path, res.status]).toEqual([path, 403]);
      }
    for (const [path, body] of paths) {
      // No session (and no CSRF token): refused before anything runs.
      expect([401, 403]).toContain((await request(app).post(path).send(body)).status);
    }
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(200);
  });

  it('the DM never has a copy: the database refuses one, and a DM id is 403', async () => {
    await expect(
      migrator.execute('UPDATE users SET password_enc = ? WHERE id = ?', [
        encryptPassword('x1y2z3w4v5', TEST_RO_PASSWORD_KEY),
        w.users.dm,
      ]),
    ).rejects.toThrow();
    const res = await dm.post(`/api/admin/users/${w.users.dm}/view-password`, {});
    expect(res.status).toBe(403);
  });

  it('created and replaced accounts are viewable; the stored column is ciphertext', async () => {
    const created = await dm.post(`/api/admin/users/${w.users.ro2}/replace`, {
      fullName: 'नया RO',
      phone: '9876543210',
    });
    const out = created.body as { username: string; password: string };
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, password_enc FROM users WHERE username = ?',
      [out.username],
    );
    const stored = rows[0]?.password_enc as Buffer;
    expect(stored.includes(Buffer.from(out.password))).toBe(false);
    const view = await dm.post(`/api/admin/users/${rows[0]?.id as number}/view-password`, {});
    expect(view.body).toEqual(out);
  });
});

describe('DM changes username and/or password', () => {
  it('rename only: the old session ends, the old password still works under the new name', async () => {
    const ro = await apiClient(app, 'ro_ps2_x2');
    expect((await ro.get('/api/candidates/wards')).status).toBe(200);
    const res = await dm.post(`/api/admin/users/${w.users.ro2}/update-credentials`, {
      username: 'ro_new_name',
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect((await ro.get('/api/candidates/wards')).status).toBe(401);
    expect(await loginStatus('ro_ps2_x2', PASSWORD)).toBe(401);
    expect(await loginStatus('ro_new_name', PASSWORD)).toBe(200);
    const [audit] = await auditOf(pool, 'RO_CREDENTIALS_CHANGED');
    expect(audit?.old_value).toEqual({ username: 'ro_ps2_x2' });
    expect(audit?.new_value).toMatchObject({ username: 'ro_new_name', password_changed: false });
  });

  it('username rules: format, unique, and nothing changed = NO_CHANGE', async () => {
    const post = (username: string, extra: Record<string, string> = {}) =>
      dm.post(`/api/admin/users/${w.users.ro2}/update-credentials`, {
        username,
        password: PASSWORD,
        ...extra,
      });
    for (const bad of ['ab', 'Has Space', 'UPPER_case', 'x'.repeat(31)])
      expect([bad, (await post(bad)).body]).toEqual([bad, { error: 'USERNAME_INVALID' }]);
    expect((await post('ro_ps1_x1')).body).toEqual({ error: 'USERNAME_TAKEN' });
    expect((await post('ro_ps2_x2')).body).toEqual({ error: 'NO_CHANGE' });
    expect((await auditOf(pool, 'RO_CREDENTIALS_CHANGED')).length).toBe(0);
  });

  it('users:create / users:reset-password style helpers keep the copy in step', async () => {
    await setPassword(w.users.ro2, 'ro_ps2_x2', GOOD);
    await setPassword(w.users.ro2, 'ro_ps2_x2', 'Zebra4Lotus8pond');
    const view = await dm.post(`/api/admin/users/${w.users.ro2}/view-password`, {});
    expect(view.body).toEqual({ username: 'ro_ps2_x2', password: 'Zebra4Lotus8pond' });
  });
});
