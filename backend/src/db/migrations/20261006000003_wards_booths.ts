import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // One table for PS and ZP wards, so candidates/entries/declarations have a single FK target.
  // A PS ward belongs to one PS; a ZP ward belongs to the district (it may span several PS).
  // ps_scope turns the nullable PS id into 0 so ward_no is unique within its scope.
  await knex.raw(`
    CREATE TABLE ward (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ward_type ENUM('PS', 'ZP') NOT NULL,
      district_id INT UNSIGNED NOT NULL,
      panchayat_samiti_id INT UNSIGNED NULL,
      ward_no SMALLINT UNSIGNED NOT NULL,
      ps_scope INT UNSIGNED AS (IFNULL(panchayat_samiti_id, 0)) STORED,
      is_locked TINYINT(1) NOT NULL DEFAULT 0,
      locked_at DATETIME(3) NULL,
      locked_by INT UNSIGNED NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_ward_scope_no (district_id, ward_type, ps_scope, ward_no),
      UNIQUE KEY uq_ward_id_type (id, ward_type),
      UNIQUE KEY uq_ward_id_type_ps (id, ward_type, panchayat_samiti_id),
      KEY idx_ward_ps_type_no (panchayat_samiti_id, ward_type, ward_no),
      KEY idx_ward_ps_district (panchayat_samiti_id, district_id),
      KEY idx_ward_locked_by (locked_by),
      CONSTRAINT chk_ward_type_scope CHECK (
        (ward_type = 'PS' AND panchayat_samiti_id IS NOT NULL)
        OR (ward_type = 'ZP' AND panchayat_samiti_id IS NULL)
      ),
      CONSTRAINT chk_ward_no CHECK (ward_no >= 1),
      CONSTRAINT chk_ward_lock CHECK (
        (is_locked = 0 AND locked_at IS NULL AND locked_by IS NULL)
        OR (is_locked = 1 AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
      ),
      CONSTRAINT fk_ward_district FOREIGN KEY (district_id) REFERENCES district (id) ${FK_RULES},
      CONSTRAINT fk_ward_ps_district FOREIGN KEY (panchayat_samiti_id, district_id)
        REFERENCES panchayat_samiti (id, district_id) ${FK_RULES},
      CONSTRAINT fk_ward_locked_by FOREIGN KEY (locked_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);

  // Booth identity = (PS, booth_no); booth numbers restart in every PS.
  // ps_ward_type / zp_ward_type are constants so composite FKs can prove that the PS ward is
  // a PS ward of THIS booth's PS, and the ZP ward is a ZP ward.
  await knex.raw(`
    CREATE TABLE booth (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      panchayat_samiti_id INT UNSIGNED NOT NULL,
      booth_no SMALLINT UNSIGNED NOT NULL,
      name_hindi VARCHAR(300) NOT NULL,
      name_english VARCHAR(300) NULL,
      ps_ward_id INT UNSIGNED NOT NULL,
      ps_ward_type ENUM('PS', 'ZP') AS ('PS') STORED NOT NULL,
      zp_ward_id INT UNSIGNED NOT NULL,
      zp_ward_type ENUM('PS', 'ZP') AS ('ZP') STORED NOT NULL,
      registered_voters_male INT UNSIGNED NULL,
      registered_voters_female INT UNSIGNED NULL,
      registered_voters_total INT UNSIGNED NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_booth_ps_no (panchayat_samiti_id, booth_no),
      KEY idx_booth_ps_ward (ps_ward_id),
      KEY idx_booth_zp_ward (zp_ward_id),
      CONSTRAINT chk_booth_no CHECK (booth_no >= 1),
      CONSTRAINT chk_booth_voters CHECK (
        registered_voters_male IS NULL
        OR registered_voters_female IS NULL
        OR registered_voters_total IS NULL
        OR registered_voters_male + registered_voters_female <= registered_voters_total
      ),
      CONSTRAINT fk_booth_ps FOREIGN KEY (panchayat_samiti_id) REFERENCES panchayat_samiti (id) ${FK_RULES},
      CONSTRAINT fk_booth_ps_ward FOREIGN KEY (ps_ward_id, ps_ward_type, panchayat_samiti_id)
        REFERENCES ward (id, ward_type, panchayat_samiti_id) ${FK_RULES},
      CONSTRAINT fk_booth_zp_ward FOREIGN KEY (zp_ward_id, zp_ward_type)
        REFERENCES ward (id, ward_type) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS booth');
  await knex.raw('DROP TABLE IF EXISTS ward');
}
