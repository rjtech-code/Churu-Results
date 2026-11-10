import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { defaultPublicApiConfig } from '../../src/config/app-config.js';
import type { ScreenAccessConfig } from '../../src/config/app-config.js';
import { dmWriteAllowed } from '../../src/middleware/auth.js';
import { SseHub } from '../../src/modules/public/sse.js';
import { PublicSnapshotService } from '../../src/services/public-snapshot.js';
import {
  SCREEN_KEY_ALPHABET,
  generateScreenKey,
  normalizeScreenKey,
} from '../../src/services/screen-key.js';
import type { Role } from '../../src/types/auth.js';
import {
  TEST_ORIGIN,
  createUser,
  csrfToken,
  login,
  seedTwoPs,
  sessionSetCookie,
  testAppConfig,
} from '../auth/helpers.js';
import type { Agent } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { FAST, PUBLIC_PATHS, waitFor } from '../public/helpers.js';
import { createDm, createKeyDirect, screenCookieOf, unlock, unlockCookie } from './helpers.js';

const PASSWORD = 'Screen-Test-Pass-1';
/** Every endpoint the TV screens use (data, the live stream) plus an unknown public path. */
const PROTECTED = [...PUBLIC_PATHS, '/api/public/stream', '/api/public/nope'] as const;

let pool: Pool;
let migrator: Pool;

interface Harness {
  app: Express;
  hub: SseHub;
  snapshots: PublicSnapshotService;
  stop: () => void;
}
let h: Harness;
let dmId: number;

function harness(screenAccess: Partial<ScreenAccessConfig> = {}, production = false): Harness {
  const publicApi = defaultPublicApiConfig(FAST);
  const snapshots = new PublicSnapshotService(pool, publicApi, () => undefined);
  const hub = new SseHub(snapshots, { maxConnections: 10, heartbeatMs: 100 });
  const app = createApp({
    pool,
    config: testAppConfig({ publicApi, screenAccess, production }),
    publicSnapshot: snapshots,
    sseHub: hub,
  });
  return {
    app,
    hub,
    snapshots,
    stop: () => {
      hub.stop();
      snapshots.stop();
    },
  };
}

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
  dmId = await createDm(pool, PASSWORD);
  h = harness();
  await h.snapshots.start();
});
afterEach(() => {
  h.stop();
});

const n = async (sql: string, params: (string | number)[] = []) => {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
};

