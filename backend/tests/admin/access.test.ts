import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dmWriteAllowed } from '../../src/middleware/auth.js';
import { csrfToken } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { psW1Sheet } from '../counting/helpers.js';
import { adminApp, apiClient, buildAdminWorld, masterSnapshot } from './helpers.js';
import type { AdminWorld } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;

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
});

/** Every /api/admin endpoint (method, path, a body that passes validation where possible). */
function adminEndpoints(): [string, string][] {
  return [
    ['GET', '/api/admin/parties'],
    ['POST', '/api/admin/parties/check'],
    ['POST', '/api/admin/parties/save'],
    ['POST', '/api/admin/parties/add'],
    ['GET', '/api/admin/templates/candidates.xlsx'],
    ['POST', '/api/admin/candidates/check'],
    ['POST', '/api/admin/candidates/save'],
    ['GET', '/api/admin/candidate-status'],
    ['GET', `/api/admin/wards/${w.psW4}/candidates`],
    ['POST', `/api/admin/wards/${w.psW4}/send-back`],
    ['GET', '/api/admin/lock/preview?area=ZP'],
    ['POST', '/api/admin/lock'],
    ['GET', '/api/admin/ballot-report.xlsx?scope=ALL'],
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users/create'],
    ['POST', `/api/admin/users/${w.users.ro1}/replace`],
    ['POST', `/api/admin/users/${w.users.ro1}/update-credentials`],
    ['POST', `/api/admin/users/${w.users.ro1}/view-password`],
    ['POST', '/api/admin/users/generate-password'],
    ['POST', `/api/admin/users/${w.users.ro1}/disable`],
    ['POST', `/api/admin/users/${w.users.ro1}/enable`],
    ['POST', `/api/admin/users/${w.users.ro1}/unlock`],
    ['POST', `/api/admin/users/${w.users.ro1}/phone`],
    ['GET', `/api/admin/booths?psId=${w.ps1}`],
    ['GET', `/api/admin/wards?psId=${w.ps1}`],
    ['POST', `/api/admin/booths/${w.b7}`],
    ['POST', `/api/admin/booths/${w.b7}/move`],
    ['POST', `/api/admin/wards/${w.psW5}/category`],
  ];
}

function roEndpoints(): [string, string][] {
  return [
    ['GET', '/api/candidates/wards'],
    ['GET', `/api/candidates/wards/${w.psW4}`],
    ['PUT', `/api/candidates/wards/${w.psW4}`],
    ['POST', `/api/candidates/wards/${w.psW4}/ready`],
  ];
}

async function call(c: Awaited<ReturnType<typeof apiClient>>, method: string, path: string) {
  if (method === 'GET') return c.get(path);
  if (method === 'PUT') return c.put(path, {});
  return c.post(path, {});
}

