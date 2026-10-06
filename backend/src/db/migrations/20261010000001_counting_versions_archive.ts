import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // Optimistic concurrency: every UPDATE does WHERE row_version = ? and increments it.
  for (const table of ['booth_entry', 'postal_entry']) {
    await knex.raw(`
      ALTER TABLE ${table}
        ADD COLUMN row_version INT UNSIGNED NOT NULL DEFAULT 1,
        ADD CONSTRAINT chk_${table}_row_version CHECK (row_version >= 1)
    `);
  }

  // Voided booth/postal entries, kept forever. The live rows are deleted in the same transaction.
  // Append-only: the app user may only INSERT/SELECT (grants.ts) and triggers block UPDATE/DELETE.
  await knex.raw(`
    CREATE TABLE voided_entry (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entry_kind ENUM('BOOTH', 'POSTAL') NOT NULL,
      original_entry_id INT UNSIGNED NOT NULL,
      ward_id INT UNSIGNED NOT NULL,
      booth_id INT UNSIGNED NULL,
      ballot_for ENUM('PS', 'ZP') NULL,
      round_no TINYINT UNSIGNED NULL,
      sheet_total INT UNSIGNED NOT NULL,
      rejected_count INT UNSIGNED NULL,
      row_version INT UNSIGNED NOT NULL,
      entered_by INT UNSIGNED NOT NULL,
      entered_at DATETIME(3) NOT NULL,
      updated_by INT UNSIGNED NULL,
      updated_at DATETIME(3) NULL,
      votes JSON NOT NULL,
      voided_by INT UNSIGNED NOT NULL,
      voided_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      void_reason VARCHAR(500) NOT NULL,
      ${CREATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_voided_entry_original (entry_kind, original_entry_id),
      KEY idx_voided_entry_ward (ward_id),
      KEY idx_voided_entry_booth (booth_id),
      KEY idx_voided_entry_entered_by (entered_by),
      KEY idx_voided_entry_updated_by (updated_by),
      KEY idx_voided_entry_voided_by (voided_by),
      CONSTRAINT chk_voided_entry_kind CHECK (
        (entry_kind = 'BOOTH' AND booth_id IS NOT NULL AND ballot_for IS NOT NULL AND round_no IS NOT NULL
          AND rejected_count IS NULL)
        OR (entry_kind = 'POSTAL' AND booth_id IS NULL AND ballot_for IS NULL AND round_no IS NULL)
      ),
      CONSTRAINT chk_voided_entry_reason CHECK (CHAR_LENGTH(TRIM(void_reason)) BETWEEN 10 AND 500),
      CONSTRAINT fk_voided_entry_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_voided_entry_booth FOREIGN KEY (booth_id) REFERENCES booth (id) ${FK_RULES},
      CONSTRAINT fk_voided_entry_entered_by FOREIGN KEY (entered_by) REFERENCES users (id) ${FK_RULES},
      CONSTRAINT fk_voided_entry_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ${FK_RULES},
      CONSTRAINT fk_voided_entry_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(`
    CREATE TRIGGER trg_voided_entry_no_update BEFORE UPDATE ON voided_entry FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'voided_entry is append-only: rows can never be updated'
  `);
  await knex.raw(`
    CREATE TRIGGER trg_voided_entry_no_delete BEFORE DELETE ON voided_entry FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'voided_entry is append-only: rows can never be deleted'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS voided_entry');
  for (const table of ['postal_entry', 'booth_entry']) {
    await knex.raw(
      `ALTER TABLE ${table} DROP CHECK chk_${table}_row_version, DROP COLUMN row_version`,
    );
  }
}
