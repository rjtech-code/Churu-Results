import type { Knex } from 'knex';

// Rounds are gone (DEO order, Nov 2026): counting progress is booths entered / total booths. A booth
// ballot has exactly one live entry, already enforced by uq_booth_entry_booth_ballot (booth_id,
// ballot_for) — round_no was never part of any unique key. A voided entry leaves booth_entry (it is
// archived in voided_entry), so it never counts as live. The round labels of existing entries stay
// readable in audit_log (ENTRY_CREATED / ENTRY_UPDATED / ENTRY_VOIDED values), which is append-only.

const VOIDED_KIND_CHECK_WITH_ROUND = `CHECK (
  (entry_kind = 'BOOTH' AND booth_id IS NOT NULL AND ballot_for IS NOT NULL AND round_no IS NOT NULL
    AND rejected_count IS NULL)
  OR (entry_kind = 'POSTAL' AND booth_id IS NULL AND ballot_for IS NULL AND round_no IS NULL)
)`;
const VOIDED_KIND_CHECK = `CHECK (
  (entry_kind = 'BOOTH' AND booth_id IS NOT NULL AND ballot_for IS NOT NULL AND rejected_count IS NULL)
  OR (entry_kind = 'POSTAL' AND booth_id IS NULL AND ballot_for IS NULL)
)`;

async function count(knex: Knex, sql: string): Promise<number> {
  const [rows] = (await knex.raw(sql)) as unknown as [{ n: number | string }[]];
  return Number(rows[0]?.n ?? 0);
}

// Refuses (changing nothing) if any booth ballot has more than one live entry: dropping the column
// must never be the step that hides or loses a second sheet.
export async function up(knex: Knex): Promise<void> {
  const duplicated = await count(
    knex,
    `SELECT COUNT(*) AS n FROM (
       SELECT booth_id, ballot_for FROM booth_entry GROUP BY booth_id, ballot_for HAVING COUNT(*) > 1
     ) AS d`,
  );
  if (duplicated > 0) {
    throw new Error(
      `Cannot remove round_no: ${String(duplicated)} booth ballot(s) have more than one live entry. ` +
        'Void the extra entries first (nothing was changed).',
    );
  }
  await knex.raw(`
    ALTER TABLE booth_entry
      DROP CHECK chk_booth_entry_round,
      DROP COLUMN round_no
  `);
  await knex.raw(`
    ALTER TABLE voided_entry
      DROP CHECK chk_voided_entry_kind,
      DROP COLUMN round_no,
      ADD CONSTRAINT chk_voided_entry_kind ${VOIDED_KIND_CHECK}
  `);
}

// Refuses while any booth entry (live or voided) exists: there is no round number to give it.
export async function down(knex: Knex): Promise<void> {
  const live = await count(knex, 'SELECT COUNT(*) AS n FROM booth_entry');
  const voided = await count(
    knex,
    "SELECT COUNT(*) AS n FROM voided_entry WHERE entry_kind = 'BOOTH'",
  );
  if (live + voided > 0) {
    throw new Error(
      `Cannot roll back remove_round_no: ${String(live)} live and ${String(voided)} voided booth ` +
        'entries have no round number to restore. Roll back only on a database without booth entries.',
    );
  }
  await knex.raw(`
    ALTER TABLE booth_entry
      ADD COLUMN round_no TINYINT UNSIGNED NOT NULL AFTER ward_id,
      ADD CONSTRAINT chk_booth_entry_round CHECK (round_no >= 1)
  `);
  await knex.raw(`
    ALTER TABLE voided_entry
      DROP CHECK chk_voided_entry_kind,
      ADD COLUMN round_no TINYINT UNSIGNED NULL AFTER ballot_for,
      ADD CONSTRAINT chk_voided_entry_kind ${VOIDED_KIND_CHECK_WITH_ROUND}
  `);
}
