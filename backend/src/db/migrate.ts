import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Knex } from 'knex';
import { loadEnvOrExit, migrationEnvSchema } from '../config/env.js';
import type { MigrationEnv } from '../config/env.js';
import { applyAppGrants } from './grants.js';
import { createMigrationKnex, targetDatabase } from './knex-config.js';
import type { DbTarget } from './knex-config.js';
import { migrationSource } from './migrations/index.js';

export type MigrateCommand = 'latest' | 'rollback' | 'rollback-all';

/**
 * Runs a migration command. After `latest`, the app user's table grants are always re-applied,
 * so grants can never fall behind the schema.
 */
export async function runMigrations(
  db: Knex,
  env: MigrationEnv,
  target: DbTarget,
  command: MigrateCommand,
): Promise<string[]> {
  const config: Knex.MigratorConfig = { migrationSource };
  if (command === 'latest') {
    const [, applied] = (await db.migrate.latest(config)) as [number, string[]];
    await applyAppGrants(db, targetDatabase(env, target), env.DB_APP_USER);
    return applied;
  }
  const [, reverted] = (await db.migrate.rollback(config, command === 'rollback-all')) as [
    number,
    string[],
  ];
  return reverted;
}

function isCommand(value: string | undefined): value is MigrateCommand {
  return value === 'latest' || value === 'rollback' || value === 'rollback-all';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('--'));
  if (!isCommand(command)) {
    console.error('Usage: tsx src/db/migrate.ts <latest|rollback|rollback-all> [--test]');
    process.exit(2);
  }
  const target: DbTarget = args.includes('--test') ? 'test' : 'dev';
  const env = loadEnvOrExit(migrationEnvSchema);
  const db = createMigrationKnex(env, target);
  try {
    const names = await runMigrations(db, env, target, command);
    const verb = command === 'latest' ? 'Applied' : 'Rolled back';
    console.log(`[${targetDatabase(env, target)}] ${verb} ${names.length} migration(s)`);
    for (const name of names) console.log(`  - ${name}`);
    if (command === 'latest') console.log('App user grants applied.');
  } finally {
    await db.destroy();
  }
}

// Only run the CLI when executed directly (tests import runMigrations).
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
