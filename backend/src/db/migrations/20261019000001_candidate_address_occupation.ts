import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Optional candidate details for Prarup-7 (पता, व्यवसाय). Private, like the other details. NULL
  // for every candidate added before: they keep working. Length limits are checked in the app too.
  await knex.raw(`
    ALTER TABLE candidate
      ADD COLUMN address VARCHAR(300) NULL AFTER candidate_category,
      ADD COLUMN occupation VARCHAR(100) NULL AFTER address
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE candidate DROP COLUMN occupation, DROP COLUMN address');
}
