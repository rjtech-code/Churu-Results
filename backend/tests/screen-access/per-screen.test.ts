// A screen session belongs to ONE screen (Nov 2026). Before this, a key typed into screen 1 opened
// screens 2 and 3 as well; now screen 1's key opens screen 1 and nothing else.
//
// Also here: the 24-hour lifetime (SCREEN_SESSION_HOURS), that a reload / browser restart / app
// restart never asks for the key again, and that a session row written before the migration (no
// screen) is valid for nothing at all.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { defaultPublicApiConfig } from '../../src/config/app-config.js';
import { SseHub } from '../../src/modules/public/sse.js';
import { PublicSnapshotService } from '../../src/services/public-snapshot.js';
import { testAppConfig } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld } from '../counting/helpers.js';
import { FAST, useWorldLayout } from '../public/helpers.js';
import {
  createKeyDirect,
  createSuperAdmin,
  screenCookieOf,
  unlock,
  unlockCookie,
} from './helpers.js';

let pool: Pool;
let migrator: Pool;
let saId: number;

interface Harness {
  app: Express;
  snapshots: PublicSnapshotService;
  hub: SseHub;
  stop: () => void;
}

/** A fresh app on the same database — also how an APP RESTART is tested. */
function harness(hours?: number): Harness {
  const publicApi = defaultPublicApiConfig(FAST);
  const snapshots = new PublicSnapshotService(pool, publicApi, () => undefined);
  const hub = new SseHub(snapshots, { maxConnections: 10, heartbeatMs: 1000 });
  const app = createApp({
    pool,
    config: testAppConfig({
      publicApi,
      ...(hours === undefined ? {} : { screenAccess: { sessionMaxAgeMs: hours * 3_600_000 } }),
    }),
    publicSnapshot: snapshots,
    sseHub: hub,
  });
  return {
    app,
    snapshots,
    hub,
    stop: () => {
      hub.stop();
      snapshots.stop();
    },
  };
}

let h: Harness;

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
  await buildWorld(pool);
  await useWorldLayout(pool);
  saId = await createSuperAdmin(pool);
  h = harness();
  await h.snapshots.start();
});
afterEach(() => {
  h.stop();
});

const get = (app: Express, path: string, cookie: string) =>
  request(app).get(path).set('Cookie', cookie);

const rows = async (sql: string) => {
  const [r] = await pool.execute<RowDataPacket[]>(sql);
  return r;
};

/** Every path of one screen, as that screen's TV asks for them. */
const pathsOf = (screen: '1' | '2' | '3') => [
  `/api/public/meta?screen=${screen}`,
  `/api/public/screens/${screen}`,
  `/api/public/recent?limit=10&screen=${screen}`,
  `/api/public/winners?limit=8&screen=${screen}`,
];

describe("one screen's key opens that screen only", () => {
  it('screen 1 unlocked: screen 1 answers, screens 2 and 3 are 401 SCREEN_LOCKED', async () => {
    const key = await createKeyDirect(pool, saId);
    const cookie = await unlockCookie(h.app, key.key, '1');

    for (const path of pathsOf('1'))
      expect((await get(h.app, path, cookie)).status, path).toBe(200);

    for (const screen of ['2', '3'] as const) {
      for (const path of pathsOf(screen)) {
        const res = await get(h.app, path, cookie);
        expect([res.status, res.body], path).toEqual([401, { error: 'SCREEN_LOCKED' }]);
      }
    }
  });

  it('the same key on each screen: three sessions, one per screen, each for its own screen', async () => {
    const key = await createKeyDirect(pool, saId);
    const cookies = {
      '1': await unlockCookie(h.app, key.key, '1'),
      '2': await unlockCookie(h.app, key.key, '2'),
      '3': await unlockCookie(h.app, key.key, '3'),
    };
    expect(
      (await rows('SELECT screen FROM screen_session ORDER BY screen')).map((r) =>
        String(r.screen),
      ),
    ).toEqual(['1', '2', '3']);
    // Each cookie opens its own screen and refuses the other two.
    for (const [mine, cookie] of Object.entries(cookies)) {
      for (const screen of ['1', '2', '3'] as const) {
        const res = await get(h.app, `/api/public/screens/${screen}`, cookie);
        expect(res.status, `${mine} -> ${screen}`).toBe(screen === mine ? 200 : 401);
      }
    }
  });

  it('the popup must say which screen it is (no screen = 400, a bad one = 400)', async () => {
    const key = await createKeyDirect(pool, saId);
    expect((await unlock(h.app, key.key, null)).status).toBe(400);
    expect((await unlock(h.app, key.key, null, { screen: '4' })).status).toBe(400);
    expect((await unlock(h.app, key.key, null, { screen: 1 })).status).toBe(400);
    expect(await rows('SELECT id FROM screen_session')).toHaveLength(0);
    // And a good one works.
    expect((await unlock(h.app, key.key, '3')).status).toBe(200);
  });
});

