import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from './helpers/db.js';
import { addDeclaration, seedBase } from './helpers/fixtures.js';
import type { BaseFixture } from './helpers/fixtures.js';

let app: Pool;
let migrator: Pool;
let f: BaseFixture;
let auditId: number;

beforeAll(() => {
  app = createTestAppPool();
  migrator = createTestMigrationPool();
});

afterAll(async () => {
  await app.end();
  await migrator.end();
});

beforeEach(async () => {
  await resetData(migrator);
  f = await seedBase(app);
  auditId = await insert(
    app,
    'INSERT INTO audit_log (user_id, action, entity, entity_id, new_value, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [f.psRo1, 'TEST', 'booth_entry', 1, JSON.stringify({ votes: 10 }), '127.0.0.1'],
  );
});

const DENIED = { code: 'ER_TABLEACCESS_DENIED_ERROR' };

describe('case 10: APP user on audit_log', () => {
  it('INSERT works', async () => {
    await expect(
      insert(
        app,
        "INSERT INTO audit_log (user_id, action, entity) VALUES (NULL, 'SCRIPT', 'import')",
        [],
      ),
    ).resolves.toBeGreaterThan(auditId);
  });

  it('UPDATE fails', async () => {
    await expect(
      app.execute("UPDATE audit_log SET action = 'CHANGED' WHERE id = ?", [auditId]),
    ).rejects.toMatchObject(DENIED);
  });

  it('DELETE fails', async () => {
    await expect(
      app.execute('DELETE FROM audit_log WHERE id = ?', [auditId]),
    ).rejects.toMatchObject(DENIED);
  });

  it('DROP TABLE fails (audit_log and any other table)', async () => {
    await expect(app.query('DROP TABLE audit_log')).rejects.toMatchObject(DENIED);
    await expect(app.query('DROP TABLE booth_entry_vote')).rejects.toMatchObject(DENIED);
  });

  it('TRUNCATE, ALTER, CREATE and CREATE TRIGGER fail', async () => {
    await expect(app.query('TRUNCATE TABLE audit_log')).rejects.toMatchObject(DENIED);
    await expect(app.query('ALTER TABLE audit_log ADD COLUMN x INT')).rejects.toMatchObject(DENIED);
    await expect(app.query('CREATE TABLE evil (id INT)')).rejects.toMatchObject({
      code: expect.stringMatching(/DENIED/) as unknown,
    });
    await expect(app.query('DROP TRIGGER trg_audit_log_no_update')).rejects.toMatchObject({
      code: expect.stringMatching(/DENIED/) as unknown,
    });
  });

  it('the row is unchanged afterwards', async () => {
    const [rows] = await app.execute('SELECT action FROM audit_log WHERE id = ?', [auditId]);
    expect(rows).toEqual([{ action: 'TEST' }]);
  });
});

describe('APP user on other tables', () => {
  it('cannot UPDATE or DELETE ward_declarations (append-only)', async () => {
    const id = await addDeclaration(app, {
      wardId: f.psWard1,
      version: 1,
      winner: f.candA,
      userId: f.psRo1,
    });
    await expect(
      app.execute('UPDATE ward_declarations SET margin = 1 WHERE id = ?', [id]),
    ).rejects.toMatchObject(DENIED);
    await expect(
      app.execute('DELETE FROM ward_declarations WHERE id = ?', [id]),
    ).rejects.toMatchObject(DENIED);
  });

  it('cannot read knex migration bookkeeping', async () => {
    await expect(app.query('SELECT * FROM knex_migrations')).rejects.toMatchObject(DENIED);
  });
});

describe('case 11: MIGRATION user is blocked by the triggers too', () => {
  it('UPDATE on audit_log fails with the trigger message', async () => {
    await expect(
      migrator.execute("UPDATE audit_log SET action = 'CHANGED' WHERE id = ?", [auditId]),
    ).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
      sqlMessage: expect.stringContaining('audit_log is append-only') as unknown,
    });
  });

  it('DELETE on audit_log fails with the trigger message', async () => {
    await expect(
      migrator.execute('DELETE FROM audit_log WHERE id = ?', [auditId]),
    ).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
      sqlMessage: expect.stringContaining('audit_log is append-only') as unknown,
    });
  });

  it('UPDATE/DELETE on ward_declarations fail too', async () => {
    const id = await addDeclaration(app, {
      wardId: f.psWard1,
      version: 1,
      winner: f.candA,
      userId: f.psRo1,
    });
    await expect(
      migrator.execute('UPDATE ward_declarations SET margin = 1 WHERE id = ?', [id]),
    ).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
    await expect(
      migrator.execute('DELETE FROM ward_declarations WHERE id = ?', [id]),
    ).rejects.toMatchObject({
      code: 'ER_SIGNAL_EXCEPTION',
    });
  });
});
