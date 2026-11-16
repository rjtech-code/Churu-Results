import type { Knex } from 'knex';

/**
 * Prarup-7 column (च) — "क्या पूर्व में पंच या सरपंच का पद धारित किया है": YES / NO, or NULL when it
 * was never recorded (the form then prints a blank cell, never "नहीं" as a guess).
 *
 * Optional and private like the other candidate details, so every candidate that already exists keeps
 * working untouched. The correction history's `field` ENUM gains the same name, or a correction of
 * this detail could not be recorded.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE candidate
      ADD COLUMN held_panch_sarpanch ENUM('YES', 'NO') NULL AFTER occupation
  `);
  await knex.raw(`
    ALTER TABLE candidate_name_change
      MODIFY COLUMN field ENUM('NAME', 'PARTY', 'GENDER', 'CANDIDATE_CATEGORY', 'DOB', 'AGE_STATED',
                               'EDUCATION', 'MOBILE', 'ADDRESS', 'OCCUPATION',
                               'HELD_PANCH_SARPANCH')
        NOT NULL DEFAULT 'NAME'
  `);
}

/**
 * Refuses (changing nothing) once a correction of this detail is recorded: candidate_name_change is
 * append-only, so those rows cannot be rewritten, and shrinking the ENUM under them would turn them
 * into '' — history the officers signed for would be lost.
 */
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw(
    "SELECT COUNT(*) AS n FROM candidate_name_change WHERE field = 'HELD_PANCH_SARPANCH'",
  )) as [{ n: number }[]];
  const n = rows[0]?.n ?? 0;
  if (n > 0) {
    throw new Error(
      `Cannot remove held_panch_sarpanch: ${String(n)} correction(s) of it are recorded in ` +
        'candidate_name_change (append-only). Keep the column.',
    );
  }
  await knex.raw(`
    ALTER TABLE candidate_name_change
      MODIFY COLUMN field ENUM('NAME', 'PARTY', 'GENDER', 'CANDIDATE_CATEGORY', 'DOB', 'AGE_STATED',
                               'EDUCATION', 'MOBILE', 'ADDRESS', 'OCCUPATION')
        NOT NULL DEFAULT 'NAME'
  `);
  await knex.raw('ALTER TABLE candidate DROP COLUMN held_panch_sarpanch');
}
