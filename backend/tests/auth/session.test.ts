import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersSetActive } from '../../scripts/users-set-active.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildApp,
  createUser,
  csrfToken,
  login,
  logout,
  seedTwoPs,
  sessionIdFrom,
  sessionSetCookie,
  sleep,
} from './helpers.js';

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

async function sessionRows(): Promise<number> {
  const [rows] = await app.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM sessions');
  return Number(rows[0]?.n);
}

describe('sessions', () => {
  it('the session id changes on login, and the old id is useless', async () => {
    const appUnderTest = buildApp(app);
    const agent = request.agent(appUnderTest);
    const before = await agent.get('/api/auth/csrf');
    const oldId = sessionIdFrom(before);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', (before.body as { csrfToken: string }).csrfToken)
      .send({ username: 'ro_churu', password: 'Correct-Pass-1' });
    const newId = sessionIdFrom(res);
    expect(oldId).toBeDefined();
    expect(newId).toBeDefined();
    expect(newId).not.toBe(oldId);
    // Replaying the pre-login cookie does not give a logged-in session.
    const oldCookie = (sessionSetCookie(before) ?? '').split(';')[0] ?? '';
    const replay = await request(appUnderTest).get('/api/auth/me').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
  });

  it('logout destroys the session and clears the cookie; /me is then 401', async () => {
    const agent = request.agent(buildApp(app));
    await login(agent, 'ro_churu', 'Correct-Pass-1');
    expect(await sessionRows()).toBe(1);
    const res = await logout(agent);
    expect(res.status).toBe(204);
    expect(sessionSetCookie(res)).toMatch(/^churu\.sid=;.*Expires=Thu, 01 Jan 1970/);
    expect(await sessionRows()).toBe(0);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('GET /me without a session is 401 UNAUTHENTICATED and creates no session', async () => {
    const res = await request(buildApp(app)).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    expect(sessionSetCookie(res)).toBeUndefined();
    expect(await sessionRows()).toBe(0);
  });

  it('the idle timeout ends an unused session; activity keeps it alive (rolling)', async () => {
    const appUnderTest = buildApp(app, { sessionIdleMs: 2_000 });
    const active = request.agent(appUnderTest);
    const idle = request.agent(appUnderTest);
    await login(active, 'ro_churu', 'Correct-Pass-1');
    await login(idle, 'ro_churu', 'Correct-Pass-1');
    for (let i = 0; i < 4; i++) {
      await sleep(900);
      expect((await active.get('/api/auth/me')).status).toBe(200);
    }
    // `idle` made no request for ~3.6 s (> 2 s idle timeout).
    const res = await idle.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('the absolute lifetime ends even an active session with SESSION_EXPIRED, then UNAUTHENTICATED', async () => {
    const agent = request.agent(buildApp(app, { sessionAbsoluteMs: 2_000, sessionIdleMs: 60_000 }));
    await login(agent, 'ro_churu', 'Correct-Pass-1');
    for (let i = 0; i < 3; i++) {
      await sleep(500);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    }
    await sleep(800);
    const expired = await agent.get('/api/auth/me');
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({ error: 'SESSION_EXPIRED' });
    expect(await sessionRows()).toBe(0);
    const after = await agent.get('/api/auth/me');
    expect(after.body).toEqual({ error: 'UNAUTHENTICATED' });
    const [audit] = await app.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'SESSION_EXPIRED_ABSOLUTE'",
    );
    expect(Number(audit[0]?.n)).toBe(1);
  });

  it('disabling the user with npm run users:disable kills access on the very next request', async () => {
    const agent = request.agent(buildApp(app));
    await login(agent, 'ro_churu', 'Correct-Pass-1');
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const result = await runUsersSetActive(
      'disable',
      { username: 'ro_churu', commit: true },
      {
        pool: app,
        reportsDir: join(await mkdtemp(join(tmpdir(), 'churu-auth-')), 'reports'),
        out: () => undefined,
        confirm: () => Promise.resolve(''),
        now: () => new Date(),
      },
    );
    expect(result.ok).toBe(true);

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED' });
    expect(await sessionRows()).toBe(0);
    // A disabled user also cannot log in again.
    expect((await login(request.agent(buildApp(app)), 'ro_churu', 'Correct-Pass-1')).status).toBe(
      401,
    );
  });

  it('CSRF token survives within a session', async () => {
    const agent = request.agent(buildApp(app));
    expect(await csrfToken(agent)).toBe(await csrfToken(agent));
  });
});
