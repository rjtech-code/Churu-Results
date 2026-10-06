import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, psW1Sheet } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import { publicApp, waitFor } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let h: PublicHarness;
let server: http.Server;
let base: string;

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
  w = await buildWorld(pool);
  h = await publicApp(pool, { sseMaxConnections: 2, sseHeartbeatMs: 150 });
  server = h.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  h.stop();
  await new Promise((r) => server.close(r));
});

interface Stream {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: () => string;
  close: () => void;
}

function openStream(): Promise<Stream> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const req = http.get(
      `${base}/api/public/stream`,
      { headers: { Cookie: 'churu.sid=s%3Astale.sig' } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (buffer += chunk));
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: () => buffer,
          close: () => req.destroy(),
        });
      },
    );
    req.on('error', (err) => {
      if (!('code' in err && err.code === 'ECONNRESET')) reject(err);
    });
  });
}

const snapshotVersions = (text: string) =>
  [...text.matchAll(/event: snapshot\ndata: (\{.*\})\n\n/g)].map(
    (m) => (JSON.parse(m[1] ?? '{}') as { version: number }).version,
  );

describe('SSE /api/public/stream', () => {
  it('sends retry and the current snapshot at once; no cookie; streaming headers', async () => {
    const s = await openStream();
    try {
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(s.headers['cache-control']).toBe('no-store');
      expect(s.headers['x-accel-buffering']).toBe('no');
      expect(s.headers['set-cookie']).toBeUndefined();
      const text = await waitFor(() =>
        s.text().includes('event: snapshot') ? s.text() : undefined,
      );
      expect(text.startsWith('retry: 3000\n\n')).toBe(true);
      expect(snapshotVersions(text)).toEqual([h.snapshots.get()?.version]);
    } finally {
      s.close();
    }
  });

  it('an entry produces a new snapshot event; heartbeats arrive', async () => {
    const s = await openStream();
    try {
      await waitFor(() => (s.text().includes('event: snapshot') ? true : undefined));
      const first = snapshotVersions(s.text())[0] ?? 0;
      const ro = await declareClient(h.app, 'ro_ps1_x1');
      await ro.post('/entries', psW1Sheet(w, w.b1));
      const versions = await waitFor(() => {
        const vs = snapshotVersions(s.text());
        return vs.length >= 2 ? vs : undefined;
      });
      expect(versions[versions.length - 1]).toBeGreaterThan(first);
      await waitFor(() => (s.text().includes(': hb\n\n') ? true : undefined));
    } finally {
      s.close();
    }
  });

  it('caps the number of streams (503 TOO_MANY_STREAMS) and removes closed clients', async () => {
    const a = await openStream();
    const b = await openStream();
    await waitFor(() => (h.hub.size === 2 ? true : undefined));
    const res = await fetch(`${base}/api/public/stream`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'TOO_MANY_STREAMS' });
    a.close();
    await waitFor(() => (h.hub.size === 1 ? true : undefined));
    const c = await openStream();
    expect(c.status).toBe(200);
    b.close();
    c.close();
    await waitFor(() => (h.hub.size === 0 ? true : undefined));
  });
});
