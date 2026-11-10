import type { Knex } from 'knex';

// "A" booths (e.g. 15A): a booth is (PS, booth_no, booth_suffix). Numeric booths keep suffix ''.
// NOT NULL '' (not NULL): a MySQL UNIQUE key lets duplicate NULLs through, '' does not.
// Sorting by (booth_no, booth_suffix) gives 12, 12A, 13. The CHECK is case-sensitive ('c').
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE booth
      ADD COLUMN booth_suffix VARCHAR(2) NOT NULL DEFAULT '' AFTER booth_no,
      ADD CONSTRAINT chk_booth_suffix CHECK (REGEXP_LIKE(booth_suffix, '^[A-Z]{0,2}$', 'c')),
      ADD UNIQUE KEY uq_booth_ps_no_suffix (panchayat_samiti_id, booth_no, booth_suffix),
      DROP INDEX uq_booth_ps_no
  `);
}

// Refuses while any suffixed booth exists: dropping the column would lose them or break uq_booth_ps_no.
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw(
    "SELECT COUNT(*) AS n FROM booth WHERE booth_suffix <> ''",
  )) as unknown as [{ n: number | string }[]];
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot roll back booth_suffix: ${String(n)} booth(s) have a suffix (e.g. 15A). Remove them first.`,
    );
  }
  await knex.raw(`
    ALTER TABLE booth
      ADD UNIQUE KEY uq_booth_ps_no (panchayat_samiti_id, booth_no),
      DROP INDEX uq_booth_ps_no_suffix,
      DROP CHECK chk_booth_suffix,
      DROP COLUMN booth_suffix
  `);
}
