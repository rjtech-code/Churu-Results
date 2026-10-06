import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildApp,
  createUser,
  csrfToken,
  login,
  seedTwoPs,
  sessionIdFrom,
  sessionSetCookie,
} from './helpers.js';

let app: Pool;
let migrator: Pool;
let ps1: number;
let roId: number;

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
  ({ ps1 } = await seedTwoPs(app));
  roId = await createUser(app, {
    username: 'ro_churu',
    role: 'PS_RO',
    psId: ps1,
    password: 'Correct-Pass-1',
  });
  await createUser(app, {
    username: 'dm_off',
    role: 'DM',
    password: 'Correct-Pass-1',
    active: false,
  });
});

async function userRow() {
  const [rows] = await app.execute<RowDataPacket[]>(
    'SELECT failed_login_count, locked_until IS NOT NULL AS locked, last_login_at IS NOT NULL AS logged_in FROM users WHERE id = ?',
    [roId],
  );
  const r = rows[0];
  return {
    failed: Number(r?.failed_login_count),
    locked: Number(r?.locked),
    loggedIn: Number(r?.logged_in),
  };
}

const INVALID = { error: 'INVALID_CREDENTIALS' };

describe('POST /api/auth/login', () => {
  it('succeeds with the /me body and a HttpOnly, SameSite=Strict churu.sid cookie', async () => {
    const agent = request.agent(buildApp(app));
    const res = await login(agent, 'ro_churu', 'Correct-Pass-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: roId,
      username: 'ro_churu',
      fullName: 'Full ro_churu',
      role: 'PS_RO',
      panchayatSamiti: { id: ps1, name: 'पंचायत समिति चूरू' },
    });
    const cookie = sessionSetCookie(res) ?? '';
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Strict/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).not.toMatch(/; Secure/); // not production
    expect((await agent.get('/api/auth/me')).body).toEqual(res.body);
    expect(await userRow()).toEqual({ failed: 0, locked: 0, loggedIn: 1 });
  });

  it('sets the Secure flag in production (behind an HTTPS proxy)', async () => {
    // supertest's cookie jar never sends Secure cookies over plain http, so pass the cookie by hand.
    const prodApp = buildApp(app, { production: true, trustProxy: 1 });
    const csrf = await request(prodApp).get('/api/auth/csrf').set('X-Forwarded-Proto', 'https');
    expect(sessionSetCookie(csrf)).toMatch(/; Secure/);
    const cookie = (sessionSetCookie(csrf) ?? '').split(';')[0] ?? '';
    const res = await request(prodApp)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', (csrf.body as { csrfToken: string }).csrfToken)
      .send({ username: 'ro_churu', password: 'Correct-Pass-1' });
    expect(res.status).toBe(200);
    expect(sessionSetCookie(res)).toMatch(/; HttpOnly; Secure; SameSite=Strict$/);
  });

  it('wrong password, unknown user and disabled user get the identical 401', async () => {
    const results = [];
    for (const [username, password] of [
      ['ro_churu', 'wrong-password'],
      ['nobody_here', 'Correct-Pass-1'],
      ['dm_off', 'Correct-Pass-1'], // disabled, correct password
    ] as const) {
      const agent = request.agent(buildApp(app));
      const before = sessionIdFrom(await agent.get('/api/auth/csrf'));
      const res = await login(agent, username, password);
      // Rolling sessions refresh the existing cookie on every response, but no new session is issued.
      const sessionAfter = sessionIdFrom(res) ?? before;
      results.push({
        status: res.status,
        body: res.body as unknown,
        newSession: sessionAfter !== before,
      });
    }
    for (const r of results) expect(r).toEqual({ status: 401, body: INVALID, newSession: false });
  });

  it('rejects malformed bodies with 400 VALIDATION_FAILED', async () => {
    const agent = request.agent(buildApp(app));
    const token = await csrfToken(agent);
    for (const body of [
      {},
      { username: 'ro_churu' },
      { username: 'RO_CHURU', password: 'x' },
      { username: 'abc', password: 'x' },
      { username: 'ro_churu', password: '' },
      { username: 'ro_churu', password: 'x'.repeat(129) },
      { username: 'ro_churu', password: 'x', extra: 1 },
    ]) {
      const res = await agent.post('/api/auth/login').set('X-CSRF-Token', token).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'VALIDATION_FAILED' });
    }
  });

  it('counts wrong passwords and resets the counter on success', async () => {
    const appUnderTest = buildApp(app);
    await login(request.agent(appUnderTest), 'ro_churu', 'wrong-1');
    await login(request.agent(appUnderTest), 'ro_churu', 'wrong-2');
    expect((await userRow()).failed).toBe(2);
    expect((await login(request.agent(appUnderTest), 'ro_churu', 'Correct-Pass-1')).status).toBe(
      200,
    );
    expect((await userRow()).failed).toBe(0);
  });

  it('5 wrong passwords lock the account; during the lock every attempt gets 423 without checking the password', async () => {
    const appUnderTest = buildApp(app);
    for (let i = 1; i <= 5; i++) {
      const res = await login(request.agent(appUnderTest), 'ro_churu', `wrong-${i}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID);
    }
    expect(await userRow()).toEqual({ failed: 0, locked: 1, loggedIn: 0 }); // counter reset when lock starts

    for (const password of ['wrong-again', 'Correct-Pass-1']) {
      const res = await login(request.agent(appUnderTest), 'ro_churu', password);
      expect(res.status).toBe(423);
      expect(res.body).toEqual({
        error: 'ACCOUNT_LOCKED',
        retryAfterSeconds: expect.any(Number) as unknown,
      });
      const retry = (res.body as { retryAfterSeconds: number }).retryAfterSeconds;
      expect(retry).toBeGreaterThan(14 * 60);
      expect(retry).toBeLessThanOrEqual(15 * 60);
    }
    // Attempts during the lock do not extend it and do not count.
    expect((await userRow()).failed).toBe(0);

    // Lock expires (move locked_until into the past): the correct password works and resets everything.
    await app.execute('UPDATE users SET locked_until = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [
      roId,
    ]);
    expect((await login(request.agent(appUnderTest), 'ro_churu', 'Correct-Pass-1')).status).toBe(
      200,
    );
    const [rows] = await app.execute<RowDataPacket[]>(
      'SELECT failed_login_count, locked_until FROM users WHERE id = ?',
      [roId],
    );
    expect(rows).toEqual([{ failed_login_count: 0, locked_until: null }]);
  });

  it('the lock does not extend while attempts continue', async () => {
    const appUnderTest = buildApp(app);
    for (let i = 0; i < 5; i++) await login(request.agent(appUnderTest), 'ro_churu', 'wrong');
    const [before] = await app.execute<RowDataPacket[]>(
      'SELECT locked_until FROM users WHERE id = ?',
      [roId],
    );
    for (let i = 0; i < 3; i++) await login(request.agent(appUnderTest), 'ro_churu', 'wrong');
    const [after] = await app.execute<RowDataPacket[]>(
      'SELECT locked_until FROM users WHERE id = ?',
      [roId],
    );
    expect(after).toEqual(before);
  });

  it('unknown usernames always get 401, never 423', async () => {
    const appUnderTest = buildApp(app);
    for (let i = 0; i < 6; i++) {
      const res = await login(request.agent(appUnderTest), 'ghost_user', 'whatever');
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID);
    }
  });
});
