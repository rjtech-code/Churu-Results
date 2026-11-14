import type { Knex } from 'knex';

// FIX (Nov 2026): "विवरण सुधारें" failed with "Check constraint 'chk_candidate_change' is violated"
// for corrections that are real but which the TABLE's collation calls "the same value".
//
// The table is utf8mb4_unicode_ci: case-insensitive, accent-insensitive and PAD SPACE. So inside the
// old CHECK 'फारूक' = 'फ़ारूक़' (a nukta added — one of the commonest name corrections), 'RAMESH' =
// 'Ramesh' and 'कृषि' = 'कृषि ' are all TRUE, while the application compares the two values exactly
// and therefore writes a history row. The CHECK refused that row, and because the row is written in
// the same transaction as the candidate UPDATE and the audit row, the whole correction was lost and
// the RO saw a database error.
//
// Two corrections here, both keeping what the constraint was for (never a history row that records
// nothing):
//   1. "the two values really differ" is now judged byte-for-byte (utf8mb4_bin), exactly the way the
//      application judges it, instead of by the table's ci/PAD-SPACE collation.
//   2. a PARTY row may carry the same text twice: the party is identified by candidate.party_id, and
//      a parties list may legitimately hold a party whose short name is "निर्दलीय" — moving a
//      candidate between that party and no party at all IS a change, even though both sides read
//      "निर्दलीय". Every other field keeps the "must really differ" rule.
//
// Safe on a live table: the new rule is strictly weaker than the old one (anything the ci collation
// called different is different byte-for-byte too), so every row already stored satisfies it and the
// ALTER cannot fail on existing data.
const CHECK = `(
          field = 'NAME'
          AND old_name_hindi IS NOT NULL AND new_name_hindi IS NOT NULL
          AND CHAR_LENGTH(TRIM(old_name_hindi)) > 0 AND CHAR_LENGTH(TRIM(new_name_hindi)) > 0
          AND old_name_hindi COLLATE utf8mb4_bin <> new_name_hindi
        )
        OR (
          field <> 'NAME'
          AND old_name_hindi IS NULL AND new_name_hindi IS NULL
          AND (old_value IS NOT NULL OR new_value IS NOT NULL)
          AND (field = 'PARTY' OR NOT (old_value COLLATE utf8mb4_bin <=> new_value))
        )`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE candidate_name_change
      DROP CHECK chk_candidate_change,
      ADD CONSTRAINT chk_candidate_change CHECK (${CHECK})
  `);
}

// Back to the collation-aware comparison. Rows that only the exact comparison allows (a nukta, a
// letter case, a PARTY row with the same text twice) would make the old CHECK fail on existing data,
// so this refuses instead of leaving a half-applied schema behind.
export async function down(knex: Knex): Promise<void> {
  const [rows] = (await knex.raw(`
    SELECT COUNT(*) AS n FROM candidate_name_change
     WHERE (field = 'NAME' AND NOT (old_name_hindi <> new_name_hindi))
        OR (field <> 'NAME' AND (old_value <=> new_value))
  `)) as unknown as [{ n: number | string }[]];
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    throw new Error(
      `Cannot restore the old candidate-change CHECK: ${String(n)} recorded correction(s) differ ` +
        'only in case, accent (nukta) or spacing, or are party changes with the same label; the ' +
        'old rule would refuse them (nothing was changed).',
    );
  }
  await knex.raw(`
    ALTER TABLE candidate_name_change
      DROP CHECK chk_candidate_change,
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
}
