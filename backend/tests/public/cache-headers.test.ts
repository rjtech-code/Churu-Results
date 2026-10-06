import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld } from '../counting/helpers.js';
import { PUBLIC_PATHS, publicApp } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let h: PublicHarness;

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
  h = await publicApp(pool);
});
afterEach(() => {
  h.stop();
});

describe('public caching headers', () => {
  it('every endpoint: Cache-Control no-store and ETag = snapshot version; If-None-Match -> 304', async () => {
    const version = h.snapshots.get()?.version;
    for (const path of PUBLIC_PATHS) {
      const res = await request(h.app).get(path);
      expect(res.headers['cache-control'], path).toBe('no-store');
      expect(res.headers.etag, path).toBe(`"${String(version)}"`);
      const again = await request(h.app)
        .get(path)
        .set('If-None-Match', `"${String(version)}"`);
      expect(again.status, path).toBe(304);
      expect(again.text).toBe('');
      const other = await request(h.app).get(path).set('If-None-Match', '"0"');
      expect(other.status, path).toBe(200);
    }
  });

  it('errors are no-store too', async () => {
    for (const path of [
      '/api/public/screens/9',
      '/api/public/nope',
      '/api/public/recent?limit=99',
    ]) {
      expect((await request(h.app).get(path)).headers['cache-control'], path).toBe('no-store');
    }
    expect((await request(h.app).post('/api/public/meta')).headers['cache-control']).toBe(
      'no-store',
    );
  });

  it('the public limiter is generous (3000/min by default) and separate from the /api limiter', async () => {
    const limited = await (
      await import('./helpers.js')
    ).publicApp(pool, { rateLimit: { limit: 3, windowMs: 60_000 } });
    try {
      for (let i = 0; i < 3; i++)
        expect((await request(limited.app).get('/api/public/meta')).status).toBe(200);
      const res = await request(limited.app).get('/api/public/meta');
      expect([res.status, res.body]).toEqual([429, { error: 'TOO_MANY_REQUESTS' }]);
      expect((await request(limited.app).get('/api/health')).status).toBe(200);
    } finally {
      limited.stop();
    }
    const { defaultPublicApiConfig } = await import('../../src/config/app-config.js');
    expect(defaultPublicApiConfig().rateLimit).toEqual({ limit: 3000, windowMs: 60_000 });
    expect(defaultPublicApiConfig().minSnapshotIntervalMs).toBe(2000);
  });
});
