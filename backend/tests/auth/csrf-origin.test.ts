import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { TEST_ORIGIN, buildApp, createUser, csrfToken, login, seedTwoPs } from './helpers.js';

let app: Pool;
let migrator: Pool;

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
    password: 'Correct-Pass-1',
  });
});

const CREDS = { username: 'ro_churu', password: 'Correct-Pass-1' };
const CSRF_FAILED = { error: 'CSRF_FAILED' };

describe('CSRF', () => {
  it('login without a token, or with a wrong token, is 403 CSRF_FAILED', async () => {
    const agent = request.agent(buildApp(app));
    const noSession = await agent.post('/api/auth/login').send(CREDS);
    expect(noSession.status).toBe(403);
    expect(noSession.body).toEqual(CSRF_FAILED);

    const token = await csrfToken(agent);
    const missing = await agent.post('/api/auth/login').send(CREDS);
    expect([missing.status, missing.body]).toEqual([403, CSRF_FAILED]);
    const wrong = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', `${token.slice(0, -2)}xx`)
      .send(CREDS);
    expect([wrong.status, wrong.body]).toEqual([403, CSRF_FAILED]);
    const short = await agent.post('/api/auth/login').set('X-CSRF-Token', 'abc').send(CREDS);
    expect([short.status, short.body]).toEqual([403, CSRF_FAILED]);

    const ok = await agent.post('/api/auth/login').set('X-CSRF-Token', token).send(CREDS);
    expect(ok.status).toBe(200);
  });

  it('a token from another session is rejected', async () => {
    const appUnderTest = buildApp(app);
    const otherToken = await csrfToken(request.agent(appUnderTest));
    const agent = request.agent(appUnderTest);
    await csrfToken(agent);
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', otherToken).send(CREDS);
    expect(res.status).toBe(403);
  });

  it('the token rotates on login and on logout', async () => {
    const agent = request.agent(buildApp(app));
    const beforeLogin = await csrfToken(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', beforeLogin).send(CREDS);
    const afterLogin = await csrfToken(agent);
    expect(afterLogin).not.toBe(beforeLogin);

    // The pre-login token no longer works for logout.
    const stale = await agent.post('/api/auth/logout').set('X-CSRF-Token', beforeLogin).send();
    expect([stale.status, stale.body]).toEqual([403, CSRF_FAILED]);
    expect(
      (await agent.post('/api/auth/logout').set('X-CSRF-Token', afterLogin).send()).status,
    ).toBe(204);

    const afterLogout = await csrfToken(agent);
    expect(afterLogout).not.toBe(afterLogin);
    expect(
      (await agent.post('/api/auth/logout').set('X-CSRF-Token', afterLogin).send()).status,
    ).toBe(403);
  });

  it('logout needs the token too', async () => {
    const agent = request.agent(buildApp(app));
    await login(agent, 'ro_churu', 'Correct-Pass-1');
    const res = await agent.post('/api/auth/logout').send();
    expect([res.status, res.body]).toEqual([403, CSRF_FAILED]);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('Origin check', () => {
  it('a state-changing request with a foreign Origin is 403', async () => {
    const agent = request.agent(buildApp(app));
    const token = await csrfToken(agent);
    for (const origin of [
      'https://evil.example',
      'null',
      `${TEST_ORIGIN}.evil.example`,
      'http://localhost:3000',
    ]) {
      const res = await agent
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .send(CREDS);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'ORIGIN_REJECTED' });
    }
  });

  it('our own Origin, or no Origin, is accepted; GET is never origin-checked', async () => {
    const agent = request.agent(buildApp(app));
    const token = await csrfToken(agent);
    const ok = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', token)
      .send(CREDS);
    expect(ok.status).toBe(200);
    const get = await agent.get('/api/auth/me').set('Origin', 'https://evil.example');
    expect(get.status).toBe(200);
  });

  it('never adds CORS headers', async () => {
    const res = await request(buildApp(app))
      .get('/api/auth/csrf')
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(buildApp(app))
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });
});