function get(app: Express, path: string, cookie?: string) {
  const req = request(app).get(path);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

/** Opens the SSE stream on a listening copy of the app. */
async function openStream(app: Express, cookie: string) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  let buffer = '';
  let ended = false;
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.get(`${base}/api/public/stream`, { headers: { Cookie: cookie } }, resolve);
    req.on('error', reject);
  });
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (buffer += chunk));
  res.on('end', () => (ended = true));
  return {
    status: res.statusCode ?? 0,
    text: () => buffer,
    ended: () => ended,
    close: async () => {
      res.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

async function loggedIn(app: Express, role: Role, psId: number | null = null): Promise<Agent> {
  const username = `u_${role.toLowerCase()}_${String(Math.random()).slice(2, 8)}`;
  if (role === 'DM') {
    await pool.execute("UPDATE users SET username = ? WHERE role = 'DM' AND id = ?", [
      username,
      dmId,
    ]);
  } else {
    await createUser(pool, { username, role, psId, password: PASSWORD });
  }
  const agent = request.agent(app);
  const res = await login(agent, username, PASSWORD);
  if (res.status !== 200) throw new Error(`login ${role}: ${res.status}`);
  return agent;
}

async function post(agent: Agent, path: string, body: object = {}) {
  const token = await csrfToken(agent);
  return agent.post(path).set('X-CSRF-Token', token).send(body);
}

describe('screen key format (pure)', () => {
  it('12 characters from the unambiguous alphabet, grouped XXXX-XXXX-XXXX, all different', () => {
    expect(SCREEN_KEY_ALPHABET).not.toMatch(/[IO01]/);
    const keys = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const key = generateScreenKey();
      expect(key).toMatch(
        new RegExp(`^[${SCREEN_KEY_ALPHABET}]{4}(-[${SCREEN_KEY_ALPHABET}]{4}){2}$`),
      );
      keys.add(key);
    }
    expect(keys.size).toBe(300);
  });

  it('typing is forgiving (case, spaces, hyphens) but anything else is not a key', () => {
    expect(normalizeScreenKey(' k7qf-m3xa 9pzr ')).toBe('K7QFM3XA9PZR');
    for (const bad of ['', 'K7QF-M3XA-9PZ', 'K7QF-M3XA-9PZRX', 'K7QF-M3XA-9PZ0', 'K7QF_M3XA_9PZR'])
      expect(normalizeScreenKey(bad), bad).toBeNull();
  });
});

describe('every screen endpoint is closed without a screen session', () => {
  it('401 SCREEN_LOCKED and no data: no cookie, junk cookie, a revoked session, a DM login', async () => {
    await pool.execute('UPDATE users SET username = ? WHERE id = ?', ['the_dm', dmId]);
    const dmLogin = await login(request.agent(h.app), 'the_dm', PASSWORD);
    expect(dmLogin.status).toBe(200);
    const dmCookie = (sessionSetCookie(dmLogin) ?? '').split(';')[0];
    const cookies: (string | undefined)[] = [
      undefined,
      'churu.screen=not-a-token',
      `churu.screen=${'A'.repeat(43)}`,
      // A logged-in DEO's dashboard session is NOT a screen session (the DM uses "Preview").
      dmCookie,
    ];
    for (const cookie of cookies) {
      for (const path of PROTECTED) {
        const res = await get(h.app, path, cookie);
        expect([path, res.status, res.body], String(cookie)).toEqual([
          path,
          401,
          { error: 'SCREEN_LOCKED' },
        ]);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect((await request(h.app).head('/api/public/meta')).status).toBe(401);
    }
  });

  it('a correct key opens every endpoint (cookie: HttpOnly, SameSite=Strict, path /api)', async () => {
    const key = await createKeyDirect(pool, dmId);
    const res = await unlock(h.app, key.key, { screen: '2' });
    expect([res.status, res.body]).toEqual([200, { ok: true }]);
    const raw = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(raw).toMatch(/^churu\.screen=[A-Za-z0-9_-]{43};/);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).toContain('Path=/api');
    expect(raw).toMatch(/Max-Age=604800/); // 7 days, unless the key is revoked or expires first
    expect(raw).not.toContain('Secure'); // only in production (next test)
    const cookie = screenCookieOf(res) ?? '';
    for (const path of PUBLIC_PATHS)
      expect((await get(h.app, path, cookie)).status, path).toBe(200);
    const s = await openStream(h.app, cookie);
    try {
      expect(s.status).toBe(200);
      await waitFor(() => s.text().includes('event: snapshot'));
    } finally {
      await s.close();
    }
    expect(await n('SELECT COUNT(*) AS n FROM screen_key WHERE last_used_at IS NOT NULL')).toBe(1);
  });

  it('production: the cookie is Secure', async () => {
    const prod = harness({}, true);
    try {
      const key = await createKeyDirect(pool, dmId);
      const res = await unlock(prod.app, key.key);
      expect(res.status).toBe(200);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toContain('Secure');
    } finally {
      prod.stop();
    }
  });

  it('accepts the key typed in lower case with spaces', async () => {
    const key = await createKeyDirect(pool, dmId);
    const typed = ` ${key.key.toLowerCase().replace(/-/g, ' ')} `;
    expect((await unlock(h.app, typed)).status).toBe(200);
  });
});

describe('wrong keys', () => {
  it('unknown, malformed, revoked and expired keys all get the same 401 WRONG_KEY, no cookie', async () => {
    const revoked = await createKeyDirect(pool, dmId, { label: 'r' });
    const expired = await createKeyDirect(pool, dmId, { label: 'e' });
    await createKeyDirect(pool, dmId, { label: 'still active' });
    await pool.execute(
      'UPDATE screen_key SET revoked_at = NOW(3), revoked_by = ?, key_enc = NULL WHERE id = ?',
      [dmId, revoked.id],
    );
    await pool.execute(
      'UPDATE screen_key SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?',
      [expired.id],
    );
    for (const typed of [generateScreenKey(), 'abc', '', revoked.key, expired.key]) {
      const res = await unlock(h.app, typed);
      expect([typed, res.status, res.body]).toEqual([typed, 401, { error: 'WRONG_KEY' }]);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(await n('SELECT COUNT(*) AS n FROM screen_session')).toBe(0);
  });

  it('needs our own Origin and POST; a bad body is refused', async () => {
    const key = await createKeyDirect(pool, dmId);
    const noOrigin = await request(h.app).post('/api/screen-auth/unlock').send({ key: key.key });
    expect([noOrigin.status, noOrigin.body]).toEqual([403, { error: 'ORIGIN_REJECTED' }]);
    const foreign = await request(h.app)
      .post('/api/screen-auth/unlock')
      .set('Origin', 'https://evil.example')
      .send({ key: key.key });
    expect(foreign.status).toBe(403);
    expect((await request(h.app).get('/api/screen-auth/unlock')).status).toBe(405);
    expect((await unlock(h.app, 123)).status).toBe(400);
    expect((await unlock(h.app, key.key, { extra: 1 })).status).toBe(400);
    expect(await n('SELECT COUNT(*) AS n FROM screen_session')).toBe(0);
  });
});

describe('revoke and expiry end existing sessions', () => {
  it('revoke: the next request is refused, the live stream gets "locked" and closes', async () => {
    const dm = await loggedIn(h.app, 'DM');
    const created = await post(dm, '/api/admin/screen-keys/create', {
      label: 'मुख्य हॉल TV',
      expiresAt: null,
    });
    expect(created.status).toBe(201);
    const key = (created.body as { key: { id: number; key: string } }).key;
    const cookie = await unlockCookie(h.app, key.key);
    const other = await createKeyDirect(pool, dmId, { label: 'प्रेस कक्ष' });
    const otherCookie = await unlockCookie(h.app, other.key);
    expect((await get(h.app, '/api/public/meta', cookie)).status).toBe(200);
    const s = await openStream(h.app, cookie);
    const t = await openStream(h.app, otherCookie);
    try {
      await waitFor(() => s.text().includes('event: snapshot'));
      await waitFor(() => t.text().includes('event: snapshot'));
      const res = await post(dm, `/api/admin/screen-keys/${String(key.id)}/revoke`);
      expect([res.status, res.body]).toEqual([200, { ok: true }]);
      await waitFor(() => s.ended());
      expect(s.text()).toContain('event: locked');
      expect((await get(h.app, '/api/public/meta', cookie)).status).toBe(401);
      expect((await get(h.app, '/api/public/stream', cookie)).status).toBe(401);
      expect((await unlock(h.app, key.key)).status).toBe(401);
      // The other key's TV keeps running.
      expect(t.ended()).toBe(false);
      expect((await get(h.app, '/api/public/meta', otherCookie)).status).toBe(200);
    } finally {
      await s.close();
      await t.close();
    }
    expect(
      await n('SELECT COUNT(*) AS n FROM screen_key WHERE id = ? AND key_enc IS NULL', [key.id]),
    ).toBe(1);
    expect(
      await n('SELECT COUNT(*) AS n FROM screen_session WHERE screen_key_id = ?', [key.id]),
    ).toBe(0);
    expect((await post(dm, `/api/admin/screen-keys/${String(key.id)}/revoke`)).status).toBe(409);
  });

  it('expiry: the next request is refused; open streams are closed by the periodic re-check', async () => {
    h.stop();
    h = harness({ streamRecheckMs: 100 });
    await h.snapshots.start();
    const key = await createKeyDirect(pool, dmId);
    const cookie = await unlockCookie(h.app, key.key);
    const s = await openStream(h.app, cookie);
    try {
      await waitFor(() => s.text().includes('event: snapshot'));
      await pool.execute(
        'UPDATE screen_key SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?',
        [key.id],
      );
      expect((await get(h.app, '/api/public/screens/1', cookie)).status).toBe(401);
      await waitFor(() => s.ended());
      expect(s.text()).toContain('event: locked');
    } finally {
      await s.close();
    }
    const dm = await loggedIn(h.app, 'DM');
    const list = (await dm.get('/api/admin/screen-keys')).body as {
      keys: { status: string; key: string | null }[];
    };
    expect(list.keys[0]).toMatchObject({ status: 'EXPIRED', key: null });
  });

  it('a session ends on its own when its own lifetime is over', async () => {
    const key = await createKeyDirect(pool, dmId);
    const cookie = await unlockCookie(h.app, key.key);
    await pool.execute('UPDATE screen_session SET expires_at = NOW(3) - INTERVAL 1 SECOND');
    expect((await get(h.app, '/api/public/meta', cookie)).status).toBe(401);
  });
});

describe('brute force: per-IP limit and lockout', () => {
  it('locks the popup after repeated failures (even the right key), audits ONCE; staff login and unlocked TVs are unaffected', async () => {
    h.stop();
    h = harness({ unlockFailureLimit: { limit: 3, windowMs: 60_000 } });
    await h.snapshots.start();
    const key = await createKeyDirect(pool, dmId);
    const tv = await unlockCookie(h.app, key.key); // a TV unlocked before the attack
    // Correct keys do not count toward the failure limit.
    for (let i = 0; i < 4; i++) expect((await unlock(h.app, key.key)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await unlock(h.app, 'WRNG-WRNG-WRNG')).status).toBe(401);
    for (const typed of ['WRNG-WRNG-WRNG', key.key, key.key]) {
      const res = await unlock(h.app, typed);
      expect([res.status, (res.body as { error: string }).error]).toEqual([
        429,
        'TOO_MANY_ATTEMPTS',
      ]);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    await waitFor(async () =>
      (await n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'SCREEN_UNLOCK_LOCKED_OUT'")) ===
      1
        ? true
        : undefined,
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value, ip FROM audit_log WHERE action = 'SCREEN_UNLOCK_LOCKED_OUT'",
    );
    expect(rows[0]?.new_value).toEqual({ failures: 3, windowMinutes: 1 });
    expect(rows[0]?.ip).toBeTruthy();
    // Same IP: the unlocked TV keeps working, and staff can still log in.
    expect((await get(h.app, '/api/public/meta', tv)).status).toBe(200);
    await createUser(pool, { username: 'staff_ro', role: 'ZP_RO', password: PASSWORD });
    const staff = request.agent(h.app);
    expect((await login(staff, 'staff_ro', PASSWORD)).status).toBe(200);
  });

  it('caps all attempts (correct ones too) per IP', async () => {
    h.stop();
    h = harness({ unlockTotalLimit: { limit: 3, windowMs: 60_000 } });
    const key = await createKeyDirect(pool, dmId);
    for (let i = 0; i < 3; i++) expect((await unlock(h.app, key.key)).status).toBe(200);
    expect((await unlock(h.app, key.key)).status).toBe(429);
  });

  it('the login limiter does not lock the key popup either (separate counters)', async () => {
    h.stop();
    h = harness();
    const app = createApp({
      pool,
      config: testAppConfig({ loginRateLimit: { limit: 2, windowMs: 60_000 } }),
    });
    for (let i = 0; i < 3; i++) await login(request.agent(app), 'nobody', 'wrong-password-x');
    expect((await login(request.agent(app), 'nobody', 'wrong-password-x')).status).toBe(429);
    const key = await createKeyDirect(pool, dmId);
    expect((await unlock(app, key.key)).status).toBe(200);
  });
});

describe('DM section: role matrix', () => {
  const READS = ['/api/admin/screen-keys'];
  const WRITES = [
    '/api/admin/screen-keys/create',
    '/api/admin/screen-keys/1/revoke',
    '/api/admin/screen-keys/1/renew',
    '/api/admin/screen-keys/preview',
  ];

  it('not logged in 401; PS_RO, ZP_RO and SUPER_ADMIN 403 (nothing created); DM allowed', async () => {
    for (const path of READS) expect((await request(h.app).get(path)).status).toBe(401);
    const anon = request.agent(h.app);
    for (const path of WRITES) expect((await post(anon, path, {})).status, path).toBe(401);
    const { ps1 } = await seedTwoPs(pool);
    const key = await createKeyDirect(pool, dmId);
    const others: [Role, number | null][] = [
      ['PS_RO', ps1],
      ['ZP_RO', null],
      ['SUPER_ADMIN', null],
    ];
    for (const [role, psId] of others) {
      const agent = await loggedIn(h.app, role, psId);
      for (const path of READS) expect((await agent.get(path)).status, `${role} ${path}`).toBe(403);
      for (const path of [...WRITES, `/api/admin/screen-keys/${String(key.id)}/revoke`]) {
        const res = await post(agent, path, { label: 'x', expiresAt: null });
        expect(res.status, `${role} ${path}`).toBe(403);
        expect(res.headers['set-cookie'] ?? []).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/^churu\.screen=/)]),
        );
      }
    }
    expect(await n('SELECT COUNT(*) AS n FROM screen_key')).toBe(1);
    expect(await n('SELECT COUNT(*) AS n FROM screen_key WHERE revoked_at IS NOT NULL')).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM screen_session')).toBe(0);
    const dm = await loggedIn(h.app, 'DM');
    expect((await dm.get('/api/admin/screen-keys')).status).toBe(200);
  });

  it('the DM write allow-list has exactly these paths', () => {
    for (const path of [
      '/api/admin/screen-keys/create',
      '/api/admin/screen-keys/preview',
      '/api/admin/screen-keys/12/revoke',
      '/api/admin/screen-keys/12/renew',
    ])
      expect(dmWriteAllowed('POST', path), path).toBe(true);
    for (const path of [
      '/api/admin/screen-keys/12/delete',
      '/api/admin/screen-keys/0/revoke',
      '/api/admin/screen-keys',
    ])
      expect(dmWriteAllowed('POST', path), path).toBe(false);
    expect(dmWriteAllowed('PUT', '/api/admin/screen-keys/create')).toBe(false);
  });
});

