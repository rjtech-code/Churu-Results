// Starts the real server entry point (src/server.ts, what `npm start` runs compiled) as its own
// process, like `npm start` does: NODE_ENV=development, a built dashboard present. Uses churu_test.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './helpers/db.js';

const BACKEND = resolve(import.meta.dirname, '..');
const TSX = join(BACKEND, 'node_modules', '.bin', 'tsx');

interface Started {
  child: ChildProcess;
  output: () => { stdout: string; stderr: string };
  exited: Promise<number | null>;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      s.close(() => {
        done(port);
      });
    });
  });
}

function startServer(port: number, dist: string): Started {
  const child = spawn(TSX, ['src/server.ts'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DB_NAME: testEnv.TEST_DB, // never churu_dev
      APP_ORIGIN: `http://localhost:${port}`,
      FRONTEND_DIST: dist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<number | null>((done) =>
    child.once('exit', (code) => {
      done(code);
    }),
  );
  return { child, output: () => ({ stdout, stderr }), exited };
}

/** Resolves once the server says it listens; rejects if it exits or takes too long. */
async function untilListening(s: Started, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let code: number | null | undefined;
  void s.exited.then((c) => (code = c));
  while (!s.output().stdout.includes('Server listening')) {
    if (code !== undefined)
      throw new Error(`server exited (${String(code)}): ${s.output().stderr}`);
    if (Date.now() > deadline)
      throw new Error(`server did not start: ${JSON.stringify(s.output())}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function stop(s: Started): Promise<void> {
  if (s.child.exitCode === null) s.child.kill('SIGTERM');
  await s.exited;
}

let dist: string;
beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'churu-dist-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(
    join(dist, 'index.html'),
    '<!doctype html><title>DASHBOARD-BUILD</title><div id="root"></div>',
  );
  await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
});

describe('server started like npm start (development, build present)', () => {
  let server: Started;
  let base: string;
  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = startServer(port, dist);
    await untilListening(server);
  });
  afterAll(async () => {
    await stop(server);
  });

  it('says it serves the dashboard', () => {
    expect(server.output().stdout).toContain(`Dashboard: serving ${dist}`);
  });

  it('GET / returns index.html with 200', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('DASHBOARD-BUILD');
  });

  it('SPA routes (/wards, /some/spa/route) return index.html', async () => {
    for (const path of ['/wards', '/some/spa/route', '/wards/12/booths/3/entry']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('DASHBOARD-BUILD');
    }
  });

  it('GET /api/unknown is still the JSON 404, and the API works', async () => {
    const res = await fetch(`${base}/api/unknown`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
  });
});

describe('server start when the port is already taken', () => {
  let blocker: Server;
  let port: number;
  beforeAll(async () => {
    port = await freePort();
    blocker = createServer();
    await new Promise<void>((done) => blocker.listen(port, done)); // same wildcard bind as the app
  });
  afterAll(async () => {
    await new Promise<void>((done) =>
      blocker.close(() => {
        done();
      }),
    );
  });

  // Regression: Express 5 hands EADDRINUSE to the listen callback. The server used to log
  // "Server listening" and keep running while ANOTHER (older) process answered on the port.
  it('exits with code 1 and a clear message, never claiming to listen', async () => {
    const s = startServer(port, dist);
    const code = await Promise.race([
      s.exited,
      new Promise<'timeout'>((r) =>
        setTimeout(() => {
          r('timeout');
        }, 30_000),
      ),
    ]);
    if (code === 'timeout') await stop(s);
    expect(code).toBe(1);
    expect(s.output().stderr).toContain(`port ${port} is already in use`);
    expect(s.output().stdout).not.toContain('Server listening');
  });
});
