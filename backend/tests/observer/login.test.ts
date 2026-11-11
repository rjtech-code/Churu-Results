// Observer logins get the same hardening as every other account: generic errors, failure counting,
// lockout, session regeneration, and audit rows for every login and every download.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_LOGINS } from '../../src/modules/auth/auth.service.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';

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
  await seedTwoPs(pool);
  await createUser(pool, { username: 'obs_login', role: 'OBSERVER', password: 'Pass-word-1' });
});

async function auditRows(action: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT user_id, action, new_value FROM audit_log WHERE action = ? ORDER BY id',
    [action],
  );
  return rows;
}

describe('observer login', () => {
  it('a successful login is audited with the OBSERVER role and /me shows it', async () => {
    const agent = request.agent(buildApp(pool));
    const res = await login(agent, 'obs_login', 'Pass-word-1');
    expect(res.status).toBe(200);
    expect((res.body as { role: string }).role).toBe('OBSERVER');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect((me.body as { role: string }).role).toBe('OBSERVER');
    const rows = await auditRows('LOGIN_SUCCESS');
    expect(rows.length).toBe(1);
    expect((rows[0]?.new_value as { role?: string }).role).toBe('OBSERVER');
  });

  it('wrong passwords give the generic error, are audited and lock the account', async () => {
    const app = buildApp(pool);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      const res = await login(request.agent(app), 'obs_login', 'Wrong-pass-9');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'INVALID_CREDENTIALS' });
    }
    expect((await auditRows('LOGIN_FAILED')).length).toBe(MAX_FAILED_LOGINS);
    expect((await auditRows('ACCOUNT_LOCKED')).length).toBe(1);
    const locked = await login(request.agent(app), 'obs_login', 'Pass-word-1');
    expect(locked.status).toBe(423);
  });

  it('every download is audited with the observer user id', async () => {
    const agent = request.agent(buildApp(pool));
    expect((await login(agent, 'obs_login', 'Pass-word-1')).status).toBe(200);
    expect((await agent.get('/api/observer/reports/counting-status.pdf')).status).toBe(200);
    expect((await agent.get('/api/observer/reports/counting-status/wards.csv')).status).toBe(200);
    const rows = await auditRows('REPORT_EXPORTED');
    expect(rows.length).toBe(2);
    const [[user]] = (await pool.execute(
      "SELECT id FROM users WHERE username = 'obs_login'",
    )) as unknown as [{ id: number }[]];
    for (const row of rows) {
      expect(Number(row.user_id)).toBe(Number(user?.id));
      expect((row.new_value as { section?: string }).section).toBe('observer-counting-status');
    }
  });
});
