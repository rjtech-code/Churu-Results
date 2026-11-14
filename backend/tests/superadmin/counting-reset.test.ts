// Super Admin "मतगणना डेटा हटाएँ" (counting-only reset): it deletes EXACTLY what the ROs entered and
// nothing else — candidates, the candidate change history, every ward's candidate-list lock / ready
// state and the ZP postal assignment all survive, with counts asserted before and after. Afterwards
// every ward reads "not started" with its ballot still locked and the reports show zero counting.
// The existing full reset ("परीक्षण डेटा साफ़ करें") is checked to be unchanged.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COUNTING_DATA_TABLES, TEST_DATA_TABLES } from '../../src/services/setup/data-reset.js';
import { createUser } from '../auth/helpers.js';
import { PASSWORD, apiClient, buildAdminWorld } from '../admin/helpers.js';
import type { AdminWorld, ApiClient } from '../admin/helpers.js';
import { assignZpPostal, clientFor, countingApp, zW1Sheet } from '../counting/helpers.js';
import { confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData, testEnv } from '../helpers/db.js';

const SA = 'super_admin_c1';
const SA_PASSWORD = 'Super-Admin-Pass-2';
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

/** Everything the counting-only reset must KEEP, as raw counts. */
async function setupCounts() {
  return {
    candidates: await n('SELECT COUNT(*) AS n FROM candidate'),
    realCandidates: await n('SELECT COUNT(*) AS n FROM candidate WHERE is_nota = 0'),
    nameChanges: await n('SELECT COUNT(*) AS n FROM candidate_name_change'),
    lockedWards: await n('SELECT COUNT(*) AS n FROM ward WHERE is_locked = 1'),
    lockedAt: await n('SELECT COUNT(*) AS n FROM ward WHERE locked_at IS NOT NULL'),
    lockedByName: await n('SELECT COUNT(*) AS n FROM ward WHERE locked_by_name IS NOT NULL'),
    readyWards: await n('SELECT COUNT(*) AS n FROM ward WHERE candidates_ready_at IS NOT NULL'),
    returnedWards: await n(
      'SELECT COUNT(*) AS n FROM ward WHERE candidates_return_reason IS NOT NULL',
    ),
    unopposedWards: await n('SELECT COUNT(*) AS n FROM ward WHERE is_unopposed = 1'),
    booths: await n('SELECT COUNT(*) AS n FROM booth'),
    wards: await n('SELECT COUNT(*) AS n FROM ward'),
    panchayatSamitis: await n('SELECT COUNT(*) AS n FROM panchayat_samiti'),
    parties: await n('SELECT COUNT(*) AS n FROM party'),
    users: await n('SELECT COUNT(*) AS n FROM users'),
    settings: await n('SELECT COUNT(*) AS n FROM app_settings'),
    zpPostalAssignments: await n('SELECT COUNT(*) AS n FROM zp_ward_postal_assignment'),
    screenKeys: await n('SELECT COUNT(*) AS n FROM screen_key'),
    voters: await n('SELECT COALESCE(SUM(registered_voters_total), 0) AS n FROM booth'),
  };
}

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  backupDir = await mkdtemp(join(tmpdir(), 'churu-backups-counting-'));
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
  await rm(backupDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetData(migrator);
  await rm(backupDir, { recursive: true, force: true });
  w = await buildAdminWorld(pool);
  await assignZpPostal(pool, w.zW1, w.ps1);
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: SA_PASSWORD });
  sa = await apiClient(app, SA, SA_PASSWORD);
});

const reset = (body: Record<string, unknown> = {}) =>
  sa.post('/api/superadmin/counting-data/reset', {
    password: SA_PASSWORD,
    confirmText: 'RESET',
    ...body,
  });

