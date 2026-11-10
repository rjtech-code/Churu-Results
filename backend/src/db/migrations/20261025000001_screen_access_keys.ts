import type { Knex } from 'knex';
import { CREATED_AT, FK_RULES, TABLE_OPTIONS } from './table-options.js';

// Screen access keys (Nov 2026): the three public TV screens open only after a key the DM (DEO)
// created. Nobody can open a screen URL at home or in a shop.
//
// screen_key: one row per key, never deleted (the history stays readable).
//   key_hash  HMAC-SHA256 of the normalized key (server secret, see services/screen-key.ts): used to
//             check a typed key. Never the key itself.
//   key_enc   AES-256-GCM copy (RO_PASSWORD_KEY, the same vault as the RO password copies) so the DM
//             can copy the key again later. Wiped (NULL) when the key is revoked.
//   The plain key is never stored, logged or written to the audit log.
//
// screen_session: one row per unlocked browser (TV). The cookie holds a random token; only its
// SHA-256 is stored. A session belongs EITHER to a key (dies with it: revoke deletes the sessions and
// every request re-checks the key) OR is a DM preview (preview_user_id; valid only while that user is
// an active DM). Both tables are plain read-write for the app user: they are access control state,
// not election results.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE screen_key (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      label VARCHAR(60) NOT NULL,
      key_hash BINARY(32) NOT NULL,
      key_enc VARBINARY(255) NULL,
      expires_at DATETIME(3) NULL COMMENT 'NULL = valid until revoked',
      created_by INT UNSIGNED NOT NULL,
      ${CREATED_AT},
      last_used_at DATETIME(3) NULL,
      revoked_at DATETIME(3) NULL,
      revoked_by INT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_screen_key_hash (key_hash),
      KEY idx_screen_key_created_by (created_by),
      KEY idx_screen_key_revoked_by (revoked_by),
      CONSTRAINT chk_screen_key_label CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 1 AND 60),
      CONSTRAINT chk_screen_key_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
      CONSTRAINT chk_screen_key_no_copy_when_revoked CHECK (revoked_at IS NULL OR key_enc IS NULL),
      CONSTRAINT fk_screen_key_created_by FOREIGN KEY (created_by) REFERENCES users (id) ${FK_RULES},
      CONSTRAINT fk_screen_key_revoked_by FOREIGN KEY (revoked_by) REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
  await knex.raw(`
    CREATE TABLE screen_session (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      token_hash BINARY(32) NOT NULL,
      screen_key_id INT UNSIGNED NULL,
      preview_user_id INT UNSIGNED NULL,
      ${CREATED_AT},
      last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_screen_session_token (token_hash),
      KEY idx_screen_session_key (screen_key_id, last_seen_at),
      KEY idx_screen_session_preview_user (preview_user_id),
      KEY idx_screen_session_expires (expires_at),
      CONSTRAINT chk_screen_session_owner CHECK ((screen_key_id IS NULL) <> (preview_user_id IS NULL)),
      CONSTRAINT fk_screen_session_key FOREIGN KEY (screen_key_id)
        REFERENCES screen_key (id) ${FK_RULES},
      CONSTRAINT fk_screen_session_preview_user FOREIGN KEY (preview_user_id)
        REFERENCES users (id) ${FK_RULES}
    ) ${TABLE_OPTIONS}
  `);
}

// Refuses (changing nothing) while any key exists: rolling back would silently open the screens to
// everyone. Revoke-and-forget is not enough; a rollback is a deliberate act on an empty table.
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw('SELECT COUNT(*) AS n FROM screen_key')) as unknown as [
    { n: number | string }[],
  ];
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot remove screen_key: ${String(n)} screen key(s) exist (removing this migration would ` +
        'open the public screens to everyone; nothing was changed).',
    );
  }
  await knex.raw('DROP TABLE IF EXISTS screen_session');
  await knex.raw('DROP TABLE IF EXISTS screen_key');
}
