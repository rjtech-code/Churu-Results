// Rate limits. At the counting venue the whole staff shares ONE public IP, so every limit that
// protects a person is counted per person: the login limit per USERNAME, the dashboard limit per
// LOGGED-IN USER. The per-IP limits stay as flood ceilings, high enough that normal work never
// reaches them. The per-account lockout (5 wrong passwords = 15 minutes) is untouched.
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildApp, createUser, csrfToken, login, seedTwoPs } from './helpers.js';

let app: Pool;
let migrator: Pool;
let ps1: number;
let ps2: number;

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
  ({ ps1, ps2 } = await seedTwoPs(app));
  // Two officers on DIFFERENT seats (one active login per seat), both on the venue's one IP.
  await createUser(app, {
    username: 'ro_churu',
    role: 'PS_RO',
    psId: ps1,
    password: 'Correct-Pass-1',
  });
  await createUser(app, {
    username: 'ro_other',
    role: 'PS_RO',
    psId: ps2,
    password: 'Correct-Pass-1',
  });
});

const TOO_MANY = { error: 'TOO_MANY_REQUESTS', limiter: 'api-per-user' };
const TOO_MANY_IP = { error: 'TOO_MANY_REQUESTS_HERE', limiter: 'api-per-ip' };
const TOO_MANY_LOGIN = { error: 'TOO_MANY_LOGIN_ATTEMPTS', limiter: 'login-per-user' };
const TOO_MANY_LOGIN_IP = { error: 'TOO_MANY_LOGIN_ATTEMPTS_HERE', limiter: 'login-per-ip' };
/** One login attempt with its own agent, so every request is a fresh "browser" on the same IP. */
async function attempt(express: ReturnType<typeof buildApp>, username: string, password: string) {
  const agent = request.agent(express);
  const token = await csrfToken(agent);
  return agent.post('/api/auth/login').set('X-CSRF-Token', token).send({ username, password });
}

