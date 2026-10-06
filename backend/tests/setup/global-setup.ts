import { createMigrationKnex } from '../../src/db/knex-config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { loadTestEnv } from '../helpers/env.js';

// Before the whole suite: roll back everything and migrate the TEST database from scratch.
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  const db = createMigrationKnex(env, 'test');
  try {
    await runMigrations(db, env, 'test', 'rollback-all');
    await runMigrations(db, env, 'test', 'latest');
  } finally {
    await db.destroy();
  }
}
