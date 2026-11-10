import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

// Name-only correction of a candidate after the ward's ballot is locked (official order, Nov 2026):
// every correction is kept here forever, next to its audit_log row (both in the same transaction).
//
// candidate_id has NO foreign key on purpose: while a ward is unlocked again (only possible before
// counting starts) its list is saved by deleting and re-inserting the candidate rows, so the ids
// change. The history must survive that, so each row also keeps the ward (FK), the ballot position
// and both names, and stays readable on its own.
//
// changed_by_name / changed_by_role are copied at the time of the change (the account may be renamed
// later). Append-only: triggers block UPDATE and DELETE for every user, and the app user has only
// SELECT + INSERT (src/db/grants.ts).
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE candidate_name_change (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_id INT UNSIGNED NOT NULL,
      candidate_id INT UNSIGNED NOT NULL COMMENT 'candidate.id at the time (no FK, see migration)',
      ballot_position TINYINT UNSIGNED NOT NULL,
      old_name_hindi VARCHAR(200) NOT NULL,
      new_name_hindi VARCHAR(200) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      changed_by INT UNSIGNED NOT NULL,
      changed_by_name VARCHAR(200) NOT NULL,
      changed_by_role ENUM('PS_RO', 'ZP_RO') NOT NULL,
      changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      ${CREATED_AT},
      PRIMARY KEY (id),
      KEY idx_candidate_name_change_ward (ward_id, changed_at),
      KEY idx_candidate_name_change_candidate (candidate_id),
      KEY idx_candidate_name_change_changed_by (changed_by),
      CONSTRAINT chk_candidate_name_change_names CHECK (
        CHAR_LENGTH(TRIM(old_name_hindi)) > 0
        AND CHAR_LENGTH(TRIM(new_name_hindi)) > 0
        AND old_name_hindi <> new_name_hindi
      ),
      CONSTRAINT chk_candidate_name_change_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 10 AND 500),
      CONSTRAINT chk_candidate_name_change_position CHECK (ballot_position >= 1),
      CONSTRAINT fk_candidate_name_change_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_candidate_name_change_changed_by FOREIGN KEY (changed_by)
        REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(`
    CREATE TRIGGER trg_candidate_name_change_no_update BEFORE UPDATE ON candidate_name_change
      FOR EACH ROW
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'candidate_name_change is append-only: rows can never be updated'
  `);
  await knex.raw(`
    CREATE TRIGGER trg_candidate_name_change_no_delete BEFORE DELETE ON candidate_name_change
      FOR EACH ROW
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'candidate_name_change is append-only: rows can never be deleted'
  `);
}

// Refuses (changing nothing) while any correction is recorded: the history is never thrown away.
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw('SELECT COUNT(*) AS n FROM candidate_name_change')) as unknown as [
    { n: number | string }[],
  ];
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot remove candidate_name_change: ${String(n)} name correction(s) are recorded ` +
        '(the history is kept forever; nothing was changed).',
    );
  }
  await knex.raw('DROP TABLE IF EXISTS candidate_name_change');
}