/** A mock counting: psW1 fully entered and declared, a ZP booth entered, one entry voided. */
async function mockCounting() {
  const ro = await declareClient(app, 'ro_ps1_x1');
  const filled = await fillPsW1(ro, w);
  const dec = await ro.dpost(
    `/wards/${String(w.psW1)}`,
    confirmBody(await previewResult(ro, w.psW1)),
  );
  expect(dec.status).toBe(201);

  // A ZP ballot entered and then voided, so voided_entry has a row too.
  const zp = await ro.post('/entries', zW1Sheet(w, w.b1));
  expect(zp.status).toBe(201);
  const zpId = (zp.body as { entry: { id: number } }).entry.id;
  const voided = await ro.post(`/entries/${String(zpId)}/void`, {
    rowVersion: 1,
    reason: 'Entered on the wrong booth sheet',
  });
  expect(voided.status).toBe(200);

  // A candidate detail correction after the lock, so candidate_name_change has a row.
  const named = await ro.agent
    .post(`/api/candidates/wards/${String(w.psW1)}/candidates/${String(w.c.A)}/name`)
    .set('X-CSRF-Token', ro.token)
    .send({
      currentName: 'ए',
      newName: 'ए नया',
      reason: 'वर्तनी की गलती ठीक की',
      password: PASSWORD,
    });
  expect(named.status).toBe(200);
  return filled;
}

