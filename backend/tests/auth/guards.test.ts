import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireAuth, requireRole } from '../../src/middleware/auth.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildApp, createUser, csrfToken, login, logout, seedTwoPs } from './helpers.js';
import type { Agent } from './helpers.js';

let app: Pool;
let migrator: Pool;

/** Dummy routes that exist ONLY in this test file. */
function dummyRouter(): Router {
  const router = Router();
  // Deliberately NO role check: the global DM guard must still stop a DM.
  router.get('/items', (_req, res) => res.json({ ok: true }));
  router.post('/items', (_req, res) => res.status(201).json({ ok: true }));
  router.put('/items', (_req, res) => res.json({ ok: true }));
  router.patch('/items', (_req, res) => res.json({ ok: true }));
  router.delete('/items', (_req, res) => res.status(204).end());
  router.get('/private', requireAuth, (_req, res) => res.json({ ok: true }));
  router.post('/ps-only', requireRole('PS_RO'), (_req, res) => res.status(201).json({ ok: true }));
  return router;
}

const appWithDummy = () => buildApp(app, {}, [{ path: '/api/test', router: dummyRouter() }]);

beforeAll(() => {
  app = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await app.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  const { ps1 } = await seedTwoPs(app);
  await createUser(app, {
    username: 'ro_churu',
    role: 'PS_RO',
    psId: ps1,
    password: 'Pass-word-1',
  });
  await createUser(app, { username: 'zp_ro', role: 'ZP_RO', password: 'Pass-word-1' });
  await createUser(app, { username: 'dm_churu', role: 'DM', password: 'Pass-word-1' });
});

async function loggedIn(username: string): Promise<{ agent: Agent; token: string }> {
  const agent = request.agent(appWithDummy());
  expect((await login(agent, username, 'Pass-word-1')).status).toBe(200);
  return { agent, token: await csrfToken(agent) };
}

describe('global DM guard', () => {
  it('a DM gets 403 on every state-changing method, even on a route without a role check', async () => {
    const { agent, token } = await loggedIn('dm_churu');
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await agent[method]('/api/test/items').set('X-CSRF-Token', token).send({});
      expect(res.status, method).toBe(403);
      expect(res.body).toEqual({ error: 'FORBIDDEN' });
    }
    // Not even via a different path spelling.
    const upper = await agent.post('/API/TEST/ITEMS').set('X-CSRF-Token', token).send({});
    expect(upper.status).toBe(403);
  });

  it('a DM can read, and can log out', async () => {
    const { agent } = await loggedIn('dm_churu');
    expect((await agent.get('/api/test/items')).status).toBe(200);
    expect((await agent.get('/api/test/private')).status).toBe(200);
    expect((await logout(agent)).status).toBe(204);
  });

  it('other roles are not affected by the DM guard', async () => {
    const { agent, token } = await loggedIn('zp_ro');
    expect((await agent.post('/api/test/items').set('X-CSRF-Token', token).send({})).status).toBe(
      201,
    );
  });
});

describe('requireAuth / requireRole', () => {
  it('requireAuth: 401 UNAUTHENTICATED without a login', async () => {
    const res = await request(appWithDummy()).get('/api/test/private');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('requireRole: the right role passes, another role gets 403, anonymous gets 401', async () => {
    const ro = await loggedIn('ro_churu');
    expect(
      (await ro.agent.post('/api/test/ps-only').set('X-CSRF-Token', ro.token).send({})).status,
    ).toBe(201);

    const zp = await loggedIn('zp_ro');
    const forbidden = await zp.agent
      .post('/api/test/ps-only')
      .set('X-CSRF-Token', zp.token)
      .send({});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'FORBIDDEN' });

    const anon = request.agent(appWithDummy());
    const token = await csrfToken(anon);
    const res = await anon.post('/api/test/ps-only').set('X-CSRF-Token', token).send({});
    expect(res.status).toBe(401);
  });

  it('role and PS always come from the DB, not the session', async () => {
    const { agent, token } = await loggedIn('ro_churu');
    // (Only one active ZP_RO may exist, so the current one is disabled first.)
    await app.execute("UPDATE users SET is_active = 0 WHERE username = 'zp_ro'");
    await app.execute(
      "UPDATE users SET role = 'ZP_RO', panchayat_samiti_id = NULL WHERE username = 'ro_churu'",
    );
    expect((await agent.post('/api/test/ps-only').set('X-CSRF-Token', token).send({})).status).toBe(
      403,
    );
    expect(((await agent.get('/api/auth/me')).body as { role: string }).role).toBe('ZP_RO');
  });
});
