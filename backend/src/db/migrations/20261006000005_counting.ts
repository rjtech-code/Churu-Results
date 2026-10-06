import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

// Checks that booth_entry.ward_id is the booth's own ward for the ballot (PS or ZP).
// A plain FK cannot express "ps_ward_id if PS, else zp_ward_id", hence a trigger.
function wardMatchTrigger(name: string, timing: 'INSERT' | 'UPDATE'): string {
  return `
    CREATE TRIGGER ${name} BEFORE ${timing} ON booth_entry FOR EACH ROW
    BEGIN
      DECLARE expected_ward_id INT UNSIGNED DEFAULT NULL;
      SELECT IF(NEW.ballot_for = 'PS', b.ps_ward_id, b.zp_ward_id)
        INTO expected_ward_id
        FROM booth AS b
        WHERE b.id = NEW.booth_id;
      IF expected_ward_id IS NULL OR expected_ward_id <> NEW.ward_id THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'booth_entry.ward_id does not match the booth ward for this ballot';
      END IF;
    END
  `;
}

export async function up(knex: Knex): Promise<void> {
  // One entry per (booth, ballot_for), ever. ward_id is stored so vote rows can be tied to
  // candidates of exactly this ward via composite FKs.
  await knex.raw(`
    CREATE TABLE booth_entry (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      booth_id INT UNSIGNED NOT NULL,
      ballot_for ENUM('PS', 'ZP') NOT NULL,
      ward_id INT UNSIGNED NOT NULL,
      round_no TINYINT UNSIGNED NOT NULL,
      sheet_total INT UNSIGNED NOT NULL,
      entered_by INT UNSIGNED NOT NULL,
      entered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_by INT UNSIGNED NULL,
      updated_at DATETIME(3) NULL ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_booth_entry_booth_ballot (booth_id, ballot_for),
      UNIQUE KEY uq_booth_entry_id_ward (id, ward_id),
      KEY idx_booth_entry_ward (ward_id, ballot_for),
      KEY idx_booth_entry_entered_by (entered_by),
      KEY idx_booth_entry_updated_by (updated_by),
      CONSTRAINT chk_booth_entry_round CHECK (round_no >= 1),
      CONSTRAINT fk_booth_entry_booth FOREIGN KEY (booth_id) REFERENCES booth (id) ${FK_RULES},
      CONSTRAINT fk_booth_entry_ward_type FOREIGN KEY (ward_id, ballot_for)
        REFERENCES ward (id, ward_type) ${FK_RULES},
      CONSTRAINT fk_booth_entry_entered_by FOREIGN KEY (entered_by) REFERENCES users (id) ${FK_RULES},
      CONSTRAINT fk_booth_entry_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(wardMatchTrigger('trg_booth_entry_ward_bi', 'INSERT'));
  await knex.raw(wardMatchTrigger('trg_booth_entry_ward_bu', 'UPDATE'));

  await knex.raw(`
    CREATE TABLE booth_entry_vote (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entry_id INT UNSIGNED NOT NULL,
      ward_id INT UNSIGNED NOT NULL,
      candidate_id INT UNSIGNED NOT NULL,
      votes INT UNSIGNED NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_booth_entry_vote (entry_id, candidate_id),
      KEY idx_booth_entry_vote_entry_ward (entry_id, ward_id),
      KEY idx_booth_entry_vote_candidate_ward (candidate_id, ward_id),
      CONSTRAINT chk_booth_entry_vote_votes CHECK (votes >= 0),
      CONSTRAINT fk_booth_entry_vote_entry FOREIGN KEY (entry_id, ward_id)
        REFERENCES booth_entry (id, ward_id) ${FK_RULES},
      CONSTRAINT fk_booth_entry_vote_candidate FOREIGN KEY (candidate_id, ward_id)
        REFERENCES candidate (id, ward_id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);

  // Postal ballots: one entry per ward.
  await knex.raw(`
    CREATE TABLE postal_entry (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_id INT UNSIGNED NOT NULL,
      sheet_total INT UNSIGNED NOT NULL,
      entered_by INT UNSIGNED NOT NULL,
      entered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_by INT UNSIGNED NULL,
      updated_at DATETIME(3) NULL ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_postal_entry_ward (ward_id),
      UNIQUE KEY uq_postal_entry_id_ward (id, ward_id),
      KEY idx_postal_entry_entered_by (entered_by),
      KEY idx_postal_entry_updated_by (updated_by),
      CONSTRAINT fk_postal_entry_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_postal_entry_entered_by FOREIGN KEY (entered_by) REFERENCES users (id) ${FK_RULES},
      CONSTRAINT fk_postal_entry_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);

  await knex.raw(`
    CREATE TABLE postal_entry_vote (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entry_id INT UNSIGNED NOT NULL,
      ward_id INT UNSIGNED NOT NULL,
      candidate_id INT UNSIGNED NOT NULL,
      votes INT UNSIGNED NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_postal_entry_vote (entry_id, candidate_id),
      KEY idx_postal_entry_vote_entry_ward (entry_id, ward_id),
      KEY idx_postal_entry_vote_candidate_ward (candidate_id, ward_id),
      CONSTRAINT chk_postal_entry_vote_votes CHECK (votes >= 0),
      CONSTRAINT fk_postal_entry_vote_entry FOREIGN KEY (entry_id, ward_id)
        REFERENCES postal_entry (id, ward_id) ${FK_RULES},
      CONSTRAINT fk_postal_entry_vote_candidate FOREIGN KEY (candidate_id, ward_id)
        REFERENCES candidate (id, ward_id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS postal_entry_vote');
  await knex.raw('DROP TABLE IF EXISTS postal_entry');
  await knex.raw('DROP TABLE IF EXISTS booth_entry_vote');
  await knex.raw('DROP TABLE IF EXISTS booth_entry');
}