describe('DM section: create, list, revoke, renew, preview (audited, key never in the audit)', () => {
  it('works end to end and writes one audit row per action', async () => {
    const dm = await loggedIn(h.app, 'DM');
    const a = await post(dm, '/api/admin/screen-keys/create', {
      label: '  प्रेस   कक्ष ',
      expiresAt: null,
    });
    expect(a.status).toBe(201);
    const keyA = (a.body as { key: { id: number; key: string; label: string; status: string } })
      .key;
    expect(keyA).toMatchObject({ label: 'प्रेस कक्ष', status: 'ACTIVE', expiresAt: null });
    expect(keyA.key).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(a.headers['cache-control']).toBe('no-store');

    // Expiry: must be ahead; a time two hours ahead is accepted.
    const past = await post(dm, '/api/admin/screen-keys/create', {
      label: 'x',
      expiresAt: '2020-01-01T10:00',
    });
    expect([past.status, (past.body as { error: string }).error]).toEqual([
      400,
      'EXPIRY_NOT_IN_FUTURE',
    ]);
    const [nowRows] = await pool.query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(NOW() + INTERVAL 2 HOUR, '%Y-%m-%dT%H:%i') AS t",
    );
    const b = await post(dm, '/api/admin/screen-keys/create', {
      label: 'मुख्य हॉल TV',
      expiresAt: String(nowRows[0]?.t),
    });
    expect(b.status).toBe(201);
    const keyB = (b.body as { key: { id: number; key: string; expiresAt: string } }).key;
    expect(keyB.expiresAt).not.toBeNull();
    for (const bad of [
      { label: '', expiresAt: null },
      { label: 'x'.repeat(61), expiresAt: null },
    ])
      expect((await post(dm, '/api/admin/screen-keys/create', bad)).status).toBe(400);

    await unlockCookie(h.app, keyA.key);
    const list = (await dm.get('/api/admin/screen-keys')).body as {
      keys: { id: number; key: string | null; activeScreens: number; lastUsedAt: string | null }[];
    };
    expect(list.keys.map((k) => k.id)).toEqual([keyB.id, keyA.id]);
    expect(list.keys.find((k) => k.id === keyA.id)).toMatchObject({
      key: keyA.key,
      activeScreens: 1,
    });
    expect(list.keys.find((k) => k.id === keyA.id)?.lastUsedAt).not.toBeNull();

    // Renew: old key revoked, new key with the same label (and the same, still-ahead expiry).
    const renewed = await post(dm, `/api/admin/screen-keys/${String(keyB.id)}/renew`);
    expect(renewed.status).toBe(201);
    const keyC = (
      renewed.body as { key: { id: number; key: string; label: string; expiresAt: string } }
    ).key;
    expect(keyC).toMatchObject({ label: 'मुख्य हॉल TV', expiresAt: keyB.expiresAt });
    expect(keyC.key).not.toBe(keyB.key);
    expect((await unlock(h.app, keyB.key)).status).toBe(401);
    expect((await unlock(h.app, keyC.key)).status).toBe(200);
    // Renewing a revoked key just makes a new one.
    expect((await post(dm, `/api/admin/screen-keys/${String(keyB.id)}/renew`)).status).toBe(201);
    expect((await post(dm, '/api/admin/screen-keys/9999/revoke')).status).toBe(404);

    // Preview: the DM's browser opens the screens without typing a key.
    const preview = await post(dm, '/api/admin/screen-keys/preview');
    expect(preview.status).toBe(200);
    const previewCookie = screenCookieOf(preview) ?? '';
    expect(previewCookie).toMatch(/^churu\.screen=/);
    expect((await get(h.app, '/api/public/screens/3', previewCookie)).status).toBe(200);

    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT action, entity_id, user_id FROM audit_log WHERE action LIKE 'SCREEN%' ORDER BY id",
    );
    expect(audit.map((r) => String(r.action))).toEqual([
      'SCREEN_KEY_CREATED',
      'SCREEN_KEY_CREATED',
      'SCREEN_UNLOCKED',
      'SCREEN_KEY_REVOKED',
      'SCREEN_KEY_CREATED',
      'SCREEN_UNLOCKED',
      'SCREEN_KEY_CREATED',
      'SCREEN_PREVIEW_OPENED',
    ]);
    expect(
      audit.filter((r) => r.action !== 'SCREEN_UNLOCKED').every((r) => Number(r.user_id) === dmId),
    ).toBe(true);

    // The preview ends when the DM account is disabled.
    await pool.execute('UPDATE users SET is_active = 0 WHERE id = ?', [dmId]);
    expect((await get(h.app, '/api/public/screens/3', previewCookie)).status).toBe(401);
  });
});

