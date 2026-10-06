import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // active_slot: at most one ACTIVE user per seat -> one PS_RO per PS, one ZP_RO, one DM.
  // Replacing an officer = deactivate the old user, then create the new one.
  await knex.raw(`
    CREATE TABLE users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('PS_RO', 'ZP_RO', 'DM') NOT NULL,
      panchayat_samiti_id INT UNSIGNED NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      locked_until DATETIME(3) NULL,
      last_login_at DATETIME(3) NULL,
      active_slot VARCHAR(40) AS (
        IF(is_active = 1, CONCAT(role, ':', IFNULL(panchayat_samiti_id, 0)), NULL)
      ) STORED,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_active_slot (active_slot),
      KEY idx_users_ps (panchayat_samiti_id),
      CONSTRAINT chk_users_role_ps CHECK (
        (role = 'PS_RO' AND panchayat_samiti_id IS NOT NULL)
        OR (role IN ('ZP_RO', 'DM') AND panchayat_samiti_id IS NULL)
      ),
      CONSTRAINT chk_users_is_active CHECK (is_active IN (0, 1)),
      CONSTRAINT fk_users_ps FOREIGN KEY (panchayat_samiti_id) REFERENCES panchayat_samiti (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS users');
}
