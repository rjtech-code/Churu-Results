import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS, UPDATED_AT } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE district (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(10) NOT NULL,
      name_english VARCHAR(100) NOT NULL,
      name_hindi VARCHAR(150) NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_district_code (code)
    ) ${TABLE_OPTIONS}
  `);

  await knex.raw(`
    CREATE TABLE panchayat_samiti (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      district_id INT UNSIGNED NOT NULL,
      name_english VARCHAR(150) NOT NULL,
      name_hindi VARCHAR(200) NOT NULL,
      ${CREATED_AT},
      ${UPDATED_AT},
      PRIMARY KEY (id),
      UNIQUE KEY uq_ps_district_name_english (district_id, name_english),
      UNIQUE KEY uq_ps_district_name_hindi (district_id, name_hindi),
      UNIQUE KEY uq_ps_id_district (id, district_id),
      CONSTRAINT fk_ps_district FOREIGN KEY (district_id) REFERENCES district (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS panchayat_samiti');
  await knex.raw('DROP TABLE IF EXISTS district');
}
