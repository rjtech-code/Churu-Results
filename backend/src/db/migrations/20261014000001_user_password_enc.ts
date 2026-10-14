import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Part 13.2: AES-256-GCM copy of an RO's password so the DM can view it (see password-vault.ts).
  // The bcrypt hash stays the only thing used for login. The DM account never has a copy.
  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN password_enc VARBINARY(255) NULL AFTER password_hash,
      ADD CONSTRAINT chk_users_dm_no_password_copy CHECK (role <> 'DM' OR password_enc IS NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE users
      DROP CONSTRAINT chk_users_dm_no_password_copy,
      DROP COLUMN password_enc
  `);
}
