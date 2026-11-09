import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // Official order: the postal ballots of each ZP ward are entered by ONE fixed PS_RO (the PS here).
  // One row per ZP ward (UNIQUE). Filled by `npm run zp-postal:set-default -- --commit` AFTER the
  // geography and candidates are loaded (ward ids are new after every geography import).
  // RESTRICT foreign keys: the geography import deletes these rows itself before it deletes wards.
  await knex.raw(`
    CREATE TABLE zp_ward_postal_assignment (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      zp_ward_id INT UNSIGNED NOT NULL,
      ps_id INT UNSIGNED NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_zp_postal_ward (zp_ward_id),
      KEY idx_zp_postal_ps (ps_id),
      CONSTRAINT fk_zp_postal_ward FOREIGN KEY (zp_ward_id) REFERENCES ward (id) ${FK_RULES},
      CONSTRAINT fk_zp_postal_ps FOREIGN KEY (ps_id) REFERENCES panchayat_samiti (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS zp_ward_postal_assignment');
}
