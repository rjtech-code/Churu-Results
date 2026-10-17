import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // The DM's email (set only by the CLI script dm-set-email). NULL for every other account and for
  // accounts made before this column: they keep working. Format is checked by the script.
  await knex.raw(
    'ALTER TABLE users ADD COLUMN email VARCHAR(190) NULL AFTER phone, ADD UNIQUE KEY uq_users_email (email)',
  );
  // One-time codes for the DM profile page. Only an HMAC of the code is stored, never the code.
  // A code is dead once used_at is set (used, replaced by a newer code, or too many wrong tries).
  await knex.raw(`
    CREATE TABLE user_otp (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      purpose ENUM('USERNAME', 'PASSWORD') NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      used_at DATETIME(3) NULL,
      ${CREATED_AT},
      PRIMARY KEY (id),
      KEY idx_user_otp_user (user_id, purpose, id),
      CONSTRAINT fk_user_otp_user FOREIGN KEY (user_id) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS user_otp');
  await knex.raw('ALTER TABLE users DROP INDEX uq_users_email, DROP COLUMN email');
}
