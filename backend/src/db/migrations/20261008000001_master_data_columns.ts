import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Officer's real name for users created by `npm run users:create`. Nullable so rows inserted
  // without it (older test fixtures) stay valid; the CLI always sets it. Never blank.
  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN full_name VARCHAR(100) NULL AFTER username,
      ADD CONSTRAINT chk_users_full_name CHECK (full_name IS NULL OR CHAR_LENGTH(TRIM(full_name)) > 0)
  `);

  // Ballots are locked from the CLI by a named person (`--by "<name>"`), often before any user
  // account exists. locked_by (FK to users) stays for a future in-app lock; one of the two is required.
  await knex.raw(`
    ALTER TABLE ward
      DROP CHECK chk_ward_lock,
      ADD COLUMN locked_by_name VARCHAR(100) NULL AFTER locked_by,
      ADD CONSTRAINT chk_ward_lock CHECK (
        (is_locked = 0 AND locked_at IS NULL AND locked_by IS NULL AND locked_by_name IS NULL)
        OR (
          is_locked = 1 AND locked_at IS NOT NULL
          AND (locked_by IS NOT NULL OR CHAR_LENGTH(TRIM(locked_by_name)) > 0)
        )
      )
  `);

  // At most one candidate per party per ward. Independents and NOTA have party_id NULL,
  // and NULLs never collide in a UNIQUE index, so they are unaffected.
  await knex.raw(
    'ALTER TABLE candidate ADD UNIQUE KEY uq_candidate_ward_party (ward_id, party_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE candidate DROP INDEX uq_candidate_ward_party');
  await knex.raw(`
    ALTER TABLE ward
      DROP CHECK chk_ward_lock,
      DROP COLUMN locked_by_name,
      ADD CONSTRAINT chk_ward_lock CHECK (
        (is_locked = 0 AND locked_at IS NULL AND locked_by IS NULL)
        OR (is_locked = 1 AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
      )
  `);
  await knex.raw(`
    ALTER TABLE users
      DROP CHECK chk_users_full_name,
      DROP COLUMN full_name
  `);
}
