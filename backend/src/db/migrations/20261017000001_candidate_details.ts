import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Optional candidate details for the ST Format returns (F15, F18, F19, F19A). All NULL for
  // candidates added before this column: they keep working. Never shown publicly (DM and the
  // ward's own RO only). The 18..120 age and 10-digit mobile rules are enforced in the app.
  await knex.raw(`
    ALTER TABLE candidate
      ADD COLUMN dob DATE NULL AFTER gender,
      ADD COLUMN age_stated TINYINT UNSIGNED NULL AFTER dob,
      ADD COLUMN education ENUM('ILLITERATE', 'LITERATE', 'PRIMARY', 'UPPER_PRIMARY', 'SECONDARY',
        'SR_SECONDARY', 'GRADUATE', 'POST_GRADUATE', 'PROFESSIONAL') NULL AFTER age_stated,
      ADD COLUMN mobile VARCHAR(10) NULL AFTER education
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE candidate DROP COLUMN mobile, DROP COLUMN education, DROP COLUMN age_stated, DROP COLUMN dob',
  );
}
