import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Rejected postal ballots are recorded, but are not part of any sum check yet.
  await knex.raw(`
    ALTER TABLE postal_entry
      ADD COLUMN rejected_count INT UNSIGNED NULL AFTER sheet_total
  `);

  // is_unopposed: ward has exactly one candidate (no poll, no NOTA).
  // reservation_category: belongs to the ward (e.g. as printed on the official list).
  await knex.raw(`
    ALTER TABLE ward
      ADD COLUMN is_unopposed BOOLEAN NOT NULL DEFAULT FALSE AFTER ward_no,
      ADD COLUMN reservation_category VARCHAR(50) NULL AFTER is_unopposed,
      ADD CONSTRAINT chk_ward_is_unopposed CHECK (is_unopposed IN (0, 1))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE ward
      DROP CHECK chk_ward_is_unopposed,
      DROP COLUMN reservation_category,
      DROP COLUMN is_unopposed
  `);
  await knex.raw('ALTER TABLE postal_entry DROP COLUMN rejected_count');
}
