import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findFrontendDist } from '../src/modules/frontend/static.js';
import { buildApp } from './auth/helpers.js';
import { createTestAppPool } from './helpers/db.js';

let pool: Pool;
let dist: string;

beforeAll(async () => {
  pool = createTestAppPool();
  dist = await mkdtemp(join(tmpdir(), 'churu-dist-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(
    join(dist, 'index.html'),
    '<!doctype html><title>DASHBOARD</title><div id="root"></div>',
  );
  await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
});
afterAll(async () => {
  await pool.end();
});

const app = () => buildApp(pool, { frontendDist: dist });

describe('serving the built dashboard', () => {
  it('serves index.html at / with no-cache, the strict CSP and no cookie', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('DASHBOARD');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('falls back to index.html for app routes (SPA), but never for /api', async () => {
    for (const path of ['/wards', '/wards/12', '/entries/5/edit', '/login']) {
      const res = await request(app()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('DASHBOARD');
    }
    const api = await request(app()).get('/api/nope');
    expect([api.status, api.body]).toEqual([404, { error: 'Not found' }]);
    expect((await request(app()).get('/api/health')).body).toEqual({ status: 'ok', db: 'ok' });
    expect((await request(app()).get('/api')).status).toBe(404);
  });

  it('hashed assets are cached for a year (immutable); a missing asset is a plain 404', async () => {
    const res = await request(app()).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-type']).toContain('javascript');
    const missing = await request(app()).get('/assets/index-gone.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('DASHBOARD');
  });

  it('only GET/HEAD: a POST to an app path is not served the page', async () => {
    const res = await request(app()).post('/wards').send({});
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('DASHBOARD');
    expect((await request(app()).head('/wards')).status).toBe(200);
  });

  it('without a build the server is API-only', async () => {
    expect(findFrontendDist(join(dist, 'nothing-here'))).toBeNull();
    expect(findFrontendDist(dist)).toBe(dist);
    const apiOnly = buildApp(pool); // frontendDist: null
    expect((await request(apiOnly).get('/')).status).toBe(404);
  });
});