describe('login: counted per username', () => {
  it('one officer spending their own budget does not block another officer on the same IP', async () => {
    const express = buildApp(app, {
      loginRateLimit: {
        perUser: { limit: 3, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    // Three wrong attempts for one username: its own counter is now full.
    for (let i = 0; i < 3; i++) {
      expect([401, 423]).toContain(
        (await attempt(express, 'ro_churu', `wrong-${String(i)}`)).status,
      );
    }
    const blocked = await attempt(express, 'ro_churu', 'Correct-Pass-1');
    // The answer names the limiter, so the DM knows their unlock button clears this one.
    expect([blocked.status, blocked.body]).toEqual([429, TOO_MANY_LOGIN]);

    // The other officer, same IP, same moment: unaffected, and the right password works.
    expect((await attempt(express, 'ro_other', 'Correct-Pass-1')).status).toBe(200);
  });

  it('a login that WORKS costs nothing: only failures are counted', async () => {
    const express = buildApp(app, {
      loginRateLimit: {
        perUser: { limit: 2, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    // Signing in again and again (an idle session expired, the browser was closed, another device)
    // never fills the counter.
    for (let i = 0; i < 6; i++) {
      expect(
        (await attempt(express, 'ro_churu', 'Correct-Pass-1')).status,
        `try ${String(i)}`,
      ).toBe(200);
    }
    // The two failures that follow are still counted, and the third is refused.
    for (let i = 0; i < 2; i++) {
      expect((await attempt(express, 'ro_churu', `wrong-${String(i)}`)).status).toBe(401);
    }
    const refused = await attempt(express, 'ro_churu', 'wrong-again');
    expect([refused.status, refused.body]).toEqual([429, TOO_MANY_LOGIN]);
  });

  it('a malformed body counts too (it cannot be used to probe for free)', async () => {
    const express = buildApp(app, {
      loginRateLimit: {
        perUser: { limit: 2, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    for (let i = 0; i < 2; i++) {
      const agent = request.agent(express);
      const token = await csrfToken(agent);
      const bad = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .send({ username: 'ro_churu' });
      expect(bad.status).toBe(400);
    }
    const refused = await attempt(express, 'ro_churu', 'Correct-Pass-1');
    expect([refused.status, refused.body]).toEqual([429, TOO_MANY_LOGIN]);
  });

  it('the per-IP ceiling still stops a flood, whatever usernames it claims', async () => {
    const express = buildApp(app, {
      loginRateLimit: {
        perUser: { limit: 1000, windowMs: 60_000 },
        perIp: { limit: 4, windowMs: 60_000 },
      },
    });
    for (let i = 0; i < 4; i++) {
      await attempt(express, `made_up_${String(i)}`, 'whatever');
    }
    const blocked = await attempt(express, 'ro_churu', 'Correct-Pass-1');
    // A venue-wide ceiling: its own code, because no unlock button can clear it.
    expect([blocked.status, blocked.body]).toEqual([429, TOO_MANY_LOGIN_IP]);
  });

  it('the account lockout is unchanged: 5 wrong passwords close the account itself', async () => {
    const express = buildApp(app, {
      loginRateLimit: {
        perUser: { limit: 1000, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    for (let i = 0; i < 5; i++) {
      expect((await attempt(express, 'ro_churu', `wrong-${String(i)}`)).status).toBe(401);
    }
    // Not 429 (no limit was reached) but 423: the DATABASE lock, exactly as before.
    expect((await attempt(express, 'ro_churu', 'Correct-Pass-1')).status).toBe(423);
  });
});

describe('the dashboard: counted per logged-in user', () => {
  it("one officer's requests never spend another officer's budget", async () => {
    const express = buildApp(app, {
      apiRateLimit: {
        perUser: { limit: 4, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    const one = request.agent(express);
    const two = request.agent(express);
    expect((await login(one, 'ro_churu', 'Correct-Pass-1')).status).toBe(200);
    expect((await login(two, 'ro_other', 'Correct-Pass-1')).status).toBe(200);

    // The first officer spends their own budget.
    for (let i = 0; i < 4; i++) expect((await one.get('/api/auth/me')).status).toBe(200);
    const blocked = await one.get('/api/auth/me');
    expect([blocked.status, blocked.body]).toEqual([429, TOO_MANY]);

    // The second officer, same IP, is untouched.
    expect((await two.get('/api/auth/me')).status).toBe(200);
  });

  it('anonymous traffic is still counted per IP', async () => {
    const express = buildApp(app, {
      apiRateLimit: {
        perUser: { limit: 3, windowMs: 60_000 },
        perIp: { limit: 1000, windowMs: 60_000 },
      },
    });
    // No session: these count against the IP's own key in the same (per-user) limiter.
    for (let i = 0; i < 3; i++)
      expect((await request(express).get('/api/auth/me')).status).toBe(401);
    expect((await request(express).get('/api/auth/me')).status).toBe(429);
  });

  it('the per-IP ceiling applies to every API route, and never to /api/health', async () => {
    const express = buildApp(app, {
      apiRateLimit: {
        perUser: { limit: 1000, windowMs: 60_000 },
        perIp: { limit: 5, windowMs: 60_000 },
      },
    });
    for (let i = 0; i < 5; i++)
      expect((await request(express).get('/api/auth/me')).status).toBe(401);
    const blocked = await request(express).get('/api/auth/me');
    expect([blocked.status, blocked.body]).toEqual([429, TOO_MANY_IP]);
    expect((await request(express).get('/api/nope')).status).toBe(429);
    for (let i = 0; i < 10; i++)
      expect((await request(express).get('/api/health')).status).toBe(200);
  });
});

describe('the defaults, and the environment variables that change them', () => {
  it('ship as 10 logins per username / 200 per IP per 15 min, 300 and 3000 API requests per minute', async () => {
    const { LOGIN_RATE_LIMIT, API_RATE_LIMIT } = await import('../../src/config/app-config.js');
    expect(LOGIN_RATE_LIMIT).toEqual({
      perUser: { limit: 10, windowMs: 15 * 60_000 },
      perIp: { limit: 200, windowMs: 15 * 60_000 },
    });
    expect(API_RATE_LIMIT).toEqual({
      perUser: { limit: 300, windowMs: 60_000 },
      perIp: { limit: 3000, windowMs: 60_000 },
    });
  });

  it('every limit can be raised from .env without a code change', async () => {
    const { appEnvSchema } = await import('../../src/config/env.js');
    const { appConfigFromEnv } = await import('../../src/config/app-config.js');
    const base = {
      NODE_ENV: 'production',
      PORT: '3000',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_NAME: 'churu',
      DB_APP_USER: 'churu_app',
      DB_APP_PASSWORD: 'x'.repeat(16),
      SESSION_SECRET: 's'.repeat(32),
      APP_ORIGIN: 'https://results.example.in',
      RO_PASSWORD_KEY: Buffer.alloc(32, 7).toString('base64'),
    };
    const defaults = appConfigFromEnv(appEnvSchema.parse(base));
    expect(defaults.loginRateLimit.perUser.limit).toBe(10);
    expect(defaults.apiRateLimit.perIp.limit).toBe(3000);

    const raised = appConfigFromEnv(
      appEnvSchema.parse({
        ...base,
        LOGIN_LIMIT_PER_USER: '40',
        LOGIN_LIMIT_PER_IP: '900',
        LOGIN_WINDOW_MINUTES: '30',
        API_LIMIT_PER_USER_PER_MIN: '1200',
        API_LIMIT_PER_IP_PER_MIN: '9000',
      }),
    );
    expect(raised.loginRateLimit).toEqual({
      perUser: { limit: 40, windowMs: 30 * 60_000 },
      perIp: { limit: 900, windowMs: 30 * 60_000 },
    });
    expect(raised.apiRateLimit).toEqual({
      perUser: { limit: 1200, windowMs: 60_000 },
      perIp: { limit: 9000, windowMs: 60_000 },
    });
  });
});
