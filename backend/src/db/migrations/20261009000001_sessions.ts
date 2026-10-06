import type { Knex } from 'knex';
import { CREATED_AT, TABLE_OPTIONS } from './table-options.js';

// Login sessions (express-mysql-session; the store never creates tables itself).
// App-user privileges for this table are in src/db/grants.ts (applied by npm run migrate).
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE sessions (
      session_id VARCHAR(128) NOT NULL,
      expires INT UNSIGNED NOT NULL COMMENT 'unix seconds; expired rows are ignored and deleted',
      data MEDIUMTEXT NULL,
      ${CREATED_AT},
      PRIMARY KEY (session_id),
      KEY idx_sessions_expires (expires)
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS sessions');
}
