import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { defaultPublicApiConfig } from '../../src/config/app-config.js';
import type { PublicApiConfig } from '../../src/config/app-config.js';
import { SseHub } from '../../src/modules/public/sse.js';
import { PublicSnapshotService } from '../../src/services/public-snapshot.js';
import { SCREEN_LAYOUT_KEY } from '../../src/services/screen-layout.js';
import { testAppConfig } from '../auth/helpers.js';
import {
  createKeyDirect,
  createSuperAdmin,
  unlockCookie,
  withCookie,
} from '../screen-access/helpers.js';
import type { ScreenNumber } from '../../src/services/setup/screen-power.js';

/** Fast timings for tests (production: 500 ms debounce, 2 s minimum interval, 60 s safety, 15 s heartbeat). */
export const FAST: Partial<PublicApiConfig> = {
  debounceMs: 30,
  minSnapshotIntervalMs: 60,
  safetyRebuildMs: 60_000,
  layoutPollMs: 150,
  sseHeartbeatMs: 150,
};

/**
 * The two-PS test world on fixed screens (CHURU on 1, RAJGARH on 2), so these tests do not
 * depend on the official order in DEFAULT_SCREEN_LAYOUT.
 */
export async function useWorldLayout(pool: Pool): Promise<void> {
  await pool.execute('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?', [
    JSON.stringify({ '1': ['CHURU PANCHAYAT SAMITI'], '2': ['RAJGARH PANCHAYAT SAMITI'] }),
    SCREEN_LAYOUT_KEY,
  ]);
}

export interface PublicHarness {
  /**
   * The app as a browser that has unlocked ALL THREE screens sees it (the key was typed into each
   * screen's popup, so there are three sessions): every request carries those cookies.
   */
  app: Express;
  /** The same app without any screen cookie (as a browser without the key sees it). */
  rawApp: Express;
  /** The app as ONE TV sees it: a single session, for that screen only. */
  appFor: (screen: ScreenNumber) => Express;
  /**
   * Types the key into that screen's popup again (as an officer would at the TV) and returns the
   * app as that newly unlocked TV sees it. Needed after the screen was switched off or on, which
   * ends that screen's sessions.
   */
  unlockAgain: (screen: ScreenNumber) => Promise<Express>;
  /** The screen key behind `app`'s cookies. */
  screenKey: { id: number; key: string; superAdminId: number };
  snapshots: PublicSnapshotService;
  hub: SseHub;
  logs: string[];
  stop: () => void;
}

/**
 * A full app (counting + declare + public) with its own, started snapshot service. The public
 * screens need a screen key since Nov 2026: a Super Admin account and a key are created, and the key
 * is unlocked through the real endpoint ONCE PER SCREEN (a session is for one screen only, Nov 2026),
 * so `app` can read all three exactly as before. `appFor(screen)` is one TV with one key.
 */
export async function publicApp(
  pool: Pool,
  overrides: Partial<PublicApiConfig> = {},
): Promise<PublicHarness> {
  const publicApi = defaultPublicApiConfig({ ...FAST, ...overrides });
  const logs: string[] = [];
  const snapshots = new PublicSnapshotService(pool, publicApi, (message) => logs.push(message));
  const hub = new SseHub(snapshots, {
    maxConnections: publicApi.sseMaxConnections,
    heartbeatMs: publicApi.sseHeartbeatMs,
  });
  const app = createApp({
    pool,
    config: testAppConfig({ publicApi }),
    publicSnapshot: snapshots,
    sseHub: hub,
  });
  await snapshots.start();
  const superAdminId = await createSuperAdmin(pool);
  const key = await createKeyDirect(pool, superAdminId, { label: 'test harness TV' });
  // One unlock per screen, through the real popup endpoint: three sessions of the same key.
  const per = {
    '1': await unlockCookie(app, key.key, '1'),
    '2': await unlockCookie(app, key.key, '2'),
    '3': await unlockCookie(app, key.key, '3'),
  } as const satisfies Record<ScreenNumber, string>;
  return {
    app: withCookie(app, Object.values(per).join('; ')),
    rawApp: app,
    appFor: (screen: ScreenNumber) => withCookie(app, per[screen]),
    unlockAgain: async (screen: ScreenNumber) =>
      withCookie(app, await unlockCookie(app, key.key, screen)),
    screenKey: { id: key.id, key: key.key, superAdminId },
    snapshots,
    hub,
    logs,
    stop: () => {
      hub.stop();
      snapshots.stop();
    },
  };
}

/** Polls until `check` returns a value (or throws after timeoutMs). */
export async function waitFor<T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Waits until the published snapshot is newer than `version`. */
export async function nextVersion(
  h: PublicHarness,
  version: number,
  timeoutMs = 3000,
): Promise<number> {
  return waitFor(() => {
    const v = h.snapshots.get()?.version ?? 0;
    return v > version ? v : undefined;
  }, timeoutMs);
}

export const PUBLIC_PATHS = [
  '/api/public/meta',
  '/api/public/screens/1',
  '/api/public/screens/2',
  '/api/public/screens/3',
  '/api/public/recent?limit=50',
  '/api/public/winners?limit=50',
] as const;

export async function getJson(
  app: Express,
  path: string,
): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  const res = await request(app).get(path);
  return {
    status: res.status,
    body: res.body as unknown,
    headers: res.headers,
  };
}
