import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // One SUPER_ADMIN login (created once by `npm run users:create -- --role SUPER_ADMIN`): the setup
  // panel (DM account, candidate reset, full reset, booths, counting lock). No PS, and like the DM
  // never an encrypted password copy. active_slot "SUPER_ADMIN:0" keeps it to one active account.
  await knex.raw(`
    ALTER TABLE users
      MODIFY COLUMN role ENUM('PS_RO', 'ZP_RO', 'DM', 'SUPER_ADMIN') NOT NULL,
      DROP CHECK chk_users_role_ps,
      ADD CONSTRAINT chk_users_role_ps CHECK (
        (role = 'PS_RO' AND panchayat_samiti_id IS NOT NULL)
        OR (role IN ('ZP_RO', 'DM', 'SUPER_ADMIN') AND panchayat_samiti_id IS NULL)
      ),
      ADD CONSTRAINT chk_users_super_admin_no_password_copy
        CHECK (role <> 'SUPER_ADMIN' OR password_enc IS NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Fails while a SUPER_ADMIN row exists (the ENUM cannot shrink under it): remove that row first.
  await knex.raw(`
    ALTER TABLE users
      DROP CHECK chk_users_super_admin_no_password_copy,
      DROP CHECK chk_users_role_ps,
      MODIFY COLUMN role ENUM('PS_RO', 'ZP_RO', 'DM') NOT NULL,
      ADD CONSTRAINT chk_users_role_ps CHECK (
        (role = 'PS_RO' AND panchayat_samiti_id IS NOT NULL)
        OR (role IN ('ZP_RO', 'DM') AND panchayat_samiti_id IS NULL)
      )
  `);
}
