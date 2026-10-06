import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // user_id is NULL for actions done by CLI scripts.
  await knex.raw(`
    CREATE TABLE audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NULL,
      action VARCHAR(64) NOT NULL,
      entity VARCHAR(64) NOT NULL,
      entity_id BIGINT UNSIGNED NULL,
      old_value JSON NULL,
      new_value JSON NULL,
      reason VARCHAR(1000) NULL,
      ip VARCHAR(45) NULL,
      ${CREATED_AT},
      PRIMARY KEY (id),
      KEY idx_audit_log_entity (entity, entity_id),
      KEY idx_audit_log_user (user_id),
      KEY idx_audit_log_created_at (created_at),
      CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);

  // Triggers block every user, including the migration user. (The app user additionally has
  // only SELECT + INSERT on this table; see src/db/grants.ts.)
  await knex.raw(`
    CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: rows can never be updated'
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: rows can never be deleted'
  `);

  await knex.raw(`
    CREATE TABLE app_settings (
      setting_key VARCHAR(64) NOT NULL,
      setting_value VARCHAR(255) NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (setting_key)
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('public_site_enabled', 'false')",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS app_settings');
  await knex.raw('DROP TABLE IF EXISTS audit_log');
}
