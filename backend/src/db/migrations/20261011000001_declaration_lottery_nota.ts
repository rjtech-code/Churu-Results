import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // lottery_details: who conducted the tie lottery, who won, notes. Present exactly for TIE_RESOLVED.
  // nota_highest_ack: the RO acknowledged that NOTA had the most votes (official rule unconfirmed).
  await knex.raw(`
    ALTER TABLE ward_declarations
      ADD COLUMN lottery_details JSON NULL AFTER snapshot,
      ADD COLUMN nota_highest_ack TINYINT(1) NOT NULL DEFAULT 0 AFTER lottery_details,
      ADD CONSTRAINT chk_ward_declarations_lottery CHECK ((status = 'TIE_RESOLVED') = (lottery_details IS NOT NULL)),
      ADD CONSTRAINT chk_ward_declarations_nota_ack CHECK (nota_highest_ack IN (0, 1))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE ward_declarations
      DROP CHECK chk_ward_declarations_nota_ack,
      DROP CHECK chk_ward_declarations_lottery,
      DROP COLUMN nota_highest_ack,
      DROP COLUMN lottery_details
  `);
}
