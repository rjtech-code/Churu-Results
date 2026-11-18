// "RO लॉगिन खोलें" (Nov 2026): the DM opens a counting login that the five-wrong-password lockout
// has closed — on counting day the officer is standing in front of them, and nobody should need a
// terminal. It UNLOCKS only: the officer's own password is never read, changed or shown.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from '../../src/modules/auth/auth.service.js';
import { createUser, login } from '../auth/helpers.js';
import { apiClient, buildAdminWorld } from '../admin/helpers.js';
import type { ApiClient } from '../admin/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';

interface LockedAccount {
  id: number;
  username: string;
  role: string;
  psName: string | null;
  locked: boolean;
  failedLogins: number;
  lockedSince: string | null;
  lockedUntil: string | null;
}

let pool: Pool;
let migrator: Pool;
let app: Express;
let dm: ApiClient;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  app = countingApp(pool, {
    loginRateLimit: {
      perUser: { limit: 10_000, windowMs: 60_000 },
      perIp: { limit: 10_000, windowMs: 60_000 },
    },
  });
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  await buildAdminWorld(pool);
  dm = await apiClient(app, 'dm_x4', PASSWORD);
});

const locked = async (client: ApiClient = dm): Promise<LockedAccount[]> => {
  const res = await client.get('/api/admin/users/locked');
  expect(res.status).toBe(200);
  return (res.body as { accounts: LockedAccount[] }).accounts;
};
const userRow = async (username: string) => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, password_hash, failed_login_count,
            (locked_until IS NOT NULL AND locked_until > NOW(3)) AS locked_now
       FROM users WHERE username = ?`,
    [username],
  );
  const r = rows[0];
  if (r === undefined) throw new Error(`no user ${username}`);
  return {
    id: Number(r.id),
    hash: String(r.password_hash),
    failed: Number(r.failed_login_count),
    locked: Number(r.locked_now) === 1,
  };
};
/** Locks an account the way the real thing does: wrong passwords until it closes. */
const lockOut = async (username: string) => {
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
    await login(request.agent(app), username, 'Wrong-Password-1');
  }
  expect((await userRow(username)).locked).toBe(true);
};

describe('the list', () => {
  it('is empty when nothing is locked, and says nothing is', async () => {
    expect(await locked()).toEqual([]);
  });

  it('names the officer, the seat, since when and until when', async () => {
    await lockOut('ro_ps1_x1');
    const rows = await locked();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ username: 'ro_ps1_x1', role: 'PS_RO', locked: true });
    expect(row?.psName).toBeTruthy();
    const since = Date.parse(row?.lockedSince ?? '');
    const until = Date.parse(row?.lockedUntil ?? '');
    expect(until - since).toBe(LOCK_MINUTES * 60_000);
    expect(until).toBeGreaterThan(Date.now());
  });

  it('also shows an account that has failed attempts but is not locked yet', async () => {
    await login(request.agent(app), 'ro_ps1_x1', 'Wrong-Password-1');
    const rows = await locked();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ locked: false, failedLogins: 1 });
  });
});

describe('unlocking', () => {
  it('lets the officer log in again at once, with the SAME password', async () => {
    await lockOut('ro_ps1_x1');
    // While locked the right password is refused (423 ACCOUNT_LOCKED: the password is not even
    // checked).
    expect((await login(request.agent(app), 'ro_ps1_x1', PASSWORD)).status).toBe(423);
    const before = await userRow('ro_ps1_x1');

    const res = await dm.post(`/api/admin/users/${String(before.id)}/unlock`, {
      password: PASSWORD,
    });
    expect(res.status).toBe(200);

    const after = await userRow('ro_ps1_x1');
    expect([after.locked, after.failed]).toEqual([false, 0]);
    // The password itself was never touched — same hash, and it works.
    expect(after.hash).toBe(before.hash);
    expect((await login(request.agent(app), 'ro_ps1_x1', PASSWORD)).status).toBe(200);
    expect(await locked()).toEqual([]);
  });

  it('writes one audit row naming who was unlocked and by whom', async () => {
    await lockOut('ro_ps1_x1');
    const row = await userRow('ro_ps1_x1');
    await dm.post(`/api/admin/users/${String(row.id)}/unlock`, { password: PASSWORD });
    const [audits] = await pool.execute<RowDataPacket[]>(
      "SELECT user_id, entity_id, old_value, new_value FROM audit_log WHERE action = 'USER_UNLOCKED'",
    );
    expect(audits).toHaveLength(1);
    expect(Number(audits[0]?.entity_id)).toBe(row.id);
    expect(audits[0]?.new_value).toMatchObject({ username: 'ro_ps1_x1', via: 'web' });
    // At the moment of the lock the counter is zeroed and locked_until is set, so that is what the
    // row carries as the "before".
    expect(audits[0]?.old_value).toMatchObject({ failed_login_count: 0 });
    expect((audits[0]?.old_value as { locked_until: string }).locked_until).toBeTruthy();
    expect(Number(audits[0]?.user_id)).toBeGreaterThan(0);
  });

  it('the DM password is still required, and nothing is unlocked without it', async () => {
    await lockOut('ro_ps1_x1');
    const row = await userRow('ro_ps1_x1');
    expect(
      (await dm.post(`/api/admin/users/${String(row.id)}/unlock`, { password: 'Wrong-Password-1' }))
        .status,
    ).toBe(401);
    expect((await userRow('ro_ps1_x1')).locked).toBe(true);
  });

  it('an account with nothing to clear is 409', async () => {
    const row = await userRow('ro_ps1_x1');
    const res = await dm.post(`/api/admin/users/${String(row.id)}/unlock`, { password: PASSWORD });
    expect([res.status, (res.body as { error?: string }).error]).toEqual([409, 'NO_CHANGE']);
  });
});

describe('who may use it', () => {
  it('DM only: an RO and the Super Admin are refused, for reading and for unlocking', async () => {
    await lockOut('ro_ps2_x2');
    const target = await userRow('ro_ps2_x2');
    await createUser(pool, { username: 'sa_ul', role: 'SUPER_ADMIN', password: PASSWORD });

    const ro = await apiClient(app, 'ro_ps1_x1', PASSWORD);
    expect((await ro.get('/api/admin/users/locked')).status).toBe(403);
    expect(
      (await ro.post(`/api/admin/users/${String(target.id)}/unlock`, { password: PASSWORD }))
        .status,
    ).toBe(403);

    const sa = await apiClient(app, 'sa_ul', PASSWORD);
    expect((await sa.get('/api/admin/users/locked')).status).toBe(403);
    expect(
      (await sa.post(`/api/admin/users/${String(target.id)}/unlock`, { password: PASSWORD }))
        .status,
    ).toBe(403);

    expect((await userRow('ro_ps2_x2')).locked).toBe(true);
  });
});

/**
 * The button must clear BOTH things that refuse an officer: the database lock, and that officer's
 * own rate-limit counters. Without the second one it would look like it worked and the officer
 * would keep getting 429 until the window ran out.
 */
describe('it clears the rate-limit counters too', () => {
  it('an officer at 429 can log in again the moment the DM unlocks them', async () => {
    // Its own app, so the per-username counter is small enough to reach in a test. Six failures:
    // the account locks at five, and the counter is full at six.
    const strict = countingApp(pool, {
      loginRateLimit: {
        perUser: { limit: 6, windowMs: 15 * 60_000 },
        perIp: { limit: 10_000, windowMs: 60_000 },
      },
    });
    const strictDm = await apiClient(strict, 'dm_x4', PASSWORD);
    for (let i = 0; i < 6; i++) {
      await login(request.agent(strict), 'ro_ps1_x1', `Wrong-Password-${String(i)}`);
    }
    const row = await userRow('ro_ps1_x1');
    expect(row.locked).toBe(true);

    // Now BOTH refuse: the counter answers first, and says which limiter it was.
    const refused = await login(request.agent(strict), 'ro_ps1_x1', PASSWORD);
    expect([refused.status, refused.body]).toEqual([
      429,
      { error: 'TOO_MANY_LOGIN_ATTEMPTS', limiter: 'login-per-user' },
    ]);

    expect(
      (await strictDm.post(`/api/admin/users/${String(row.id)}/unlock`, { password: PASSWORD }))
        .status,
    ).toBe(200);

    // Not 429 any more, and not 423 either: the officer is in, with the same password.
    expect((await login(request.agent(strict), 'ro_ps1_x1', PASSWORD)).status).toBe(200);
    // The audit row says the counters were cleared with the lock.
    const [audits] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'USER_UNLOCKED' ORDER BY id DESC LIMIT 1",
    );
    expect(audits[0]?.new_value).toMatchObject({ cleared_rate_limits: true });
  });

  it("another officer's counters are left alone", async () => {
    const strict = countingApp(pool, {
      loginRateLimit: {
        perUser: { limit: 2, windowMs: 15 * 60_000 },
        perIp: { limit: 10_000, windowMs: 60_000 },
      },
    });
    const strictDm = await apiClient(strict, 'dm_x4', PASSWORD);
    // Fill the second officer's counter.
    for (let i = 0; i < 2; i++) {
      await login(request.agent(strict), 'ro_ps2_x2', `Wrong-Password-${String(i)}`);
    }
    expect((await login(request.agent(strict), 'ro_ps2_x2', PASSWORD)).status).toBe(429);

    // Unlock the FIRST officer (give them something to clear first).
    await lockOut('ro_ps1_x1');
    const first = await userRow('ro_ps1_x1');
    expect(
      (await strictDm.post(`/api/admin/users/${String(first.id)}/unlock`, { password: PASSWORD }))
        .status,
    ).toBe(200);

    // The second officer is still refused: their counter was not touched.
    expect((await login(request.agent(strict), 'ro_ps2_x2', PASSWORD)).status).toBe(429);
  });
});
