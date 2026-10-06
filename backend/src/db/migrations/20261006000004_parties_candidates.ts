import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE party (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name_hindi VARCHAR(200) NOT NULL,
      name_english VARCHAR(200) NOT NULL,
      short_name VARCHAR(30) NOT NULL,
      symbol VARCHAR(100) NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_party_name_hindi (name_hindi),
      UNIQUE KEY uq_party_name_english (name_english),
      UNIQUE KEY uq_party_short_name (short_name)
    ) ${TABLE_OPTIONS}
  `);

  // NOTA is a candidate row (is_nota = 1). nota_key is 1 for NOTA and NULL otherwise, so the
  // unique index allows at most one NOTA per ward (NULLs never collide).
  await knex.raw(`
    CREATE TABLE candidate (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_id INT UNSIGNED NOT NULL,
      ballot_position TINYINT UNSIGNED NOT NULL,
      name_hindi VARCHAR(200) NOT NULL,
      party_id INT UNSIGNED NULL COMMENT 'NULL = independent (nirdaliya)',
      gender ENUM('M', 'F', 'O') NULL,
      is_nota TINYINT(1) NOT NULL DEFAULT 0,
      nota_key TINYINT UNSIGNED AS (IF(is_nota = 1, 1, NULL)) STORED,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_candidate_ward_position (ward_id, ballot_position),
      UNIQUE KEY uq_candidate_ward_nota (ward_id, nota_key),
      UNIQUE KEY uq_candidate_id_ward (id, ward_id),
      UNIQUE KEY uq_candidate_id_ward_nota (id, ward_id, is_nota),
      KEY idx_candidate_party (party_id),
      CONSTRAINT chk_candidate_position CHECK (ballot_position >= 1),
      CONSTRAINT chk_candidate_is_nota CHECK (is_nota IN (0, 1)),
      CONSTRAINT chk_candidate_nota_fields CHECK (
        (is_nota = 1 AND party_id IS NULL AND gender IS NULL)
        OR (is_nota = 0 AND gender IS NOT NULL)
      ),
      CONSTRAINT fk_candidate_ward FOREIGN KEY (ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_candidate_party FOREIGN KEY (party_id) REFERENCES party (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS candidate');
  await knex.raw('DROP TABLE IF EXISTS party');
}
