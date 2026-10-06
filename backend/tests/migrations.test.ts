import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_TABLE_PRIVILEGES } from '../src/db/grants.js';
import { createMigrationKnex } from '../src/db/knex-config.js';
import { runMigrations } from '../src/db/migrate.js';
import { migrationSource } from '../src/db/migrations/index.js';
import { createTestMigrationPool, testEnv, wipeAllData } from './helpers/db.js';

const EXPECTED_TABLES = Object.keys(APP_TABLE_PRIVILEGES).sort();
const EXPECTED_TRIGGERS = [
  'trg_audit_log_no_delete',
  'trg_audit_log_no_update',
  'trg_booth_entry_ward_bi',
  'trg_booth_entry_ward_bu',
  'trg_voided_entry_no_delete',
  'trg_voided_entry_no_update',
  'trg_ward_declarations_no_delete',
  'trg_ward_declarations_no_update',
];

let db: Knex;

async function rows<T>(sql: string, bindings: string[] = []): Promise<T[]> {
  const result: unknown = await db.raw(sql, bindings);
  return (result as [T[]])[0];
}

async function appTables(): Promise<string[]> {
  const list = await rows<{ name: string }>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME NOT LIKE 'knex%' ORDER BY TABLE_NAME",
    [testEnv.TEST_DB],
  );
  return list.map((r) => r.name);
}

async function triggers(): Promise<string[]> {
  const list = await rows<{ name: string }>(
    'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME',
    [testEnv.TEST_DB],
  );
  return list.map((r) => r.name);
}

beforeAll(() => {
  db = createMigrationKnex(testEnv, 'test');
});

afterAll(async () => {
  // Always leave the test database fully migrated for the other test files.
  await runMigrations(db, testEnv, 'test', 'latest');
  await db.destroy();
});

describe('migrations', () => {
  it('case 1: run fully down and up again without errors', async () => {
    // "On an empty database": earlier test files may have left data behind.
    const migrator = createTestMigrationPool();
    try {
      await wipeAllData(migrator);
    } finally {
      await migrator.end();
    }
    await runMigrations(db, testEnv, 'test', 'rollback-all');
    expect(await appTables()).toEqual([]);
    expect(await triggers()).toEqual([]);

    const allMigrations = await migrationSource.getMigrations([]);
    const applied = await runMigrations(db, testEnv, 'test', 'latest');
    expect(applied).toEqual(allMigrations);
    expect(await appTables()).toEqual(EXPECTED_TABLES);
    expect(await triggers()).toEqual(EXPECTED_TRIGGERS);

    const reverted = await runMigrations(db, testEnv, 'test', 'rollback-all');
    expect([...reverted].sort()).toEqual([...allMigrations].sort());
    expect(await appTables()).toEqual([]);

    await runMigrations(db, testEnv, 'test', 'latest');
    expect(await appTables()).toEqual(EXPECTED_TABLES);
  });

  it('creates no views (result math lives only in result.ts)', async () => {
    const views = await rows<{ name: string }>(
      'SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?',
      [testEnv.TEST_DB],
    );
    expect(views).toEqual([]);
  });

  it('every table is InnoDB with utf8mb4_unicode_ci', async () => {
    const list = await rows<{ name: string; engine: string; collation: string }>(
      'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [testEnv.TEST_DB],
    );
    const bad = list.filter((t) => t.engine !== 'InnoDB' || t.collation !== 'utf8mb4_unicode_ci');
    expect(bad).toEqual([]);
  });

  it('every foreign key is ON DELETE RESTRICT ON UPDATE RESTRICT', async () => {
    const list = await rows<{ name: string; del: string; upd: string }>(
      'SELECT CONSTRAINT_NAME AS name, DELETE_RULE AS del, UPDATE_RULE AS upd FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?',
      [testEnv.TEST_DB],
    );
    expect(list.length).toBeGreaterThan(20);
    expect(list.filter((fk) => fk.del !== 'RESTRICT' || fk.upd !== 'RESTRICT')).toEqual([]);
  });

  it('every table has created_at', async () => {
    const list = await rows<{ name: string }>(
      `SELECT t.TABLE_NAME AS name FROM information_schema.TABLES t
       WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME NOT LIKE 'knex%'
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.COLUMNS c
           WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND c.COLUMN_NAME IN ('created_at', 'entered_at'))`,
      [testEnv.TEST_DB],
    );
    expect(list).toEqual([]);
  });

  it('seeds public_site_enabled = false', async () => {
    const list = await rows<{ v: string }>(
      "SELECT setting_value AS v FROM app_settings WHERE setting_key = 'public_site_enabled'",
    );
    expect(list).toEqual([{ v: 'false' }]);
  });
});
