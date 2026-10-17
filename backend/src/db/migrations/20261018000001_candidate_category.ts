import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // The candidate's own social category for the ST Format returns (F15, F16, F17, F18). Optional
  // and private, like the other candidate details. Not the ward's reservation: a SC or OBC
  // candidate may win a general seat.
  await knex.raw(`
    ALTER TABLE candidate
      ADD COLUMN candidate_category ENUM('GEN', 'SC', 'ST', 'OBC') NULL AFTER mobile
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE candidate DROP COLUMN candidate_category');
}
