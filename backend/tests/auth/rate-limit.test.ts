import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildApp, createUser, csrfToken, seedTwoPs } from './helpers.js';

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

const TOO_MANY = { error: 'TOO_MANY_REQUESTS' };

describe('rate limits', () => {
  it('the 21st login attempt from one IP in 15 minutes gets 429 (malformed bodies count too)', async () => {
    const agent = request.agent(buildApp(app));
    const token = await csrfToken(agent);
    for (let i = 0; i < 10; i++) {
      const bad = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .send({ username: 'X' });
      expect(bad.status).toBe(400);
    }
    for (let i = 0; i < 10; i++) {
      const wrong = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .send({ username: 'ro_churu', password: `wrong-${i}` });
      expect([401, 423]).toContain(wrong.status);
    }
    const blocked = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ username: 'ro_churu', password: 'Correct-Pass-1' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(TOO_MANY);
    // Other API calls are still allowed.
    expect((await agent.get('/api/auth/csrf')).status).toBe(200);
  });

  it('the global /api limit applies to every API route but never to /api/health', async () => {
    const appUnderTest = buildApp(app, { apiRateLimit: { limit: 5, windowMs: 60_000 } });
    for (let i = 0; i < 5; i++)
      expect((await request(appUnderTest).get('/api/auth/me')).status).toBe(401);
    const blocked = await request(appUnderTest).get('/api/auth/me');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(TOO_MANY);
    expect((await request(appUnderTest).get('/api/nope')).status).toBe(429);
    for (let i = 0; i < 10; i++)
      expect((await request(appUnderTest).get('/api/health')).status).toBe(200);
  });

  it('the production defaults are 20 logins / 15 min and 600 API requests / min', async () => {
    const { LOGIN_RATE_LIMIT, API_RATE_LIMIT } = await import('../../src/config/app-config.js');
    expect(LOGIN_RATE_LIMIT).toEqual({ limit: 20, windowMs: 15 * 60_000 });
    expect(API_RATE_LIMIT).toEqual({ limit: 600, windowMs: 60_000 });
  });
});