describe('a session written before the per-screen migration', () => {
  it('has no screen, so it is valid for nothing — every TV asks for its key once after deploy', async () => {
    const key = await createKeyDirect(pool, saId);
    const cookie = await unlockCookie(h.app, key.key, '2');
    expect((await get(h.app, '/api/public/screens/2', cookie)).status).toBe(200);

    // Exactly what the migration leaves behind for a TV that was already unlocked.
    await pool.execute('UPDATE screen_session SET screen = NULL');
    for (const screen of ['1', '2', '3'] as const)
      expect((await get(h.app, `/api/public/screens/${screen}`, cookie)).status, screen).toBe(401);
    expect((await get(h.app, '/api/public/meta', cookie)).status).toBe(401);
  });
});

describe('while the screen stays ON the key is never asked again', () => {
  it('the same cookie keeps working over many requests, and across an app restart', async () => {
    const key = await createKeyDirect(pool, saId);
    const cookie = await unlockCookie(h.app, key.key, '1');
    // A page reload is simply the same cookie asking again.
    for (let i = 0; i < 5; i++)
      expect((await get(h.app, '/api/public/screens/1', cookie)).status).toBe(200);

    // An app restart: a brand-new app (new process would be the same) on the same database. The
    // session lives in MySQL and the cookie on the TV, so neither is lost.
    const restarted = harness();
    try {
      await restarted.snapshots.start();
      expect((await get(restarted.app, '/api/public/screens/1', cookie)).status).toBe(200);
      expect((await get(restarted.app, '/api/public/meta?screen=1', cookie)).status).toBe(200);
    } finally {
      restarted.stop();
    }
  });
});

describe('SCREEN_SESSION_HOURS', () => {
  it('sets the cookie Max-Age and the session row lifetime (24 h by default)', async () => {
    const key = await createKeyDirect(pool, saId);
    const res = await unlock(h.app, key.key, '1');
    expect(screenCookieOf(res, '1')).toBeTruthy();
    const raw = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(raw).toMatch(/Max-Age=86400/);
    const [row] = await rows(
      'SELECT TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS mins FROM screen_session',
    );
    expect(Number(row?.mins)).toBe(24 * 60);
  });

  it('a different number of hours is honoured, cookie and row together', async () => {
    const two = harness(2);
    try {
      await two.snapshots.start();
      const key = await createKeyDirect(pool, saId, { label: 'two hours' });
      const res = await unlock(two.app, key.key, '1');
      expect(res.status).toBe(200);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/Max-Age=7200/);
      const [row] = await rows(
        'SELECT TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS mins FROM screen_session',
      );
      expect(Number(row?.mins)).toBe(120);
    } finally {
      two.stop();
    }
  });

  it('once the lifetime is over the TV is asked again', async () => {
    const key = await createKeyDirect(pool, saId);
    const cookie = await unlockCookie(h.app, key.key, '1');
    await pool.execute('UPDATE screen_session SET expires_at = NOW(3) - INTERVAL 1 SECOND');
    expect((await get(h.app, '/api/public/screens/1', cookie)).status).toBe(401);
  });
});
