import type { Knex } from 'knex';

// "विवरण सुधारें" (Nov 2026): after the ballot lock an RO may correct not only the candidate's name
// but every other candidate detail too (party, gender, own category, date of birth / age, education,
// mobile, address, occupation). The ballot position, adding / removing a candidate and NOTA stay
// frozen forever.
//
// The same append-only history table keeps them: ONE ROW PER CHANGED FIELD, so "what changed" is
// never guessed from two names. New columns:
//   field      which detail changed (NAME for every row written before this migration)
//   old_value  / new_value  the value as text, for every field including NAME
//
// Old rows are kept exactly as they are (the table is append-only: no backfill UPDATE is possible,
// and the triggers would refuse one). They carry field = 'NAME' with old_value / new_value NULL, and
// every read COALESCEs them with old_name_hindi / new_name_hindi, so they stay fully readable.
//
// old_name_hindi / new_name_hindi become NULL-able: they are filled for NAME rows only (so every
// older reader of the table keeps working), and the names CHECK moves into chk_candidate_change.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE candidate_name_change
      DROP CHECK chk_candidate_name_change_names,
      MODIFY COLUMN old_name_hindi VARCHAR(200) NULL
        COMMENT 'NAME rows only (NULL for every other field)',
      MODIFY COLUMN new_name_hindi VARCHAR(200) NULL
        COMMENT 'NAME rows only (NULL for every other field)',
      ADD COLUMN field ENUM('NAME', 'PARTY', 'GENDER', 'CANDIDATE_CATEGORY', 'DOB', 'AGE_STATED',
                            'EDUCATION', 'MOBILE', 'ADDRESS', 'OCCUPATION')
        NOT NULL DEFAULT 'NAME' AFTER ballot_position,
      ADD COLUMN old_value VARCHAR(500) NULL AFTER field,
      ADD COLUMN new_value VARCHAR(500) NULL AFTER old_value,
      ADD CONSTRAINT chk_candidate_change CHECK (
        (
          field = 'NAME'
          AND old_name_hindi IS NOT NULL AND new_name_hindi IS NOT NULL
          AND CHAR_LENGTH(TRIM(old_name_hindi)) > 0 AND CHAR_LENGTH(TRIM(new_name_hindi)) > 0
          AND old_name_hindi <> new_name_hindi
        )
        OR (
          field <> 'NAME'
          AND old_name_hindi IS NULL AND new_name_hindi IS NULL
          AND (old_value IS NOT NULL OR new_value IS NOT NULL)
          AND NOT (old_value <=> new_value)
        )
      )
  `);
  await knex.raw(
    'ALTER TABLE candidate_name_change ADD KEY idx_candidate_name_change_field (field)',
  );
}

// Refuses (changing nothing) while any correction of a field other than the name is recorded: those
// rows cannot be represented by the old two-name shape, and the history is never thrown away.
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw(
    "SELECT COUNT(*) AS n FROM candidate_name_change WHERE field <> 'NAME'",
  )) as unknown as [{ n: number | string }[]];
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot remove the candidate detail history: ${String(n)} correction(s) of a field other ` +
        'than the name are recorded (the history is kept forever; nothing was changed).',
    );
  }
  await knex.raw(`
    ALTER TABLE candidate_name_change
      DROP CHECK chk_candidate_change,
      DROP KEY idx_candidate_name_change_field,
      DROP COLUMN field,
      DROP COLUMN old_value,
      DROP COLUMN new_value,
      MODIFY COLUMN old_name_hindi VARCHAR(200) NOT NULL,
      MODIFY COLUMN new_name_hindi VARCHAR(200) NOT NULL,
      ADD CONSTRAINT chk_candidate_name_change_names CHECK (
        CHAR_LENGTH(TRIM(old_name_hindi)) > 0
        AND CHAR_LENGTH(TRIM(new_name_hindi)) > 0
        AND old_name_hindi <> new_name_hindi
      )
  `);
}
