import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // The RO's mobile number (DM-only). NULL for accounts made before this column: they keep working.
  // No CHECK on purpose: the 10-digit rule is enforced in the app (Zod), old rows must never break.
  await knex.raw('ALTER TABLE users ADD COLUMN phone VARCHAR(10) NULL AFTER full_name');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE users DROP COLUMN phone');
}
