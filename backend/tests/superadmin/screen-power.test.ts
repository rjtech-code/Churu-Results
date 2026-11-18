// The Super Admin panel's control of the three public screens: who may switch one, what the audit
// log keeps, that the three are independent, that switching one ends ONLY that screen's sessions,
// and that the DM has nothing screen-related left at all (Nov 2026).
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readScreensOff } from '../../src/services/setup/screen-power.js';
import { createUser } from '../auth/helpers.js';
import { createKeyDirect, unlock } from '../screen-access/helpers.js';
import { apiClient, buildAdminWorld } from '../admin/helpers.js';
import type { ApiClient } from '../admin/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';

const SA = 'super_admin_sp';
const SA_PASSWORD = 'Super-Admin-Pass-2';

interface ScreenRow {
  screen: '1' | '2' | '3';
  on: boolean;
  lastChange: { at: string; byName: string } | null;
}

let pool: Pool;
let migrator: Pool;
let app: Express;
let sa: ApiClient;

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
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: SA_PASSWORD });
  sa = await apiClient(app, SA, SA_PASSWORD);
});

const overviewScreens = async (): Promise<ScreenRow[]> => {
  const res = await sa.get('/api/superadmin/overview');
  expect(res.status).toBe(200);
  return (res.body as { screens: ScreenRow[] }).screens;
};
const audits = async () => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.action, a.new_value, a.user_id FROM audit_log a
      WHERE a.action IN ('SCREEN_TURNED_ON', 'SCREEN_TURNED_OFF') ORDER BY a.id`,
  );
  return rows;
};

describe('the state', () => {
  it('defaults to all three ON, with no stored setting at all', async () => {
    expect(await readScreensOff(pool)).toEqual([]);
    expect(await overviewScreens()).toEqual([
      { screen: '1', on: true, lastChange: null },
      { screen: '2', on: true, lastChange: null },
      { screen: '3', on: true, lastChange: null },
    ]);
  });
});

describe('switching', () => {
  it('turns one screen off and back on, and the other two never move', async () => {
    expect((await sa.post('/api/superadmin/screens/2', { on: false })).status).toBe(200);
    expect(await readScreensOff(pool)).toEqual(['2']);
    let rows = await overviewScreens();
    expect(rows.map((r) => r.on)).toEqual([true, false, true]);

    expect((await sa.post('/api/superadmin/screens/2', { on: true })).status).toBe(200);
    expect(await readScreensOff(pool)).toEqual([]);
    rows = await overviewScreens();
    expect(rows.map((r) => r.on)).toEqual([true, true, true]);
  });

  it('two screens off at once stay independent of each other', async () => {
    await sa.post('/api/superadmin/screens/1', { on: false });
    await sa.post('/api/superadmin/screens/3', { on: false });
    expect(await readScreensOff(pool)).toEqual(['1', '3']);
    await sa.post('/api/superadmin/screens/1', { on: true });
    expect(await readScreensOff(pool)).toEqual(['3']);
  });

  it('switching to the state it is already in is refused (409), and changes nothing', async () => {
    const res = await sa.post('/api/superadmin/screens/1', { on: true });
    expect([res.status, (res.body as { error?: string }).error]).toEqual([409, 'NO_CHANGE']);
    expect(await readScreensOff(pool)).toEqual([]);
    expect(await audits()).toHaveLength(0);
  });

  it('an unknown screen is 404 and a bad body is 400', async () => {
    expect((await sa.post('/api/superadmin/screens/4', { on: false })).status).toBe(404);
    expect((await sa.post('/api/superadmin/screens/1', { on: 'yes' })).status).toBe(400);
  });
});

describe('the audit log', () => {
  it('keeps one row per switch, with who, when and the state before and after', async () => {
    await sa.post('/api/superadmin/screens/2', { on: false });
    await sa.post('/api/superadmin/screens/2', { on: true });
    const rows = await audits();
    expect(rows.map((r) => String(r.action))).toEqual(['SCREEN_TURNED_OFF', 'SCREEN_TURNED_ON']);
    expect(rows[0]?.new_value).toMatchObject({ screen: '2', screens_off: ['2'] });
    expect(rows[1]?.new_value).toMatchObject({ screen: '2', screens_off: [] });
    // The panel shows the same thing back: who switched it last, and when.
    const state = (await overviewScreens()).find((s) => s.screen === '2');
    expect(state?.on).toBe(true);
    expect(state?.lastChange?.byName).toBeTruthy();
  });
});

describe('who may switch it', () => {
  it('SUPER_ADMIN only: the DM, an RO and a logged-out browser are refused', async () => {
    const dm = await apiClient(app, 'dm_x4', PASSWORD);
    expect((await dm.post('/api/superadmin/screens/1', { on: false })).status).toBe(403);
    const ro = await apiClient(app, 'ro_ps1_x1', PASSWORD);
    expect((await ro.post('/api/superadmin/screens/1', { on: false })).status).toBe(403);
    expect(await readScreensOff(pool)).toEqual([]);
    expect(await audits()).toHaveLength(0);
  });
});

/**
 * Condition of the Nov 2026 change: the DM has NO screen route, page, link or permission left. The
 * keys, the preview and the ON / OFF switch are all the Super Admin's.
 */
describe('the DM has nothing screen-related left', () => {
  it('every screen route is refused for the DM, and nothing changes', async () => {
    await sa.post('/api/superadmin/screens/3', { on: false });
    const dm = await apiClient(app, 'dm_x4', PASSWORD);

    // The old DM pages are gone from the server (no route at all).
    expect((await dm.get('/api/admin/screen-keys')).status).toBe(404);
    for (const path of [
      '/api/admin/screen-keys/create',
      '/api/admin/screen-keys/preview',
      '/api/admin/screen-keys/1/revoke',
      '/api/admin/screen-keys/1/renew',
    ])
      expect([403, 404], path).toContain((await dm.post(path, { label: 'x' })).status);

    // And the new Super Admin routes are 403 for the DM — reads and writes alike.
    expect((await dm.get('/api/superadmin/screen-keys')).status).toBe(403);
    for (const path of [
      '/api/superadmin/screen-keys/create',
      '/api/superadmin/screen-keys/preview/1',
      '/api/superadmin/screen-keys/1/revoke',
      '/api/superadmin/screen-keys/1/renew',
      '/api/superadmin/screens/3',
      '/api/superadmin/screens/clear-lockout',
    ]) {
      const res = await dm.post(path, { label: 'x', expiresAt: null, on: true });
      expect(res.status, path).toBe(403);
      expect(res.headers['set-cookie'] ?? [], path).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^churu\.screen/)]),
      );
    }
    const [keys] = await pool.execute<RowDataPacket[]>('SELECT id FROM screen_key');
    expect(keys).toHaveLength(0);
    expect(await readScreensOff(pool)).toEqual(['3']);
  });

  it('an RO is refused the same way', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1', PASSWORD);
    expect((await ro.get('/api/superadmin/screen-keys')).status).toBe(403);
    expect((await ro.post('/api/superadmin/screen-keys/create', { label: 'x' })).status).toBe(403);
  });
});

/**
 * The switch is what ends a screen's access: off (the access is withdrawn) and on again (so a key
 * typed in between cannot carry over). The other screens' TVs keep running.
 */
describe("switching a screen ends that screen's sessions only", () => {
  const sessions = async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT screen FROM screen_session ORDER BY screen',
    );
    return rows.map((r) => String(r.screen));
  };

  it('off ends them, on ends them again, and 2 and 3 are never touched', async () => {
    const saId = Number(
      (
        await pool.execute<RowDataPacket[]>(
          "SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1",
        )
      )[0][0]?.id,
    );
    const key = await createKeyDirect(pool, saId, { label: 'हॉल' });
    for (const screen of ['1', '2', '3'] as const)
      expect((await unlock(app, key.key, screen)).status).toBe(200);
    expect(await sessions()).toEqual(['1', '2', '3']);

    const off = await sa.post('/api/superadmin/screens/1', { on: false });
    expect(off.status).toBe(200);
    expect((off.body as { sessionsEnded: number }).sessionsEnded).toBe(1);
    expect(await sessions()).toEqual(['2', '3']);

    // A key typed while it is off, then switched on: that session goes too.
    expect((await unlock(app, key.key, '1')).status).toBe(200);
    const on = await sa.post('/api/superadmin/screens/1', { on: true });
    expect([on.status, (on.body as { sessionsEnded: number }).sessionsEnded]).toEqual([200, 1]);
    expect(await sessions()).toEqual(['2', '3']);
  });

  it('the audit row says how many sessions the switch ended', async () => {
    const rows = await audits();
    expect(rows).toHaveLength(0);
    await sa.post('/api/superadmin/screens/2', { on: false });
    const after = await audits();
    expect(after).toHaveLength(1);
    expect(after[0]?.new_value).toMatchObject({ screen: '2', sessionsEnded: 0 });
  });
});

/**
 * The escape hatch: after repeated wrong keys a screen cannot be unlocked for a quarter of an hour,
 * and on counting day that is exactly when it must come back. The panel clears the ATTEMPT COUNTERS
 * and nothing else.
 */
describe('clearing the key-popup lockout', () => {
  const lockoutAudit = async (screen: string, minutesAgo: number, lastsMinutes: number) => {
    await pool.execute(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, new_value, ip, created_at)
       VALUES (NULL, 'SCREEN_UNLOCK_LOCKED_OUT', 'screen_key', NULL, ?, '10.0.0.9',
               NOW(3) - INTERVAL ? MINUTE)`,
      [
        JSON.stringify({
          failures: 10,
          windowMinutes: 15,
          screen,
          until: new Date(Date.now() + (lastsMinutes - minutesAgo) * 60_000).toISOString(),
        }),
        minutesAgo,
      ],
    );
  };
  const overview = async () => {
    const res = await sa.get('/api/superadmin/overview');
    expect(res.status).toBe(200);
    return res.body as { screenLockouts: { screen: string; until: string }[] };
  };

  it('with nothing locked out the panel has nothing to show', async () => {
    expect((await overview()).screenLockouts).toEqual([]);
  });

  it('shows WHICH screen is locked out and until when; an expired one is not shown', async () => {
    await lockoutAudit('1', 2, 15);
    await lockoutAudit('3', 30, 15); // over long ago
    const { screenLockouts } = await overview();
    expect(screenLockouts.map((l) => l.screen)).toEqual(['1']);
    expect(Date.parse(screenLockouts[0]?.until ?? '')).toBeGreaterThan(Date.now());
  });

  it('clears it, audits what was in effect, and touches nothing else', async () => {
    await lockoutAudit('2', 1, 15);
    const [keysBefore] = await pool.execute<RowDataPacket[]>(
      'SELECT id, key_hash, key_enc, revoked_at FROM screen_key ORDER BY id',
    );
    const [sessionsBefore] = await pool.execute<RowDataPacket[]>(
      'SELECT id, token_hash, expires_at FROM screen_session ORDER BY id',
    );

    expect((await sa.post('/api/superadmin/screens/clear-lockout', {})).status).toBe(200);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT new_value, user_id FROM audit_log
        WHERE action = 'SCREEN_UNLOCK_LOCKOUT_CLEARED' ORDER BY id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.new_value).toMatchObject({ cleared: [{ screen: '2' }] });
    expect(rows[0]?.user_id).toBeTruthy();

    // No key and no session was read, changed or ended.
    const [keysAfter] = await pool.execute<RowDataPacket[]>(
      'SELECT id, key_hash, key_enc, revoked_at FROM screen_key ORDER BY id',
    );
    const [sessionsAfter] = await pool.execute<RowDataPacket[]>(
      'SELECT id, token_hash, expires_at FROM screen_session ORDER BY id',
    );
    expect(keysAfter).toEqual(keysBefore);
    expect(sessionsAfter).toEqual(sessionsBefore);
    // The screens' own ON/OFF state is untouched too.
    expect(await readScreensOff(pool)).toEqual([]);
  });

  it('SUPER_ADMIN only: the DM and an RO are refused, and nothing is audited', async () => {
    const dm = await apiClient(app, 'dm_x4', PASSWORD);
    expect((await dm.post('/api/superadmin/screens/clear-lockout', {})).status).toBe(403);
    const ro = await apiClient(app, 'ro_ps1_x1', PASSWORD);
    expect((await ro.post('/api/superadmin/screens/clear-lockout', {})).status).toBe(403);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM audit_log WHERE action = 'SCREEN_UNLOCK_LOCKOUT_CLEARED'",
    );
    expect(rows).toHaveLength(0);
  });
});
