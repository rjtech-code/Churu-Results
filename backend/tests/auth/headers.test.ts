import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestAppPool } from '../helpers/db.js';
import { buildApp } from './helpers.js';

let app: Pool;
beforeAll(() => {
  app = createTestAppPool();
});
afterAll(async () => {
  await app.end();
});

describe('security headers', () => {
  it.each(['/api/health', '/api/auth/csrf', '/api/auth/me', '/api/does-not-exist'])(
    '%s has the strict CSP, DENY framing and no X-Powered-By',
    async (path) => {
      const res = await request(buildApp(app)).get(path);
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'self';frame-ancestors 'none';object-src 'none';base-uri 'self';form-action 'self'",
      );
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    },
  );

  it('HSTS only in production', async () => {
    const dev = await request(buildApp(app)).get('/api/health');
    expect(dev.headers['strict-transport-security']).toBeUndefined();
    const prod = await request(buildApp(app, { production: true })).get('/api/health');
    expect(prod.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('errors use stable codes and never leak internals', async () => {
    const res = await request(buildApp(app)).get('/api/does-not-exist');
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
