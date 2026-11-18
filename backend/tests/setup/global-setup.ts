import { createMigrationKnex } from '../../src/db/knex-config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createTestMigrationPool, releaseStaleMigrationLock, wipeAllData } from '../helpers/db.js';
import { loadTestEnv } from '../helpers/env.js';

// Before the whole suite: empty the TEST database, roll everything back and migrate from scratch.
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  const pool = createTestMigrationPool();
  try {
    // A killed run can leave knex's migration lock set; waiting it out first means a genuine
    // concurrent migration is never disturbed.
    await releaseStaleMigrationLock(pool);
    await wipeAllData(pool); // down migrations expect an empty schema
  } finally {
    await pool.end();
  }
  const db = createMigrationKnex(env, 'test');
  try {
    await runMigrations(db, env, 'test', 'rollback-all');
    await runMigrations(db, env, 'test', 'latest');
  } finally {
    await db.destroy();
  }
}
