import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/services/master-data/accounts.js';
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

async function phoneOf(id: number): Promise<string | null> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT phone FROM users WHERE id = ?', [id]);
  return (rows[0]?.phone as string | null | undefined) ?? null;
}
const WHY = 'कृपया 10 अंकों का सही मोबाइल नंबर लिखें';

describe('normalizePhone', () => {
  it('cleans +91, 91, 0 and spaces; rejects the rest', () => {
    for (const ok of [
      '9876543210',
      '+91 98765 43210',
      '+91-9876543210',
      '919876543210',
      '09876543210',
    ])
      expect(normalizePhone(ok), ok).toBe('9876543210');
    for (const bad of [
      '',
      '5876543210',
      '987654321',
      '98765432100',
      '98765abcde',
      '+9198765',
      '0919876543210',
    ])
      expect(normalizePhone(bad), bad).toBeNull();
    // a plain 10-digit number that happens to start with 91 is kept as typed
    expect(normalizePhone('9123456789')).toBe('9123456789');
  });
});

describe('RO mobile number', () => {
  it('old ROs have phone NULL, still log in, and the list shows null', async () => {
    expect(await phoneOf(w.users.ro1)).toBeNull();
    await apiClient(app, 'ro_ps1_x1'); // login works
    const list = await dm.get('/api/admin/users');
    const seats = (
      list.body as { seats: { account: { id: number; phone: string | null } | null }[] }
    ).seats;
    const mine = seats.find((s) => s.account?.id === w.users.ro1);
    expect(mine?.account?.phone).toBeNull();
  });

  it('create and replace need a valid phone, and save the cleaned number', async () => {
    await pool.execute('DELETE FROM users WHERE id = ?', [w.users.ro2]);
    const missing = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps2}`,
      fullName: 'नया अधिकारी',
      password: PASSWORD,
    });
    expect(missing.status).toBe(400);
    const bad = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps2}`,
      fullName: 'नया अधिकारी',
      phone: '1234567890',
      password: PASSWORD,
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain(WHY);

    const created = await dm.post('/api/admin/users/create', {
      seat: `PS:${w.ps2}`,
      fullName: 'नया अधिकारी',
      phone: '+91 98765 43210',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
      (created.body as { username: string }).username,
    ]);
    expect(await phoneOf(rows[0]?.id as number)).toBe('9876543210');

    const replaced = await dm.post(`/api/admin/users/${w.users.ro1}/replace`, {
      fullName: 'नए RO',
      phone: '8123456789',
    });
    expect(replaced.status).toBe(201);
    const [r2] = await pool.execute<RowDataPacket[]>('SELECT phone FROM users WHERE username = ?', [
      (replaced.body as { username: string }).username,
    ]);
    expect(r2[0]?.phone).toBe('8123456789');
  });

  it('add / change on an old RO: no password, invalid rejected, audit has last 4 only', async () => {
    const path = `/api/admin/users/${w.users.ro1}/phone`;
    // A password is no longer accepted (strict body).
    expect((await dm.post(path, { phone: '9876543210', password: PASSWORD })).status).toBe(400);
    expect(await phoneOf(w.users.ro1)).toBeNull();
    expect((await dm.post(path, { phone: '12345' })).status).toBe(400);
    expect((await dm.post(path, {})).status).toBe(400);

    expect((await dm.post(path, { phone: '+919876543210' })).status).toBe(200);
    expect(await phoneOf(w.users.ro1)).toBe('9876543210');
    expect((await dm.post(path, { phone: '9876543210' })).status).toBe(409);
    expect((await dm.post(path, { phone: '7000011112' })).status).toBe(200);
    for (const action of ['RO_PHONE_ADDED', 'RO_PHONE_CHANGED'])
      expect([action, await auditWhoWhen(pool, action)]).toEqual([
        action,
        [{ userId: w.users.dm, entityId: w.users.ro1, at: 'date' }],
      ]);

    const added = await auditOf(pool, 'RO_PHONE_ADDED');
    const changed = await auditOf(pool, 'RO_PHONE_CHANGED');
    expect(added).toHaveLength(1);
    expect(changed).toHaveLength(1);
    const text = JSON.stringify([added, changed]);
    expect(text).toContain('****3210');
    expect(text).toContain('****1112');
    for (const full of ['9876543210', '7000011112']) expect(text).not.toContain(full);
  });

  it('the phone reaches only the DM: ROs get 403 and never see it', async () => {
    const path = `/api/admin/users/${w.users.ro1}/phone`;
    await dm.post(path, { phone: '9876543210' });
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path, { phone: '9000000000' })).status).toBe(403);
    expect((await ro.get('/api/admin/users')).status).toBe(403);
    for (const p of ['/api/auth/me', '/api/candidates/wards']) {
      const res = await ro.get(p);
      expect(JSON.stringify(res.body), p).not.toContain('9876543210');
      expect(JSON.stringify(res.body), p).not.toContain('phone');
    }
    const list = await dm.get('/api/admin/users');
    expect(JSON.stringify(list.body)).toContain('9876543210');
  });

  it('"बदलें" form: phone is optional; phone-only keeps the RO logged in; invalid rejected', async () => {
    const path = `/api/admin/users/${w.users.ro1}/update-credentials`;
    const ro = await apiClient(app, 'ro_ps1_x1');
    // username unchanged, no phone, no password: nothing to do
    expect((await dm.post(path, { username: 'ro_ps1_x1', password: PASSWORD })).status).toBe(409);
    // invalid phone: rejected, nothing written
    const bad = await dm.post(path, { username: 'ro_ps1_x1', phone: '12345', password: PASSWORD });
    expect(bad.status).toBe(400);
    expect(await phoneOf(w.users.ro1)).toBeNull();
    // phone only: saved (cleaned), no password revealed, the RO's session stays
    const ok = await dm.post(path, {
      username: 'ro_ps1_x1',
      phone: '+91 98765 43210',
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      username: 'ro_ps1_x1',
      password: null,
      credentialsChanged: false,
    });
    expect(await phoneOf(w.users.ro1)).toBe('9876543210');
    expect((await ro.get('/api/candidates/wards')).status).toBe(200);
    // username change without phone: the old number stays
    const renamed = await dm.post(path, { username: 'ro_ps1_new', password: PASSWORD });
    expect(renamed.status).toBe(200);
    expect(await phoneOf(w.users.ro1)).toBe('9876543210');
    expect(JSON.stringify(await auditOf(pool, 'RO_PHONE_ADDED'))).not.toContain('9876543210');
  });
});
