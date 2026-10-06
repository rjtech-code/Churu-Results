import knexFactory from 'knex';
import type { Knex } from 'knex';
import { SESSION_INIT_SQL } from '../config/db.js';
import type { MigrationEnv } from '../config/env.js';

export type DbTarget = 'dev' | 'test';

export function targetDatabase(env: MigrationEnv, target: DbTarget): string {
  const database = target === 'test' ? env.DB_NAME_TEST : env.DB_NAME;
  if (target === 'test' && !database.endsWith('_test')) {
    throw new Error('Refusing to use a test target whose database name does not end with _test');
  }
  return database;
}

interface SessionConnection {
  query(sql: string, cb: (err: Error | null) => void): void;
}

/** Knex instance connected as the MIGRATION user. Used only by migrations and the grants step. */
export function createMigrationKnex(env: MigrationEnv, target: DbTarget): Knex {
  return knexFactory({
    client: 'mysql2',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_MIGRATION_USER,
      password: env.DB_MIGRATION_PASSWORD,
      database: targetDatabase(env, target),
      timezone: '+05:30',
    },
    pool: {
      min: 0,
      max: 2,
      // No `charset` in the connection config: knex would copy it onto its own bookkeeping tables
      // (overriding the database default collation). The session charset is set here instead.
      afterCreate: (conn: SessionConnection, done: (err: Error | null, conn: unknown) => void) => {
        conn.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (namesErr) => {
          if (namesErr) {
            done(namesErr, conn);
            return;
          }
          conn.query(SESSION_INIT_SQL, (err) => {
            done(err, conn);
          });
        });
      },
    },
  });
}
