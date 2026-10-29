// Super Admin panel: permissions, counting lock, pre-checks before backups, confirm window, each
// task, plain messages only — against the real test database.
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_TABLE_PRIVILEGES } from '../../src/db/grants.js';
import { CANDIDATE_COLUMNS } from '../../src/services/master-data/candidates.js';
import {
  KEPT_TABLES,
  MASTER_DATA_TABLES,
  TEST_DATA_TABLES,
} from '../../src/services/setup/data-reset.js';
import { COLUMNS } from '../../src/services/setup/geography.js';
import { VOTER_COLUMNS, VOTER_OPTIONAL_COLUMNS } from '../../src/services/setup/voters.js';
import { createUser, login } from '../auth/helpers.js';
import { PASSWORD, adminApp, apiClient, buildAdminWorld, xlsxBase64 } from '../admin/helpers.js';
import type { AdminWorld, ApiClient } from '../admin/helpers.js';
import { clientFor, countingApp, psW1Sheet } from '../counting/helpers.js';
import { confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData, testEnv } from '../helpers/db.js';

const SA = 'super_admin_t1';
const SA_PASSWORD = 'Super-Admin-Pass-1';
const DEVANAGARI = /[ऀ-ॿ]/;

let pool: Pool;
let migrator: Pool;
let backupDir: string;
let app: Express;
let w: AdminWorld;
let sa: ApiClient;

async function n(sql: string, params: (string | number)[] = []): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}
const auditCount = async (action: string) =>
  n(
    'SELECT COUNT(*) AS n FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.action = ? AND u.username = ?',
    [action, SA],
  );
const backups = async () =>
  (await readdir(backupDir).catch(() => [])).filter((f) => /^churu-.+\.sql\.gz$/.test(f));

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  backupDir = await mkdtemp(join(tmpdir(), 'churu-backups-'));
  // The usual test app plus the setup config (backup folder, migration user).
  app = countingApp(pool, {
    loginRateLimit: { limit: 10_000, windowMs: 60_000 },
    setup: {
      backupDir,
      nodeEnv: 'test',
      migrationDb: {
        host: testEnv.DB_HOST,
        port: testEnv.DB_PORT,
        database: testEnv.TEST_DB,
        user: testEnv.DB_MIGRATION_USER,
        password: testEnv.DB_MIGRATION_PASSWORD,
      },
    },
  });
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

beforeEach(async () => {
  await resetData(migrator);
  await rm(backupDir, { recursive: true, force: true });
  w = await buildAdminWorld(pool);
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: SA_PASSWORD });
  sa = await apiClient(app, SA, SA_PASSWORD);
});

async function lockOn() {
  expect((await sa.post('/api/superadmin/counting-lock', { on: true })).status).toBe(200);
}
async function enterB1() {
  const ro = await clientFor(app, 'ro_ps1_x1');
  expect((await ro.post('/entries', psW1Sheet(w, w.b1))).status).toBe(201);
}
async function declarePsW1() {
  const ro = await declareClient(app, 'ro_ps1_x1');
  await fillPsW1(ro, w);
  const res = await ro.dpost(
    `/wards/${String(w.psW1)}`,
    confirmBody(await previewResult(ro, w.psW1)),
  );
  expect(res.status).toBe(201);
}

function boothBody(over: Record<string, unknown> = {}) {
  return {
    psId: w.ps1,
    boothNo: 50,
    nameHindi: 'नया बूथ पचास',
    nameEnglish: 'New Booth 50',
    psWardNo: 5,
    zpWardNo: 2,
    votersMale: 300,
    votersFemale: 280,
    votersOther: 1,
    ...over,
  };
}

