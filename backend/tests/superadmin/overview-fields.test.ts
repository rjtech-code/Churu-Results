// The two read-only figures the redesigned Super Admin header strip shows beside the counts:
// how many RO logins exist, and when the newest backup was written. Nothing acts on them.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../auth/helpers.js';
import { apiClient, buildAdminWorld } from '../admin/helpers.js';
import type { AdminWorld, ApiClient } from '../admin/helpers.js';
import { countingApp } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData, testEnv } from '../helpers/db.js';

const SA = 'super_admin_ov';
const SA_PASSWORD = 'Super-Admin-Pass-2';

interface OverviewFields {
  counts: { roAccounts: number; panchayatSamitis: number };
  lastBackupAt: string | null;
}

let pool: Pool;
let migrator: Pool;
let backupDir: string;
let app: Express;
let w: AdminWorld;
let sa: ApiClient;

const fields = async (): Promise<OverviewFields> => {
  const res = await sa.get('/api/superadmin/overview');
  expect(res.status).toBe(200);
  return res.body as OverviewFields;
};
const activeRos = async (): Promise<number> => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM users WHERE role IN ('PS_RO', 'ZP_RO') AND is_active = 1`,
  );
  return Number(rows[0]?.n ?? 0);
};

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  backupDir = await mkdtemp(join(tmpdir(), 'churu-backups-ov-'));
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
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: SA_PASSWORD });
  sa = await apiClient(app, SA, SA_PASSWORD);
});

describe('overview: RO logins and the newest backup', () => {
  it('counts the active PS_RO / ZP_RO logins only', async () => {
    const before = await activeRos();
    expect(before).toBeGreaterThan(0);
    expect((await fields()).counts.roAccounts).toBe(before);

    // A disabled RO stops counting (the database allows only one active RO per seat).
    await pool.execute(
      `UPDATE users SET is_active = 0 WHERE role = 'PS_RO' AND is_active = 1 ORDER BY id LIMIT 1`,
    );
    expect((await fields()).counts.roAccounts).toBe(before - 1);

    // Other roles never count.
    await createUser(pool, { username: 'observer_ov', role: 'OBSERVER', password: SA_PASSWORD });
    expect((await fields()).counts.roAccounts).toBe(before - 1);
  });

  it('is null before any backup, and the newest backup time after one was made', async () => {
    expect((await fields()).lastBackupAt).toBeNull();

    // The booth change makes a real backup (same code path as every other panel action).
    const added = await sa.post('/api/superadmin/booths/add', {
      psId: w.ps1,
      boothNo: '51',
      nameHindi: 'नया बूथ इक्यावन',
      nameEnglish: null,
      psWardNo: 5,
      zpWardNo: 2,
      votersMale: 300,
      votersFemale: 280,
      votersOther: 0,
    });
    expect(added.status).toBe(201);

    const at = (await fields()).lastBackupAt;
    if (at === null) throw new Error('lastBackupAt is still null after a backup was made');
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    expect(Date.now() - Date.parse(at)).toBeLessThan(5 * 60_000);
  });
});
