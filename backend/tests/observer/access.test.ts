// OBSERVER permission matrix: allowed ONLY on GET /api/observer/* (and /api/auth); 403 on every
// other mounted router — enumerated from src/app.ts, so a router added in a future part fails this
// test unless it is explicitly classified below.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { observerAllowed } from '../../src/middleware/auth.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildApp, createUser, csrfToken, login, seedTwoPs } from '../auth/helpers.js';
import type { Agent } from '../auth/helpers.js';

let pool: Pool;
let migrator: Pool;

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
  const { ps1 } = await seedTwoPs(pool);
  await createUser(pool, { username: 'obs_one', role: 'OBSERVER', password: 'Pass-word-1' });
  await createUser(pool, { username: 'obs_two', role: 'OBSERVER', password: 'Pass-word-1' });
  await createUser(pool, { username: 'ro_one', role: 'PS_RO', psId: ps1, password: 'Pass-word-1' });
  await createUser(pool, { username: 'zp_one', role: 'ZP_RO', password: 'Pass-word-1' });
  await createUser(pool, { username: 'dm_one', role: 'DM', password: 'Pass-word-1' });
  await createUser(pool, { username: 'sa_one', role: 'SUPER_ADMIN', password: 'Pass-word-1' });
});

async function loggedIn(username: string): Promise<{ agent: Agent; token: string }> {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, 'Pass-word-1')).status).toBe(200);
  return { agent, token: await csrfToken(agent) };
}

/** Every /api prefix mounted in src/app.ts (so a future router cannot be forgotten here). */
async function mountedApiPaths(): Promise<string[]> {
  const source = await readFile(resolve(import.meta.dirname, '../../src/app.ts'), 'utf8');
  const paths = [...source.matchAll(/app\.use\(\s*'(\/api\/[^']*)'/g)].map((m) => m[1] ?? '');
  expect(paths.length).toBeGreaterThanOrEqual(10);
  return [...new Set(paths)];
}

/** What an OBSERVER may reach, per mounted prefix. Everything else must be 403. */
const OBSERVER_OPEN = new Set(['/api/auth', '/api/observer']);

describe('observer deny-by-default', () => {
  it('every mounted router except /api/auth and /api/observer refuses an observer (GET and POST)', async () => {
    const { agent, token } = await loggedIn('obs_one');
    for (const path of await mountedApiPaths()) {
      if (OBSERVER_OPEN.has(path)) continue;
      if (path === '/api/health' || path === '/api/public' || path === '/api/screen-auth') {
        // Not user routes: health is open to all; public screens need a screen key, not a login.
        continue;
      }
      const get = await agent.get(`${path}/anything`);
      expect(get.status, `GET ${path}`).toBe(403);
      expect(get.body, `GET ${path}`).toEqual({ error: 'FORBIDDEN' });
      const post = await agent.post(`${path}/anything`).set('X-CSRF-Token', token).send({});
      expect(post.status, `POST ${path}`).toBe(403);
    }
  });

  it('known sensitive routes are all 403 for an observer', async () => {
    const { agent, token } = await loggedIn('obs_one');
    const reads = [
      '/api/reports/summary',
      '/api/reports/counting-status',
      '/api/reports/counting-status.pdf',
      '/api/counting/wards',
      '/api/admin/users',
      '/api/admin/screen-keys',
      '/api/candidates/wards',
      '/api/superadmin/status',
      '/api/profile',
      '/api/st-format/zp',
      '/api/ward-forms/wards',
      '/api/declare/wards/1/preview',
    ];
    for (const path of reads) {
      expect((await agent.get(path)).status, `GET ${path}`).toBe(403);
    }
    const writes = [
      '/api/counting/entries',
      '/api/declare/wards/1',
      '/api/candidates/wards/1/name-change',
      '/api/admin/lock',
      '/api/admin/screen-keys/create',
      '/api/superadmin/full-reset',
    ];
    for (const path of writes) {
      const res = await agent.post(path).set('X-CSRF-Token', token).send({});
      expect(res.status, `POST ${path}`).toBe(403);
    }
  });

  it('an observer cannot write even on a route that forgets its role check (global guard)', async () => {
    const { Router } = await import('express');
    const dummy = Router();
    dummy.post('/items', (_req, res) => res.status(201).json({ ok: true }));
    dummy.get('/items', (_req, res) => res.json({ ok: true }));
    const app = buildApp(pool, {}, [{ path: '/api/test', router: dummy }]);
    const agent = request.agent(app);
    expect((await login(agent, 'obs_one', 'Pass-word-1')).status).toBe(200);
    const token = await csrfToken(agent);
    expect((await agent.get('/api/test/items')).status).toBe(403);
    expect((await agent.post('/api/test/items').set('X-CSRF-Token', token).send({})).status).toBe(
      403,
    );
  });

  it('non-GET on /api/observer is refused even for an observer', async () => {
    const { agent, token } = await loggedIn('obs_one');
    const res = await agent.post('/api/observer/overview').set('X-CSRF-Token', token).send({});
    expect(res.status).toBe(403);
  });

  it('observerAllowed: the rule itself', () => {
    expect(observerAllowed('GET', '/api/observer/overview')).toBe(true);
    expect(observerAllowed('GET', '/api/observer')).toBe(true);
    expect(observerAllowed('POST', '/api/observer/overview')).toBe(false);
    expect(observerAllowed('GET', '/api/observers')).toBe(false);
    expect(observerAllowed('GET', '/api/reports/summary')).toBe(false);
    expect(observerAllowed('POST', '/api/auth/login')).toBe(true);
    expect(observerAllowed('POST', '/api/auth/logout')).toBe(true);
  });
});

describe('observer routes for other roles and anonymous', () => {
  const OBSERVER_GETS = [
    '/api/observer/overview',
    '/api/observer/ps',
    '/api/observer/zp',
    '/api/observer/winners',
    '/api/observer/women',
    '/api/observer/search?q=1',
    '/api/observer/reports/counting-status.pdf',
    '/api/observer/reports/counting-status/wards.csv',
    '/api/observer/reports/counting-status/booths.csv',
    '/api/observer/reports/counting-status/zp-by-ps.csv',
  ];

  it('an observer can use every observer endpoint', async () => {
    const { agent } = await loggedIn('obs_one');
    for (const path of OBSERVER_GETS) {
      expect((await agent.get(path)).status, path).toBe(200);
    }
  });

  it('several observer accounts can be logged in at once', async () => {
    const a = await loggedIn('obs_one');
    const b = await loggedIn('obs_two');
    expect((await a.agent.get('/api/observer/overview')).status).toBe(200);
    expect((await b.agent.get('/api/observer/overview')).status).toBe(200);
  });

  it('every other role gets 403 on observer routes; anonymous gets 401', async () => {
    for (const username of ['ro_one', 'zp_one', 'dm_one', 'sa_one']) {
      const { agent } = await loggedIn(username);
      const res = await agent.get('/api/observer/overview');
      expect(res.status, username).toBe(403);
    }
    const anon = await request(buildApp(pool)).get('/api/observer/overview');
    expect(anon.status).toBe(401);
  });

  it('a disabled observer is out at once', async () => {
    const { agent } = await loggedIn('obs_one');
    await pool.execute("UPDATE users SET is_active = 0 WHERE username = 'obs_one'");
    expect((await agent.get('/api/observer/overview')).status).toBe(401);
  });
});