describe('role and permissions', () => {
  it('the database allows exactly one active SUPER_ADMIN and no PS for it', async () => {
    await expect(
      createUser(pool, { username: 'super_admin_t2', role: 'SUPER_ADMIN', password: 'x' }),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      createUser(pool, {
        username: 'super_admin_t3',
        role: 'SUPER_ADMIN',
        psId: w.ps1,
        password: 'x',
        active: false,
      }),
    ).rejects.toThrow(/chk_users_role_ps/);
  });

  it('the Super Admin can use the panel and nothing else', async () => {
    expect((await sa.get('/api/superadmin/overview')).status).toBe(200);
    for (const path of ['/api/admin/users', '/api/reports/summary', '/api/counting/wards']) {
      expect((await sa.get(path)).status).toBe(403);
    }
    expect((await sa.post('/api/counting/entries', psW1Sheet(w, w.b1))).status).toBe(403);
  });

  it('DM, ROs and anonymous users cannot use the panel', async () => {
    for (const username of ['dm_x4', 'ro_ps1_x1', 'zp_ro_x3']) {
      const c = await apiClient(app, username, PASSWORD);
      expect((await c.get('/api/superadmin/overview')).status).toBe(403);
      expect((await c.post('/api/superadmin/counting-lock', { on: true })).status).toBe(403);
    }
    expect((await request(app).get('/api/superadmin/overview')).status).toBe(401);
  });

  it('the DM user tools never touch the Super Admin account', async () => {
    const dm = await apiClient(app, 'dm_x4', PASSWORD);
    const id = await n('SELECT id AS n FROM users WHERE username = ?', [SA]);
    expect((await dm.post(`/api/admin/users/${String(id)}/disable`)).status).toBe(403);
  });

  it('refuses with 503 when backups are not configured', async () => {
    const c = await apiClient(adminApp(pool), SA, SA_PASSWORD);
    const res = await c.post('/api/superadmin/test-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.status).toBe(503);
  });
});

describe('counting lock', () => {
  it('ON blocks every data change for everyone, and no backup is made', async () => {
    await lockOn();
    const ov = (await sa.get('/api/superadmin/overview')).body as {
      testData: { allowed: boolean; reason: string };
      masterData: { allowed: boolean; reason: string };
      booths: { allowed: boolean; reason: string };
    };
    for (const task of [ov.testData, ov.masterData, ov.booths]) {
      expect(task.allowed).toBe(false);
      expect(task.reason).toMatch(DEVANAGARI);
    }
    const geo = await xlsxBase64([...Object.values(COLUMNS)], []);
    const results = [
      await sa.post('/api/superadmin/test-data/reset', {
        password: SA_PASSWORD,
        confirmText: 'RESET',
      }),
      await sa.post('/api/superadmin/master-data/run', {
        geography: { fileName: 'g.xlsx', fileBase64: geo },
        voters: { fileName: 'v.xlsx', fileBase64: geo },
        password: SA_PASSWORD,
        confirmText: 'RESET',
      }),
      await sa.post('/api/superadmin/booths/add', boothBody()),
      await sa.post(`/api/superadmin/booths/${String(w.b7)}/delete`, {
        password: SA_PASSWORD,
        confirmText: '7',
      }),
    ];
    for (const res of results) expect(res.status).toBe(423);
    expect(await backups()).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM booth WHERE id = ?', [w.b7])).toBe(1);
  });

  it('OFF needs "UNLOCK" and the password; both switches are audited', async () => {
    await lockOn();
    const noWord = await sa.post('/api/superadmin/counting-lock', {
      on: false,
      password: SA_PASSWORD,
      confirmText: 'unlock',
    });
    expect(noWord.status).toBe(400);
    const noPw = await sa.post('/api/superadmin/counting-lock', {
      on: false,
      confirmText: 'UNLOCK',
    });
    expect(noPw.status).toBe(401);
    expect(noPw.body).toMatchObject({ error: 'PASSWORD_REQUIRED' });
    const badPw = await sa.post('/api/superadmin/counting-lock', {
      on: false,
      password: 'wrong-password-1',
      confirmText: 'UNLOCK',
    });
    expect(badPw.status).toBe(401);
    const off = await sa.post('/api/superadmin/counting-lock', {
      on: false,
      password: SA_PASSWORD,
      confirmText: 'UNLOCK',
    });
    expect(off.status).toBe(200);
    expect(await auditCount('COUNTING_LOCK_ON')).toBe(1);
    expect(await auditCount('COUNTING_LOCK_OFF')).toBe(1);
  });
});

describe('confirm window (password once per 15 minutes)', () => {
  it('after one password, the next dangerous action needs only the typed word; logout ends it', async () => {
    await enterB1();
    const first = await sa.post('/api/superadmin/test-data/reset', { confirmText: 'RESET' });
    expect(first.status).toBe(401);
    expect(first.body).toMatchObject({ error: 'PASSWORD_REQUIRED' });
    const ok = await sa.post('/api/superadmin/test-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(ok.status).toBe(200);
    const until = ((await sa.get('/api/superadmin/overview')).body as { confirmedUntil: number })
      .confirmedUntil;
    expect(until).toBeGreaterThan(Date.now() + 14 * 60_000);
    const del = await sa.post(`/api/superadmin/booths/${String(w.b7)}/delete`, {
      confirmText: '7',
    });
    expect(del.status).toBe(200);

    await sa.post('/api/auth/logout');
    const again = await apiClient(app, SA, SA_PASSWORD);
    const after = await again.post(`/api/superadmin/booths/${String(w.b1)}/delete`, {
      confirmText: '1',
    });
    expect(after.status).toBe(401);
  });

  it('booth add, DM email, DM unlock and lock ON need no password', async () => {
    expect((await sa.post('/api/superadmin/booths/add', boothBody())).status).toBe(201);
    const email = await sa.post('/api/superadmin/dm/email', { email: 'dm@example.in' });
    expect(email.body).toMatchObject({ ok: true });
    expect((await sa.post('/api/superadmin/dm/unlock')).status).toBe(200);
    await lockOn();
  });
});

describe('test-data reset', () => {
  it('works with a declared ward: clears counting data, keeps master data and the audit log', async () => {
    await declarePsW1();
    expect(await n('SELECT COUNT(*) AS n FROM ward_declarations')).toBe(1);
    const auditBefore = await n('SELECT COUNT(*) AS n FROM audit_log');
    const keep = async () => [
      await n('SELECT COUNT(*) AS n FROM booth'),
      await n('SELECT COUNT(*) AS n FROM ward'),
      await n('SELECT COUNT(*) AS n FROM party'),
      await n('SELECT COUNT(*) AS n FROM users'),
      await n('SELECT COALESCE(SUM(registered_voters_total), 0) AS n FROM booth'),
    ];
    const kept = await keep();

    const ov = (await sa.get('/api/superadmin/overview')).body as {
      testData: { allowed: boolean; deletes: { declaredWards: number; boothEntries: number } };
    };
    expect(ov.testData.allowed).toBe(true);
    expect(ov.testData.deletes).toMatchObject({ declaredWards: 1, boothEntries: 3 });

    const res = await sa.post('/api/superadmin/test-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.status).toBe(200);
    const body = res.body as { backupFile: string; deleted: { declaredWards: number } };
    expect(body.deleted.declaredWards).toBe(1);
    expect(body.backupFile).toMatch(/^churu-test-data-.+\.sql\.gz$/); // a name, never a path
    for (const t of TEST_DATA_TABLES) expect(await n(`SELECT COUNT(*) AS n FROM ${t}`)).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM ward WHERE is_locked = 1')).toBe(0);
    expect(await keep()).toEqual(kept);
    // The audit log is never emptied: every old row stays, plus TEST_DATA_RESET.
    expect(await n('SELECT COUNT(*) AS n FROM audit_log')).toBeGreaterThan(auditBefore);
    expect(await auditCount('TEST_DATA_RESET')).toBe(1);
    // Append-only is still enforced for the app user.
    await expect(pool.execute('DELETE FROM audit_log')).rejects.toThrow();
    await expect(pool.execute('DELETE FROM ward_declarations')).rejects.toThrow();

    const sql = gunzipSync(await readFile(join(backupDir, body.backupFile))).toString('utf8');
    expect(sql).toContain('INSERT INTO `ward_declarations`');
    expect(sql).toContain('INSERT IGNORE INTO `audit_log`');
    expect(sql).not.toContain('TRUNCATE TABLE `audit_log`');
    expect(sql).not.toMatch(/DROP TABLE|CREATE TABLE/);
  });

  it('needs "RESET" and the right password; a refused action makes no backup', async () => {
    await enterB1();
    const res = await sa.post('/api/superadmin/test-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'reset',
    });
    expect(res.status).toBe(400);
    const pw = await sa.post('/api/superadmin/test-data/reset', {
      password: 'wrong-password-1',
      confirmText: 'RESET',
    });
    expect(pw.status).toBe(401);
    expect(await backups()).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM booth_entry')).toBe(1);
  });
});

describe('booths', () => {
  it('adds with a backup and an audit row; a duplicate is refused before any backup', async () => {
    const res = await sa.post('/api/superadmin/booths/add', boothBody());
    expect(res.status).toBe(201);
    expect((res.body as { backupFile: string }).backupFile).toMatch(/^churu-booth-add-/);
    expect(await auditCount('BOOTH_ADDED')).toBe(1);
    expect(await backups()).toHaveLength(1);
    expect((await sa.post('/api/superadmin/booths/add', boothBody())).status).toBe(409);
    expect(await backups()).toHaveLength(1);
  });

  it('a ward with data is shown closed and refused before any backup', async () => {
    await enterB1();
    const wards = (await sa.get(`/api/superadmin/wards?psId=${String(w.ps1)}`)).body as {
      psWards: { wardNo: number; open: boolean }[];
    };
    expect(wards.psWards.find((x) => x.wardNo === 1)?.open).toBe(false);
    expect(wards.psWards.find((x) => x.wardNo === 5)?.open).toBe(true);
    const res = await sa.post('/api/superadmin/booths/add', boothBody({ psWardNo: 1 }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'WARD_HAS_ENTRIES' });
    const del = await sa.post(`/api/superadmin/booths/${String(w.b2)}/delete`, {
      password: SA_PASSWORD,
      confirmText: '2',
    });
    expect(del.status).toBe(409);
    expect(await backups()).toEqual([]);
  });

  it('deletes only after the booth number is typed', async () => {
    const wrong = await sa.post(`/api/superadmin/booths/${String(w.b7)}/delete`, {
      password: SA_PASSWORD,
      confirmText: '8',
    });
    expect(wrong.status).toBe(400);
    expect(await backups()).toEqual([]);
    const ok = await sa.post(`/api/superadmin/booths/${String(w.b7)}/delete`, {
      password: SA_PASSWORD,
      confirmText: '7',
    });
    expect(ok.status).toBe(200);
    expect(await auditCount('BOOTH_DELETED')).toBe(1);
  });
});

describe('DM account', () => {
  it('new password (shown once, the DM can log in); a bad email gives plain problems', async () => {
    const res = await sa.post('/api/superadmin/dm/reset-password', { password: SA_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const { newPassword } = res.body as { newPassword: string };
    expect((await login(request.agent(app), 'dm_x4', newPassword)).status).toBe(200);
    expect(await auditCount('USER_RESET_PASSWORD')).toBe(1);
    const bad = await sa.post('/api/superadmin/dm/email', { email: 'not-an-email' });
    const problems = (bad.body as { problems: string[] }).problems;
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) expect(p).toMatch(DEVANAGARI);
  });
});

// ---------------------------------------------------------------- master data

const PS_A = 'CHURU PANCHAYAT SAMITI';
const PS_B = 'RAJGARH PANCHAYAT SAMITI';
const geoRow = (ps: string, booth: number, psWard: number, zpWard: number) => [
  'CHURU',
  ps,
  'Gram',
  1,
  booth,
  `विद्यालय ${String(booth)}`,
  `School ${String(booth)}`,
  psWard,
  zpWard,
];
const voterRow = (ps: string, booth: number, total: number) => [ps, booth, total - 10, 10, total];

async function masterFiles(dropVoterBooth = false) {
  const geography = await xlsxBase64(
    [...Object.values(COLUMNS)],
    [geoRow(PS_A, 1, 1, 1), geoRow(PS_A, 2, 2, 1), geoRow(PS_B, 1, 1, 2)],
  );
  const voters = await xlsxBase64(
    [...VOTER_COLUMNS],
    [
      voterRow(PS_A, 1, 500),
      voterRow(PS_A, 2, 600),
      ...(dropVoterBooth ? [] : [voterRow(PS_B, 1, 700)]),
    ],
  );
  return {
    geography: { fileName: 'geo.xlsx', fileBase64: geography },
    voters: { fileName: 'voters.xlsx', fileBase64: voters },
  };
}

describe('master-data replace', () => {
  it('empties everything except the kept tables (audit_log is always kept)', () => {
    expect([...MASTER_DATA_TABLES, ...KEPT_TABLES].sort()).toEqual(
      Object.keys(APP_TABLE_PRIVILEGES).sort(),
    );
    expect(MASTER_DATA_TABLES).not.toContain('audit_log');
    expect(TEST_DATA_TABLES).not.toContain('audit_log');
    for (const t of TEST_DATA_TABLES) expect(MASTER_DATA_TABLES).toContain(t);
  });

  it('dry run: counts and plain problems; the database is not touched', async () => {
    const before = await n('SELECT COUNT(*) AS n FROM candidate');
    const res = await sa.post('/api/superadmin/master-data/check', await masterFiles());
    expect(res.body).toMatchObject({
      ok: true,
      counts: { panchayatSamitis: 2, psWards: 3, zpWards: 2, booths: 3 },
      totalVoters: 1800,
    });
    const bad = await sa.post('/api/superadmin/master-data/check', await masterFiles(true));
    const body = bad.body as { ok: boolean; problems: string[] };
    expect(body.ok).toBe(false);
    expect(body.problems.join('\n')).toContain('Booth 1 (RAJGARH PANCHAYAT SAMITI)');
    for (const p of body.problems) expect(p).toMatch(DEVANAGARI);
    expect(await n('SELECT COUNT(*) AS n FROM candidate')).toBe(before);
    expect(await backups()).toEqual([]);
  });

  it('a bad file stops the run before any backup or change', async () => {
    const res = await sa.post('/api/superadmin/master-data/run', {
      ...(await masterFiles(true)),
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.body).toMatchObject({ status: 'CHECK_FAILED', ok: false });
    expect(await backups()).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM candidate')).toBeGreaterThan(0);
  });

  it('replaces data; keeps users, settings, Hindi names (by default) and the audit log', async () => {
    await declarePsW1();
    await pool.execute("UPDATE panchayat_samiti SET name_hindi = 'राजगढ़' WHERE name_english = ?", [
      PS_B,
    ]);
    const users = await n('SELECT COUNT(*) AS n FROM users');
    const settings = await n('SELECT COUNT(*) AS n FROM app_settings');
    const auditBefore = await n('SELECT MAX(id) AS n FROM audit_log');
    const auditRows = await n('SELECT COUNT(*) AS n FROM audit_log');

    const res = await sa.post('/api/superadmin/master-data/run', {
      ...(await masterFiles()),
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.body).toMatchObject({ status: 'DONE', ok: true });
    expect((res.body as { backupFile: string }).backupFile).toMatch(/^churu-master-data-/);
    expect(await n('SELECT COUNT(*) AS n FROM users')).toBe(users);
    expect(await n('SELECT COUNT(*) AS n FROM app_settings')).toBe(settings);
    for (const t of ['candidate', 'party', 'booth_entry', 'ward_declarations']) {
      expect(await n(`SELECT COUNT(*) AS n FROM ${t}`)).toBe(0);
    }
    expect(await n('SELECT COUNT(*) AS n FROM booth')).toBe(3);
    expect(await n('SELECT SUM(registered_voters_total) AS n FROM booth')).toBe(1800);
    expect(await n("SELECT COUNT(*) AS n FROM panchayat_samiti WHERE name_hindi = 'राजगढ़'")).toBe(
      1,
    );
    expect(await n('SELECT COUNT(*) AS n FROM audit_log WHERE id <= ?', [auditBefore])).toBe(
      auditRows,
    );
    expect(await auditCount('FULL_RESET')).toBe(1);
  });

  it('an uploaded fixes file becomes the default for next time', async () => {
    const fixes = [
      {
        panchayat_samiti: PS_A,
        booth_no: 2,
        field: 'name_english',
        value: 'Fixed School 2',
        reason: 'RO letter',
        approved_by: 'RO Churu',
        approved_on: '2026-10-01',
      },
    ];
    const res = await sa.post('/api/superadmin/master-data/run', {
      ...(await masterFiles()),
      fixes: { fileName: 'fixes.json', text: JSON.stringify(fixes) },
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.body).toMatchObject({ status: 'DONE' });
    const ov = (await sa.get('/api/superadmin/overview')).body as {
      masterData: { defaults: { fixes: { entries: number } | null } };
    };
    expect(ov.masterData.defaults.fixes?.entries).toBe(1);
    // The next run without a fixes upload still applies it (inside the confirm window).
    const next = await sa.post('/api/superadmin/master-data/run', {
      ...(await masterFiles()),
      confirmText: 'RESET',
    });
    expect(next.body).toMatchObject({ status: 'DONE' });
    expect(await n("SELECT COUNT(*) AS n FROM booth WHERE name_english = 'Fixed School 2'")).toBe(
      1,
    );
  });
});

describe('backups', () => {
  it('keeps only the newest 20 and never deletes the new one', async () => {
    await mkdir(backupDir, { recursive: true });
    const old = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 25; i++) {
      const path = join(backupDir, `churu-old-${String(i).padStart(2, '0')}.sql.gz`);
      await writeFile(path, 'x');
      await utimes(path, old, new Date(old.getTime() + i * 1000));
    }
    await writeFile(join(backupDir, 'keep-me.txt'), 'not a backup');
    const res = await sa.post('/api/superadmin/booths/add', boothBody());
    expect(res.status).toBe(201);
    const files = await backups();
    expect(files).toHaveLength(20);
    expect(files).toContain((res.body as { backupFile: string }).backupFile);
    expect(files).toContain('churu-old-24.sql.gz');
    expect(files).not.toContain('churu-old-00.sql.gz');
    expect((await readdir(backupDir)).includes('keep-me.txt')).toBe(true);
  });

  it('only the shared data-reset routine opens a migration-user connection', async () => {
    const root = join(import.meta.dirname, '../../src');
    const users: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, e.name);
        if (e.isDirectory()) await walk(path);
        else if ((await readFile(path, 'utf8')).includes('createConnection('))
          users.push(path.slice(root.length + 1));
      }
    };
    await walk(root);
    expect(users).toEqual(['services/setup/data-reset.ts']);
  });
});

describe('sample files', () => {
  async function download(path: string, client: ApiClient = sa): Promise<Buffer> {
    const res = await client.agent
      .get(path)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        r.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect(res.status).toBe(200);
    return res.body as Buffer;
  }
  async function headers(path: string, client: ApiClient = sa) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await download(path, client)) as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const row = (i: number) => ((sheet?.getRow(i).values ?? []) as unknown[]).slice(1);
    return { header: row(1), note: row(2) };
  }

  it('use exactly the importer columns, with a note row', async () => {
    const geo = await headers('/api/superadmin/samples/geography');
    expect(geo.header).toEqual(Object.values(COLUMNS));
    expect(String(geo.note[0])).toContain('EXAMPLE');
    expect((await headers('/api/superadmin/samples/voters')).header).toEqual([
      ...VOTER_COLUMNS,
      ...VOTER_OPTIONAL_COLUMNS,
    ]);
    const cand = await headers('/api/superadmin/samples/candidates');
    expect(cand.header.slice(0, CANDIDATE_COLUMNS.length)).toEqual([...CANDIDATE_COLUMNS]);
    const dm = await apiClient(app, 'dm_x4', PASSWORD);
    expect((await headers('/api/admin/templates/candidates.xlsx', dm)).header).toEqual(cand.header);
  });

  it('an unchanged sample is refused (EXAMPLE rows), with plain messages', async () => {
    const data = await download('/api/superadmin/samples/geography');
    const file = { fileName: 'g.xlsx', fileBase64: data.toString('base64') };
    const check = await sa.post('/api/superadmin/master-data/check', {
      geography: file,
      voters: file,
    });
    const body = check.body as { ok: boolean; problems: string[] };
    expect(body.ok).toBe(false);
    for (const p of body.problems) expect(p).toMatch(DEVANAGARI);
  });
});
