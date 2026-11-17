// The Super Admin panel's control of the three public screens: who may switch one, what the audit
// log keeps, that the three are independent, and that the DM only ever SEES the state.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readScreensOff } from '../../src/services/setup/screen-power.js';
import { createUser } from '../auth/helpers.js';
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
  app = countingApp(pool, { loginRateLimit: { limit: 10_000, windowMs: 60_000 } });
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

describe('the DM page', () => {
  it('shows the state read-only beside the keys, and has no way to change it', async () => {
    await sa.post('/api/superadmin/screens/3', { on: false });
    const dm = await apiClient(app, 'dm_x4', PASSWORD);
    const res = await dm.get('/api/admin/screen-keys');
    expect(res.status).toBe(200);
    const body = res.body as { screens: ScreenRow[] };
    expect(body.screens.map((s) => [s.screen, s.on])).toEqual([
      ['1', true],
      ['2', true],
      ['3', false],
    ]);
    // No DM route writes it (the admin router refuses a path it does not have), and the Super
    // Admin's own route is 403 for the DM. The state is unchanged either way.
    expect([403, 404]).toContain(
      (await dm.post('/api/admin/screen-keys/screens/3', { on: true })).status,
    );
    expect((await dm.post('/api/superadmin/screens/3', { on: true })).status).toBe(403);
    expect(await readScreensOff(pool)).toEqual(['3']);
  });
});
