import express from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errors.js';
import { createTestAppPool, createUnreachablePool } from './helpers/db.js';

let pool: Pool;

beforeAll(() => {
  pool = createTestAppPool();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  await pool.end();
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('case 13: returns 200 when the DB is up', async () => {
    const res = await request(createApp({ pool })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 503 when the DB is down', async () => {
    const down = createUnreachablePool();
    try {
      const res = await request(createApp({ pool: down })).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error', db: 'down' });
    } finally {
      await down.end();
    }
  });
});

describe('error handling', () => {
  it('unknown routes return 404 JSON', async () => {
    const res = await request(createApp({ pool })).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('bodies over 100kb are rejected with 413 and no details', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(110 * 1024) });
    const res = await request(createApp({ pool }))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(big);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Payload too large' });
  });

  it('malformed JSON returns 400 without parser details', async () => {
    const res = await request(createApp({ pool }))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
  });

  it('unexpected errors return a generic 500 with no stack or SQL', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error("ER_PARSE_ERROR near 'SELECT password_hash FROM users'");
    });
    app.use(errorHandler);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error' });
    expect(res.text).not.toMatch(/password_hash|SELECT|at |stack/);
  });
});