describe('counting-only reset: what goes and what stays', () => {
  it('deletes exactly the six counting tables; candidates, locks, name history and the ZP postal assignment survive', async () => {
    await mockCounting();
    const before = await setupCounts();
    expect(before.realCandidates).toBeGreaterThan(0);
    expect(before.nameChanges).toBe(1);
    expect(before.lockedWards).toBeGreaterThan(0);
    expect(before.zpPostalAssignments).toBe(1);
    const auditBefore = await n('SELECT COUNT(*) AS n FROM audit_log');

    const ov = (await sa.get('/api/superadmin/overview')).body as {
      countingData: {
        allowed: boolean;
        deletes: { boothEntries: number; postalEntries: number; declaredWards: number };
        keeps: { candidates: number; lockedWards: number; nameChanges: number };
      };
    };
    expect(ov.countingData.allowed).toBe(true);
    expect(ov.countingData.deletes).toMatchObject({
      boothEntries: 3,
      postalEntries: 1,
      declaredWards: 1,
    });
    expect(ov.countingData.keeps).toMatchObject({
      candidates: before.realCandidates,
      lockedWards: before.lockedWards,
      nameChanges: 1,
    });

    const res = await reset();
    expect(res.status).toBe(200);
    const body = res.body as {
      deleted: { boothEntries: number; declaredWards: number };
      kept: { candidates: number; nameChanges: number };
      backupFile: string;
    };
    expect(body.deleted).toMatchObject({ boothEntries: 3, declaredWards: 1, voidedEntries: 1 });
    expect(body.kept).toMatchObject({ candidates: before.realCandidates, nameChanges: 1 });
    expect(body.backupFile).toMatch(/^churu-counting-data-.+\.sql\.gz$/); // a name, never a path

    // Exactly the listed tables are empty …
    for (const t of COUNTING_DATA_TABLES) {
      expect(await n(`SELECT COUNT(*) AS n FROM ${t}`), t).toBe(0);
    }
    // … and everything else is untouched, count for count.
    expect(await setupCounts()).toEqual(before);
    // The two tables the FULL reset would also empty are still here.
    expect(await n('SELECT COUNT(*) AS n FROM candidate')).toBe(before.candidates);
    expect(await n('SELECT COUNT(*) AS n FROM candidate_name_change')).toBe(1);

    expect(await n('SELECT COUNT(*) AS n FROM audit_log')).toBeGreaterThan(auditBefore);
    expect(await auditCount('COUNTING_DATA_RESET')).toBe(1);
    expect(await auditCount('TEST_DATA_RESET')).toBe(0);
    // Append-only is still enforced for the app user.
    await expect(pool.execute('DELETE FROM audit_log')).rejects.toThrow();
    await expect(pool.execute('DELETE FROM ward_declarations')).rejects.toThrow();
  });

  it('backs up the counting data (and the kept data) before emptying anything', async () => {
    await mockCounting();
    const res = await reset();
    expect(res.status).toBe(200);
    const { backupFile } = res.body as { backupFile: string };
    const sql = gunzipSync(await readFile(join(backupDir, backupFile))).toString('utf8');
    for (const t of ['booth_entry', 'postal_entry', 'ward_declarations', 'voided_entry']) {
      expect(sql, t).toContain(`INSERT INTO \`${t}\``);
    }
    expect(sql).toContain('INSERT INTO `candidate_name_change`');
    expect(sql).toContain('INSERT IGNORE INTO `audit_log`');
    expect(sql).not.toContain('TRUNCATE TABLE `audit_log`');
  });

  it('candidate list stays usable: the ward is still locked and its candidates are still there', async () => {
    await mockCounting();
    expect((await reset()).status).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT is_locked, locked_at IS NOT NULL AS has_at, locked_by_name
         FROM ward WHERE id = ?`,
      [w.psW1],
    );
    expect(Number(rows[0]?.is_locked)).toBe(1);
    expect(Number(rows[0]?.has_at)).toBe(1);
    expect(await n('SELECT COUNT(*) AS n FROM candidate WHERE ward_id = ?', [w.psW1])).toBe(3);
    // The correction made during the mock counting is still in the history, name included.
    const [changes] = await pool.execute<RowDataPacket[]>(
      'SELECT field, old_value, new_value FROM candidate_name_change',
    );
    expect(changes).toHaveLength(1);
    expect(String(changes[0]?.new_value)).toBe('ए नया');
  });
});

describe('after the reset the system reads as "not started"', () => {
  beforeEach(async () => {
    await mockCounting();
    expect((await reset()).status).toBe(200);
  });

  it('every ward: 0 booths entered, no postal, no declaration, ballot still locked', async () => {
    const ro = await clientFor(app, 'ro_ps1_x1');
    const list = (await ro.get('/wards')).body as {
      wards: {
        id: number;
        status: string;
        boothsEntered: number;
        boothsTotal: number;
        postalEntered: boolean;
        ballotLocked: boolean;
      }[];
    };
    expect(list.wards.length).toBeGreaterThan(0);
    for (const ward of list.wards) {
      expect(ward.boothsEntered, `ward ${String(ward.id)}`).toBe(0);
      expect(ward.postalEntered).toBe(false);
      expect(ward.boothsTotal).toBeGreaterThan(0);
    }
    const psW1 = list.wards.find((x) => x.id === w.psW1);
    expect(psW1?.ballotLocked).toBe(true);
    expect(psW1?.status).toBe('NOT_STARTED');
  });

  it('the DM reports and the ward detail show zero counting', async () => {
    const dm = await apiClient(app, 'dm_x4');
    const detail = (await dm.get(`/api/reports/wards/${String(w.psW1)}`)).body as {
      ward: { boothsEntered: number; totalValidVotes: number; status: string };
      candidates: { totalVotes: number }[];
      booths: { entered: boolean }[];
      postal: { entered: boolean };
      declarations: unknown[];
    };
    expect(detail.ward.boothsEntered).toBe(0);
    expect(detail.ward.totalValidVotes).toBe(0);
    expect(detail.booths.every((b) => !b.entered)).toBe(true);
    expect(detail.postal.entered).toBe(false);
    expect(detail.declarations).toEqual([]);
    expect(detail.candidates.every((c) => c.totalVotes === 0)).toBe(true);
    // The candidate list itself is still there.
    expect(detail.candidates.length).toBe(3);
  });

  it('running it a second time on an empty system is safe and still audited', async () => {
    const before = await setupCounts();
    const res = await reset();
    expect(res.status).toBe(200);
    const body = res.body as { deleted: Record<string, number> };
    expect(Object.values(body.deleted).every((x) => x === 0)).toBe(true);
    for (const t of COUNTING_DATA_TABLES) {
      expect(await n(`SELECT COUNT(*) AS n FROM ${t}`), t).toBe(0);
    }
    expect(await setupCounts()).toEqual(before);
    expect(await auditCount('COUNTING_DATA_RESET')).toBe(2);
  });
});

describe('counting-only reset: safety', () => {
  it('needs "RESET" and the right password; a refused action makes no backup and deletes nothing', async () => {
    await mockCounting();
    const word = await reset({ confirmText: 'reset' });
    expect(word.status).toBe(400);
    const pw = await reset({ password: 'wrong-password-1' });
    expect(pw.status).toBe(401);
    expect(await backups()).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM booth_entry')).toBe(3);
    expect(await n('SELECT COUNT(*) AS n FROM ward_declarations')).toBe(1);
  });

  it('counting lock ON: refused with 423 before any backup, and the panel says why', async () => {
    await mockCounting();
    expect((await sa.post('/api/superadmin/counting-lock', { on: true })).status).toBe(200);
    const ov = (await sa.get('/api/superadmin/overview')).body as {
      countingData: { allowed: boolean; reason: string };
    };
    expect(ov.countingData.allowed).toBe(false);
    expect(ov.countingData.reason).toMatch(DEVANAGARI);
    expect((await reset()).status).toBe(423);
    expect(await backups()).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM booth_entry')).toBe(3);
  });

  it('nothing to delete: the panel disables it with a plain reason', async () => {
    const ov = (await sa.get('/api/superadmin/overview')).body as {
      countingData: { allowed: boolean; reason: string };
    };
    expect(ov.countingData.allowed).toBe(false);
    expect(ov.countingData.reason).toMatch(DEVANAGARI);
  });

  it('SUPER_ADMIN only: DM, PS_RO, ZP_RO and OBSERVER get 403, logged out 401', async () => {
    await createUser(pool, { username: 'obs_c1', role: 'OBSERVER', password: PASSWORD });
    for (const user of ['dm_x4', 'ro_ps1_x1', 'zp_ro_x3', 'obs_c1']) {
      const c = await apiClient(app, user);
      const res = await c.post('/api/superadmin/counting-data/reset', {
        password: PASSWORD,
        confirmText: 'RESET',
      });
      expect(res.status, user).toBe(403);
    }
    expect(await backups()).toEqual([]);
  });
});

describe('the existing full reset is unchanged', () => {
  it('"परीक्षण डेटा साफ़ करें" still clears candidates, the ward locks and the name history', async () => {
    await mockCounting();
    const res = await sa.post('/api/superadmin/test-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.status).toBe(200);
    expect((res.body as { backupFile: string }).backupFile).toMatch(/^churu-test-data-/);
    for (const t of TEST_DATA_TABLES) expect(await n(`SELECT COUNT(*) AS n FROM ${t}`), t).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM ward WHERE is_locked = 1')).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM ward WHERE candidates_ready_at IS NOT NULL')).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM ward WHERE is_unopposed = 1')).toBe(0);
    expect(await auditCount('TEST_DATA_RESET')).toBe(1);
    // Master data still survives it, exactly as before.
    expect(await n('SELECT COUNT(*) AS n FROM booth')).toBeGreaterThan(0);
    expect(await n('SELECT COUNT(*) AS n FROM zp_ward_postal_assignment')).toBe(1);
  });

  it('the two table lists differ only by candidates and the candidate history', () => {
    expect([...TEST_DATA_TABLES].sort()).toEqual(
      [...COUNTING_DATA_TABLES, 'candidate', 'candidate_name_change'].sort(),
    );
    expect(COUNTING_DATA_TABLES).not.toContain('candidate');
    expect(COUNTING_DATA_TABLES).not.toContain('candidate_name_change');
    expect(COUNTING_DATA_TABLES).not.toContain('audit_log');
    expect(COUNTING_DATA_TABLES).not.toContain('ward');
  });
});

describe('every emptied table is one the app user may write', () => {
  it('COUNTING_DATA_TABLES are all real app tables and never the audit log', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
    );
    const names = new Set(rows.map((r) => String(r.name)));
    for (const t of COUNTING_DATA_TABLES) expect(names.has(t), t).toBe(true);
  });
});
