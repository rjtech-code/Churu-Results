import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

/**
 * Nov 2026 (DEO request, counting day): the Super Admin may UNDECLARE a declared ZP ward, so a ward
 * declared by mistake can go back to "गिनती चल रही है" and be declared again.
 *
 * The declaration is NEVER lost. Every version of it is copied into `undeclared_ward` — append-only,
 * kept for ever, with who undeclared it, when and why — inside the SAME transaction that removes it
 * from `ward_declarations`. That is why the no-DELETE trigger on `ward_declarations` is dropped here
 * while the no-UPDATE trigger stays: a declaration can be removed (and archived), never edited.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE undeclared_ward (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_id INT UNSIGNED NOT NULL,
      version INT UNSIGNED NOT NULL,
      status ENUM('DECLARED', 'TIE_RESOLVED') NOT NULL,
      winner_candidate_id INT UNSIGNED NOT NULL,
      winner_name VARCHAR(200) NULL,
      margin INT UNSIGNED NOT NULL,
      snapshot JSON NOT NULL,
      lottery_details JSON NULL,
      nota_highest_ack TINYINT(1) NOT NULL DEFAULT 0,
      declared_by INT UNSIGNED NOT NULL,
      declared_at DATETIME(3) NOT NULL,
      correction_reason VARCHAR(500) NULL,
      undeclared_by INT UNSIGNED NOT NULL,
      undeclared_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      undeclare_reason VARCHAR(500) NOT NULL,
      ${CREATED_AT},
      PRIMARY KEY (id),
      KEY idx_undeclared_ward_ward (ward_id, version),
      KEY idx_undeclared_ward_by (undeclared_by),
      CONSTRAINT chk_undeclared_ward_version CHECK (version >= 1),
      CONSTRAINT chk_undeclared_ward_reason CHECK (
        CHAR_LENGTH(TRIM(undeclare_reason)) BETWEEN 10 AND 500
      ),
      CONSTRAINT fk_undeclared_ward_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_undeclared_ward_by FOREIGN KEY (undeclared_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(`
    CREATE TRIGGER trg_undeclared_ward_no_update BEFORE UPDATE ON undeclared_ward FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'undeclared_ward is append-only: rows can never be updated'
  `);
  await knex.raw(`
    CREATE TRIGGER trg_undeclared_ward_no_delete BEFORE DELETE ON undeclared_ward FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'undeclared_ward is append-only: rows can never be deleted'
  `);
  // A declaration may now be removed — only ever after it has been archived above.
  await knex.raw('DROP TRIGGER IF EXISTS trg_ward_declarations_no_delete');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TRIGGER trg_ward_declarations_no_delete BEFORE DELETE ON ward_declarations FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ward_declarations is append-only: rows can never be deleted'
  `);
  await knex.raw('DROP TABLE IF EXISTS undeclared_ward');
}
