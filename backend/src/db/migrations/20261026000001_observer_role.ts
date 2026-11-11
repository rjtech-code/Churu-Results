import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // OBSERVER (Nov 2026): read-only executive dashboard logins for senior officers outside the
  // district (state / Election Commission level). Several active observers may exist (one per
  // officer), so active_slot — the one-ACTIVE-account-per-seat key — is NULL for them. Like the DM
  // and the Super Admin, an observer never has an encrypted password copy (bcrypt hash only).
  // Observers can change nothing: the global observerGuard limits them to /api/auth and
  // GET /api/observer (middleware/auth.ts).
  await knex.raw(`
    ALTER TABLE users
      DROP CHECK chk_users_role_ps,
      DROP CHECK chk_users_super_admin_no_password_copy,
      MODIFY COLUMN role ENUM('PS_RO', 'ZP_RO', 'DM', 'SUPER_ADMIN', 'OBSERVER') NOT NULL,
      MODIFY COLUMN active_slot VARCHAR(40) AS (
        IF(is_active = 1 AND role <> 'OBSERVER', CONCAT(role, ':', IFNULL(panchayat_samiti_id, 0)), NULL)
      ) STORED,
      ADD CONSTRAINT chk_users_role_ps CHECK (
        (role = 'PS_RO' AND panchayat_samiti_id IS NOT NULL)
        OR (role IN ('ZP_RO', 'DM', 'SUPER_ADMIN', 'OBSERVER') AND panchayat_samiti_id IS NULL)
      ),
      ADD CONSTRAINT chk_users_no_password_copy
        CHECK (role NOT IN ('SUPER_ADMIN', 'OBSERVER') OR password_enc IS NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Fails while an OBSERVER row exists (the ENUM cannot shrink under it): remove those rows first.
  await knex.raw(`
    ALTER TABLE users
      DROP CHECK chk_users_no_password_copy,
      DROP CHECK chk_users_role_ps,
      MODIFY COLUMN role ENUM('PS_RO', 'ZP_RO', 'DM', 'SUPER_ADMIN') NOT NULL,
      MODIFY COLUMN active_slot VARCHAR(40) AS (
        IF(is_active = 1, CONCAT(role, ':', IFNULL(panchayat_samiti_id, 0)), NULL)
      ) STORED,
      ADD CONSTRAINT chk_users_role_ps CHECK (
        (role = 'PS_RO' AND panchayat_samiti_id IS NOT NULL)
        OR (role IN ('ZP_RO', 'DM', 'SUPER_ADMIN') AND panchayat_samiti_id IS NULL)
      ),
      ADD CONSTRAINT chk_users_super_admin_no_password_copy
        CHECK (role <> 'SUPER_ADMIN' OR password_enc IS NULL)
  `);
}
