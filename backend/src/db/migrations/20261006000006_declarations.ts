import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // Versioned, append-only declarations. A correction is a new version with a reason.
  // winner_is_nota is always 0: the composite FK to candidate (id, ward_id, is_nota) proves the
  // winner is a non-NOTA candidate of this same ward.
  await knex.raw(`
    CREATE TABLE ward_declarations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_id INT UNSIGNED NOT NULL,
      version INT UNSIGNED NOT NULL,
      status ENUM('DECLARED', 'TIE_RESOLVED') NOT NULL,
      winner_candidate_id INT UNSIGNED NOT NULL,
      winner_is_nota TINYINT(1) AS (0) STORED NOT NULL,
      margin INT UNSIGNED NOT NULL,
      snapshot JSON NOT NULL,
      declared_by INT UNSIGNED NOT NULL,
      declared_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      correction_reason VARCHAR(1000) NULL,
      ${CREATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_ward_declarations_ward_version (ward_id, version),
      KEY idx_ward_declarations_winner (winner_candidate_id, ward_id, winner_is_nota),
      KEY idx_ward_declarations_declared_by (declared_by),
      CONSTRAINT chk_ward_declarations_version CHECK (version >= 1),
      CONSTRAINT chk_ward_declarations_reason CHECK (
        (version = 1 AND correction_reason IS NULL)
        OR (version > 1 AND correction_reason IS NOT NULL AND CHAR_LENGTH(TRIM(correction_reason)) > 0)
      ),
      CONSTRAINT chk_ward_declarations_margin CHECK (
        (status = 'DECLARED' AND margin > 0)
        OR (status = 'TIE_RESOLVED' AND margin = 0)
      ),
      CONSTRAINT fk_ward_declarations_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_ward_declarations_winner FOREIGN KEY (winner_candidate_id, ward_id, winner_is_nota)
        REFERENCES candidate (id, ward_id, is_nota) ${FK_RULES},
      CONSTRAINT fk_ward_declarations_declared_by FOREIGN KEY (declared_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);

  await knex.raw(`
    CREATE TRIGGER trg_ward_declarations_no_update BEFORE UPDATE ON ward_declarations FOR EACH ROW
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'ward_declarations is append-only: add a new correction version instead'
  `);
  await knex.raw(`
    CREATE TRIGGER trg_ward_declarations_no_delete BEFORE DELETE ON ward_declarations FOR EACH ROW
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'ward_declarations is append-only: rows can never be deleted'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ward_declarations');
}
