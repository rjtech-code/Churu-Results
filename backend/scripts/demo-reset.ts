// npm run demo:reset [-- --commit] [--yes]
// DEVELOPMENT ONLY. Empties EVERY table of the *_dev database (users and audit included) and
// re-runs all migrations. Uses the migration user. Refuses in production and on any other database.
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { migrationEnvSchema, parseEnv } from '../src/config/env.js';
import type { MigrationEnv } from '../src/config/env.js';
import { createMigrationKnex } from '../src/db/knex-config.js';
import { runMigrations } from '../src/db/migrate.js';
import { isMainModule, parseCli } from './lib/cli.js';
import { assertDemoEnvironment } from './lib/demo-guard.js';

export interface DemoResetDeps {
  env: MigrationEnv;
  nodeEnv: string | undefined;
  out: (line: string) => void;
  confirm: (question: string) => Promise<string>;
}

export async function runDemoReset(
  options: { commit?: boolean | undefined; yes?: boolean | undefined },
  deps: DemoResetDeps,
): Promise<{ ok: boolean; wiped: boolean }> {
  // 1. Guard and confirmation BEFORE connecting.
  try {
    assertDemoEnvironment({ nodeEnv: deps.nodeEnv, dbName: deps.env.DB_NAME });
  } catch (err) {
    deps.out(err instanceof Error ? err.message : String(err));
    return { ok: false, wiped: false };
  }
  if (options.commit === true && options.yes !== true) {
    deps.out(
      `This DELETES ALL DATA in "${deps.env.DB_NAME}" (users and audit log included) and re-runs migrations.`,
    );
    const answer = await deps.confirm('Type RESET to confirm: ');
    if (answer.trim() !== 'RESET') {
      deps.out('Not confirmed (you did not type RESET). Nothing was changed.');
      return { ok: false, wiped: false };
    }
  }

  // 2. Connect as the migration user to the (checked) _dev database.
  const conn = await mysql.createConnection({
    host: deps.env.DB_HOST,
    port: deps.env.DB_PORT,
    user: deps.env.DB_MIGRATION_USER,
    password: deps.env.DB_MIGRATION_PASSWORD,
    database: deps.env.DB_NAME,
  });
  try {
    const [db] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    assertDemoEnvironment({ nodeEnv: deps.nodeEnv, dbName: String(db[0]?.name ?? '') });
    const [tables] = await conn.execute<RowDataPacket[]>(
      "SELECT TABLE_NAME AS t, TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT LIKE 'knex%' ORDER BY TABLE_NAME",
      [deps.env.DB_NAME],
    );
    deps.out(
      `Tables in ${deps.env.DB_NAME} (approximate rows): ${tables.map((t) => `${String(t.t)}=${Number(t.n)}`).join(', ')}`,
    );
    if (options.commit !== true) {
      deps.out('Dry run: nothing was changed. Re-run with --commit to wipe and re-migrate.');
      return { ok: true, wiped: false };
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await conn.query('TRUNCATE TABLE ??', [String(t.t)]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }

  // 3. Re-run every migration (down, then up with grants).
  const knex = createMigrationKnex(deps.env, 'dev');
  try {
    await runMigrations(knex, deps.env, 'dev', 'rollback-all');
    await runMigrations(knex, deps.env, 'dev', 'latest');
  } finally {
    await knex.destroy();
  }
  deps.out(
    `${deps.env.DB_NAME}: all data wiped and migrations re-applied. Run npm run demo:seed -- --commit next.`,
  );
  return { ok: true, wiped: true };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseCli(
    process.argv.slice(2),
    { commit: { type: 'boolean' }, yes: { type: 'boolean' } },
    'npm run demo:reset [-- --commit] [--yes]',
  );
  dotenv.config({ quiet: true, path: resolve(process.cwd(), '.env') });
  const parsed = parseEnv(migrationEnvSchema, process.env);
  if (!parsed.ok) {
    console.error(`Configuration error: ${parsed.problems.join('; ')}`);
    process.exit(1);
  }
  const { createInterface } = await import('node:readline/promises');
  const result = await runDemoReset(values, {
    env: parsed.env,
    nodeEnv: process.env.NODE_ENV,
    out: (line) => {
      console.log(line);
    },
    confirm: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  });
  process.exitCode = result.ok ? 0 : 1;
}