describe('Part 13 access: /api/admin is DM only', () => {
  it('PS_RO and ZP_RO get 403 on every admin endpoint, and nothing changes', async () => {
    const before = await masterSnapshot(pool);
    for (const username of ['ro_ps1_x1', 'zp_ro_x3']) {
      const c = await apiClient(app, username);
      for (const [method, path] of adminEndpoints()) {
        const res = await call(c, method, path);
        expect([method, path, res.status, res.body]).toEqual([
          method,
          path,
          403,
          { error: 'FORBIDDEN' },
        ]);
      }
    }
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('logged out: 401 on every admin and candidate endpoint (with a valid CSRF token)', async () => {
    const agent = request.agent(app);
    const token = await csrfToken(agent);
    for (const [method, path] of [...adminEndpoints(), ...roEndpoints()]) {
      const res =
        method === 'GET'
          ? await agent.get(path)
          : method === 'PUT'
            ? await agent.put(path).set('X-CSRF-Token', token).send({})
            : await agent.post(path).set('X-CSRF-Token', token).send({});
      expect([path, res.status]).toEqual([path, 401]);
    }
  });

  it('the DM reaches the admin endpoints (validation answers 400, never 403)', async () => {
    const dm = await apiClient(app, 'dm_x4');
    for (const [method, path] of adminEndpoints()) {
      const res = await call(dm, method, path);
      expect([path, res.status]).not.toEqual([path, 403]);
      expect([path, res.status]).not.toEqual([path, 401]);
    }
  });
});

describe('Part 13 access: /api/candidates is RO only, own wards only', () => {
  it('the DM gets 403 on every RO candidate endpoint', async () => {
    const dm = await apiClient(app, 'dm_x4');
    for (const [method, path] of roEndpoints()) {
      const res = await call(dm, method, path);
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('PS_RO: only PS wards of its own PS; ZP_RO: only ZP wards', async () => {
    const ro1 = await apiClient(app, 'ro_ps1_x1');
    const ro2 = await apiClient(app, 'ro_ps2_x2');
    const zp = await apiClient(app, 'zp_ro_x3');
    const list = {
      candidates: [{ ballotPosition: 1, nameHindi: 'राम', partyId: null, gender: 'M' }],
    };

    // Other PS's ward and ZP ward: 403 for ro2 / ro1.
    expect((await ro2.get(`/api/candidates/wards/${w.psW5}`)).status).toBe(403);
    expect((await ro2.put(`/api/candidates/wards/${w.psW5}`, list)).status).toBe(403);
    expect((await ro1.put(`/api/candidates/wards/${w.zW2}`, list)).status).toBe(403);
    expect((await ro1.post(`/api/candidates/wards/${w.zW2}/ready`, {})).status).toBe(403);
    // ZP_RO on a PS ward: 403.
    expect((await zp.put(`/api/candidates/wards/${w.psW5}`, list)).status).toBe(403);
    // Unknown ward: 404.
    expect((await ro1.get('/api/candidates/wards/999999')).status).toBe(404);

    // The lists only show own wards.
    const own = (await ro1.get('/api/candidates/wards')).body as { wards: { id: number }[] };
    expect(own.wards.map((x) => x.id).sort()).toEqual([w.psW1, w.psW3, w.psW4, w.psW5].sort());
    const zpOwn = (await zp.get('/api/candidates/wards')).body as { wards: { id: number }[] };
    expect(zpOwn.wards.map((x) => x.id).sort()).toEqual([w.zW1, w.zW2].sort());

    // Allowed: own ward / ZP ward.
    expect((await ro1.put(`/api/candidates/wards/${w.psW5}`, list)).status).toBe(200);
    expect((await zp.put(`/api/candidates/wards/${w.zW2}`, list)).status).toBe(200);
  });
});

describe('the DM can still never count, declare or correct', () => {
  it('DM POSTs to counting and declare are 403 and write nothing', async () => {
    const dm = await apiClient(app, 'dm_x4');
    for (const path of [
      '/api/counting/entries',
      '/api/counting/entries/preview',
      `/api/counting/wards/${w.psW1}/postal`,
      '/api/counting/entries/1/void',
      `/api/declare/wards/${w.psW1}`,
      `/api/declare/wards/${w.psW1}/preview`,
      `/api/declare/wards/${w.psW1}/correction`,
    ]) {
      const res = await dm.post(path, psW1Sheet(w, w.b1));
      expect([path, res.status]).toEqual([path, 403]);
    }
    expect((await dm.put('/api/counting/entries/1', {})).status).toBe(403);
    expect((await dm.get(`/api/counting/wards/${w.psW1}/booths`)).status).toBe(403);
  });

  it('the allow-list is exact: near-miss paths and other methods are refused', () => {
    expect(dmWriteAllowed('POST', '/api/admin/lock')).toBe(true);
    expect(dmWriteAllowed('POST', '/api/admin/users/12/view-password')).toBe(true);
    expect(dmWriteAllowed('POST', '/api/admin/booths/3/move')).toBe(true);
    for (const [method, path] of [
      ['PUT', '/api/admin/lock'],
      ['DELETE', '/api/admin/booths/3'],
      ['POST', '/api/admin/lock/'],
      ['POST', '/api/admin/lock/x'],
      ['POST', '/api/admin/users/0/disable'],
      ['POST', '/api/admin/users/abc/disable'],
      ['POST', '/api/admin/users/1/delete'],
      ['POST', '/api/admin/../counting/entries'],
      ['POST', '/api/counting/entries'],
      ['POST', '/api/declare/wards/1'],
      ['POST', '/api/candidates/wards/1/ready'],
      ['POST', '/api/admin/parties/check/extra'],
      ['POST', '/api/ADMIN/lock'],
    ] as const) {
      expect([method, path, dmWriteAllowed(method, path)]).toEqual([method, path, false]);
    }
  });
});
