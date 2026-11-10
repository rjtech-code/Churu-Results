import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_TABLE_PRIVILEGES } from '../src/db/grants.js';
import { createMigrationKnex } from '../src/db/knex-config.js';
import { runMigrations } from '../src/db/migrate.js';
import * as boothSuffix from '../src/db/migrations/20261022000001_booth_suffix.js';
import * as removeRoundNo from '../src/db/migrations/20261023000001_remove_round_no.js';
import { migrationSource } from '../src/db/migrations/index.js';
import { createTestMigrationPool, testEnv, wipeAllData } from './helpers/db.js';

const EXPECTED_TABLES = Object.keys(APP_TABLE_PRIVILEGES).sort();
const EXPECTED_TRIGGERS = [
  'trg_audit_log_no_delete',
  'trg_audit_log_no_update',
  'trg_booth_entry_ward_bi',
  'trg_booth_entry_ward_bu',
  'trg_candidate_name_change_no_delete',
  'trg_candidate_name_change_no_update',
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
  it('booth_suffix rollback refuses while an "A" booth exists, and keeps plain booths', async () => {
    const migrator = createTestMigrationPool();
    try {
      await wipeAllData(migrator);
    } finally {
      await migrator.end();
    }
    await db.raw(
      "INSERT INTO district (id, code, name_english, name_hindi) VALUES (1, 'CHURU', 'Churu', 'चूरू')",
    );
    await db.raw(
      "INSERT INTO panchayat_samiti (id, district_id, name_english, name_hindi) VALUES (1, 1, 'A PS', 'ए')",
    );
    await db.raw(
      "INSERT INTO ward (id, ward_type, district_id, panchayat_samiti_id, ward_no) VALUES (1, 'PS', 1, 1, 1), (2, 'ZP', 1, NULL, 1)",
    );
    await db.raw(
      `INSERT INTO booth (panchayat_samiti_id, booth_no, booth_suffix, name_hindi, ps_ward_id, zp_ward_id)
       VALUES (1, 12, '', 'बूथ', 1, 2), (1, 12, 'A', 'बूथ', 1, 2)`,
    );
    const labels = async () =>
      (
        await rows<{ label: string }>(
          'SELECT CONCAT(booth_no, booth_suffix) AS label FROM booth ORDER BY booth_no, booth_suffix',
        )
      ).map((r) => r.label);

    await expect(boothSuffix.down(db)).rejects.toThrow(/Cannot roll back booth_suffix/);
    expect(await labels()).toEqual(['12', '12A']);

    await db.raw("DELETE FROM booth WHERE booth_suffix = 'A'");
    await boothSuffix.down(db);
    expect(await rows('SELECT booth_no FROM booth')).toEqual([{ booth_no: 12 }]);
    await boothSuffix.up(db);
    expect(await labels()).toEqual(['12']);
    // case 1 (next) wipes the data and re-runs every migration.
  });

  describe('remove_round_no', () => {
    const entryCount = async () =>
      Number((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM booth_entry'))[0]?.n);
    const hasRoundColumn = async (table: string) =>
      (
        await rows(
          "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'round_no'",
          [testEnv.TEST_DB, table],
        )
      ).length === 1;
    const addEntry = () =>
      db.raw(
        "INSERT INTO booth_entry (booth_id, ballot_for, ward_id, sheet_total, entered_by) VALUES (1, 'PS', 1, 0, 1)",
      );

    beforeEach(async () => {
      const migrator = createTestMigrationPool();
      try {
        await wipeAllData(migrator);
      } finally {
        await migrator.end();
      }
      await db.raw(
        "INSERT INTO district (id, code, name_english, name_hindi) VALUES (1, 'CHURU', 'Churu', 'चूरू')",
      );
      await db.raw(
        "INSERT INTO panchayat_samiti (id, district_id, name_english, name_hindi) VALUES (1, 1, 'A PS', 'ए')",
      );
      await db.raw(
        "INSERT INTO ward (id, ward_type, district_id, panchayat_samiti_id, ward_no) VALUES (1, 'PS', 1, 1, 1), (2, 'ZP', 1, NULL, 1)",
      );
      await db.raw(
        "INSERT INTO booth (id, panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (1, 1, 1, 'बूथ', 1, 2)",
      );
      await db.raw(
        "INSERT INTO users (id, username, password_hash, role) VALUES (1, 'zp_ro', 'x', 'ZP_RO')",
      );
    });

    it('up refuses, changing nothing, while a booth ballot has more than one live entry', async () => {
      // Only possible on a damaged database: uq_booth_entry_booth_ballot is lifted for this test.
      await db.raw('ALTER TABLE booth_entry ADD KEY idx_tmp_booth (booth_id)');
      await db.raw('ALTER TABLE booth_entry DROP INDEX uq_booth_entry_booth_ballot');
      try {
        await addEntry();
        await addEntry();
        await expect(removeRoundNo.up(db)).rejects.toThrow(
          /Cannot remove round_no: 1 booth ballot\(s\) have more than one live entry/,
        );
        expect(await entryCount()).toBe(2);
      } finally {
        await db.raw('DELETE FROM booth_entry');
        await db.raw(
          'ALTER TABLE booth_entry ADD UNIQUE KEY uq_booth_entry_booth_ballot (booth_id, ballot_for)',
        );
        await db.raw('ALTER TABLE booth_entry DROP INDEX idx_tmp_booth');
      }
    });

    it('down refuses while a booth entry exists; on an empty table it restores round_no, and up removes it again', async () => {
      expect(await hasRoundColumn('booth_entry')).toBe(false);
      expect(await hasRoundColumn('voided_entry')).toBe(false);
      await addEntry();
      await expect(removeRoundNo.down(db)).rejects.toThrow(/Cannot roll back remove_round_no/);
      expect(await entryCount()).toBe(1);
      expect(await hasRoundColumn('booth_entry')).toBe(false);

      await db.raw('DELETE FROM booth_entry');
      await removeRoundNo.down(db);
      expect(await hasRoundColumn('booth_entry')).toBe(true);
      expect(await hasRoundColumn('voided_entry')).toBe(true);
      await removeRoundNo.up(db);
      expect(await hasRoundColumn('booth_entry')).toBe(false);
      expect(await hasRoundColumn('voided_entry')).toBe(false);
      // One live entry per booth ballot is still the database rule.
      await addEntry();
      await expect(addEntry()).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
  });

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
