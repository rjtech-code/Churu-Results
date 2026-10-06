import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildApp,
  createUser,
  csrfToken,
  login,
  logout,
  seedTwoPs,
  sessionIdFrom,
  sleep,
} from './helpers.js';

let app: Pool;
let migrator: Pool;
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
  const { ps1 } = await seedTwoPs(app);
  roId = await createUser(app, {
    username: 'ro_churu',
    role: 'PS_RO',
    psId: ps1,
    password: 'Secret-Pass-77',
  });
});

async function auditRows(): Promise<RowDataPacket[]> {
  const [rows] = await app.query<RowDataPacket[]>('SELECT * FROM audit_log ORDER BY id');
  return rows;
}

describe('auth audit trail', () => {
  it('records every auth event with IP and never a password, hash, session id or CSRF token', async () => {
    const appUnderTest = buildApp(app, { sessionAbsoluteMs: 1_500 });
    const secrets: string[] = ['Secret-Pass-77', 'Wrong-Pass-1', 'Wrong-Pass-2', '$2b$'];

    // LOGIN_FAILED (unknown user)
    await login(request.agent(appUnderTest), 'ghost_user', 'Wrong-Pass-1');
    // LOGIN_SUCCESS + LOGOUT, capturing session ids and tokens
    const agent = request.agent(appUnderTest);
    const pre = await agent.get('/api/auth/csrf');
    secrets.push((pre.body as { csrfToken: string }).csrfToken, sessionIdFrom(pre) ?? 'x');
    const ok = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', (pre.body as { csrfToken: string }).csrfToken)
      .send({ username: 'ro_churu', password: 'Secret-Pass-77' });
    secrets.push(sessionIdFrom(ok) ?? 'x', await csrfToken(agent));
    await logout(agent);
    // SESSION_EXPIRED_ABSOLUTE
    const expiring = request.agent(appUnderTest);
    await login(expiring, 'ro_churu', 'Secret-Pass-77');
    await sleep(1_800);
    expect((await expiring.get('/api/auth/me')).body).toEqual({ error: 'SESSION_EXPIRED' });
    // LOGIN_FAILED x5 with ACCOUNT_LOCKED, then a locked attempt
    for (let i = 0; i < 5; i++)
      await login(request.agent(appUnderTest), 'ro_churu', 'Wrong-Pass-2');
    await login(request.agent(appUnderTest), 'ro_churu', 'Secret-Pass-77');

    const rows = await auditRows();
    const summary = rows.map((r) => [
      String(r.action),
      r.user_id === null ? null : Number(r.user_id),
      (r.new_value as { note?: string } | null)?.note ?? null,
    ]);
    expect(summary).toEqual([
      ['LOGIN_FAILED', null, 'unknown user'],
      ['LOGIN_SUCCESS', roId, null],
      ['LOGOUT', roId, null],
      ['LOGIN_SUCCESS', roId, null],
      ['SESSION_EXPIRED_ABSOLUTE', roId, null],
      ['LOGIN_FAILED', roId, 'wrong password'],
      ['LOGIN_FAILED', roId, 'wrong password'],
      ['LOGIN_FAILED', roId, 'wrong password'],
      ['LOGIN_FAILED', roId, 'wrong password'],
      ['LOGIN_FAILED', roId, 'wrong password'],
      ['ACCOUNT_LOCKED', roId, null],
      ['LOGIN_FAILED', roId, 'locked'],
    ]);
    for (const r of rows) expect(r.ip, String(r.action)).toMatch(/127\.0\.0\.1|::1/);
    expect(rows[0]?.new_value).toEqual({ username: 'ghost_user', note: 'unknown user' });

    const text = JSON.stringify(rows);
    for (const secret of secrets) expect(text).not.toContain(secret);
    const [hash] = await app.execute<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [roId],
    );
    expect(text).not.toContain(String(hash[0]?.password_hash));
  });

  it('a malformed login body writes no audit row', async () => {
    const agent = request.agent(buildApp(app));
    const token = await csrfToken(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', token).send({ username: 'Bad Name!' });
    expect(await auditRows()).toEqual([]);
  });
});
