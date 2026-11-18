import type { Knex } from 'knex';

// Per-screen screen sessions (Nov 2026). Until now a screen session said nothing about WHICH of the
// three public screens it was for: a key typed on screen 1 opened screens 2 and 3 as well, and
// switching one screen off could not end that screen's sessions without ending the others'.
//
// screen_session.screen holds '1', '2' or '3' — the screen the key was typed into (or the screen a
// Super Admin preview was opened for). It is the session's whole scope: the server serves a screen's
// results only to a session of that screen, and turning a screen off or on deletes exactly that
// screen's rows.
//
// Why NULL is allowed: this column is added to a live table, so the rows that exist at deploy time
// (TVs unlocked before it) get NULL. A NULL screen is NOT valid for any screen — those sessions are
// dead the moment this migration runs and every TV types its key once more. Leaving them valid for
// all three would keep exactly the weakness this change removes. Every row written from here on has
// a screen (services/screen-keys.service.ts is the only writer).
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE screen_session
       ADD COLUMN screen CHAR(1) NULL
         COMMENT '1/2/3 = the only screen this session may watch; NULL = pre-upgrade row, valid for nothing'
         AFTER preview_user_id,
       ADD KEY idx_screen_session_screen (screen)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Rolling back makes every live session unscoped again, so the sessions go with the column:
  // nobody should silently get a key that opens all three screens.
  await knex.raw('DELETE FROM screen_session');
  await knex.raw(
    'ALTER TABLE screen_session DROP KEY idx_screen_session_screen, DROP COLUMN screen',
  );
}