describe('the key never leaks', () => {
  it('not in logs, audit rows, stored columns, or any response except the DM list/create/renew', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const dm = await loggedIn(h.app, 'DM');
      const created = await post(dm, '/api/admin/screen-keys/create', {
        label: 'मुख्य हॉल TV',
        expiresAt: null,
      });
      const key = (created.body as { key: { id: number; key: string } }).key;
      const canonical = normalizeScreenKey(key.key) ?? '';
      const responses: string[] = [];
      const record = (res: { text: string; headers: Record<string, unknown> }) =>
        responses.push(res.text + JSON.stringify(res.headers));
      const ok = await unlock(h.app, key.key.toLowerCase());
      record(ok);
      record(await unlock(h.app, `${key.key}X`));
      const cookie = screenCookieOf(ok) ?? '';
      for (const path of PUBLIC_PATHS) record(await get(h.app, path, cookie));
      record(await post(dm, '/api/admin/screen-keys/preview'));
      record(await post(dm, `/api/admin/screen-keys/${String(key.id)}/revoke`));
      record(await get(h.app, '/api/public/meta', cookie));
      record(await unlock(h.app, key.key));
      for (const text of responses) {
        expect(text).not.toContain(key.key);
        expect(text).not.toContain(canonical);
      }
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join('\n');
      expect(logged).not.toContain(key.key);
      expect(logged).not.toContain(canonical);
      const [audit] = await pool.execute<RowDataPacket[]>(
        'SELECT CONCAT_WS("|", action, entity, IFNULL(old_value, ""), IFNULL(new_value, ""), IFNULL(reason, "")) AS t FROM audit_log',
      );
      for (const r of audit) {
        expect(String(r.t)).not.toContain(key.key);
        expect(String(r.t)).not.toContain(canonical);
      }
      // Stored: an HMAC and (until revoked) an AES-GCM copy, never the key's text.
      const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
      for (const needle of [hex(key.key), hex(canonical)]) {
        expect(
          await n(
            `SELECT COUNT(*) AS n FROM screen_key
              WHERE LOCATE(?, HEX(key_hash)) > 0 OR LOCATE(?, IFNULL(HEX(key_enc), '')) > 0
                 OR LOCATE(?, HEX(label)) > 0`,
            [needle, needle, needle],
          ),
        ).toBe(0);
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('the dashboard origin check still protects the DM routes', () => {
  it('a foreign Origin is refused on create', async () => {
    const dm = await loggedIn(h.app, 'DM');
    const token = await csrfToken(dm);
    const res = await dm
      .post('/api/admin/screen-keys/create')
      .set('X-CSRF-Token', token)
      .set('Origin', 'https://evil.example')
      .send({ label: 'x', expiresAt: null });
    expect(res.status).toBe(403);
    const missingCsrf = await dm
      .post('/api/admin/screen-keys/create')
      .set('Origin', TEST_ORIGIN)
      .send({ label: 'x', expiresAt: null });
    expect([missingCsrf.status, missingCsrf.body]).toEqual([403, { error: 'CSRF_FAILED' }]);
    expect(await n('SELECT COUNT(*) AS n FROM screen_key')).toBe(0);
  });
});
