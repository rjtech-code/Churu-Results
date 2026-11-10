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
import { createDm, createKeyDirect, unlockCookie, withCookie } from '../screen-access/helpers.js';

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
  /** The app as an UNLOCKED TV sees it: every request carries a real screen session cookie. */
  app: Express;
  /** The same app without that cookie (as any browser without the key sees it). */
  rawApp: Express;
  /** The screen key behind `app`'s cookie. */
  screenKey: { id: number; key: string; dmId: number };
  snapshots: PublicSnapshotService;
  hub: SseHub;
  logs: string[];
  stop: () => void;
}

/**
 * A full app (counting + declare + public) with its own, started snapshot service. The public
 * screens need a screen key since Nov 2026: a DM account and a key are created and unlocked through
 * the real endpoint, and `app` sends that session cookie on every request.
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
  const dmId = await createDm(pool);
  const key = await createKeyDirect(pool, dmId, { label: 'test harness TV' });
  const cookie = await unlockCookie(app, key.key);
  return {
    app: withCookie(app, cookie),
    rawApp: app,
    screenKey: { id: key.id, key: key.key, dmId },
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
