import type { Knex } from 'knex';
import { FK_RULES } from './table-options.js';

export async function up(knex: Knex): Promise<void> {
  // Candidate-list workflow (Part 13): the RO (or a DM upload) marks a ward's list as ready; the DM
  // can send it back with a reason. Purely informational: the ballot lock is still is_locked.
  await knex.raw(`
    ALTER TABLE ward
      ADD COLUMN candidates_ready_at DATETIME(3) NULL AFTER locked_by_name,
      ADD COLUMN candidates_ready_by INT UNSIGNED NULL AFTER candidates_ready_at,
      ADD COLUMN candidates_return_reason VARCHAR(500) NULL AFTER candidates_ready_by,
      ADD KEY idx_ward_candidates_ready_by (candidates_ready_by),
      ADD CONSTRAINT chk_ward_candidates_ready CHECK (
        (candidates_ready_at IS NULL AND candidates_ready_by IS NULL)
        OR (candidates_ready_at IS NOT NULL AND candidates_ready_by IS NOT NULL)
      ),
      ADD CONSTRAINT chk_ward_return_reason CHECK (
        candidates_return_reason IS NULL OR CHAR_LENGTH(TRIM(candidates_return_reason)) > 0
      ),
      ADD CONSTRAINT fk_ward_candidates_ready_by FOREIGN KEY (candidates_ready_by)
        REFERENCES users (id) ${FK_RULES}
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE ward
      DROP FOREIGN KEY fk_ward_candidates_ready_by,
      DROP CHECK chk_ward_return_reason,
      DROP CHECK chk_ward_candidates_ready,
      DROP KEY idx_ward_candidates_ready_by,
      DROP COLUMN candidates_return_reason,
      DROP COLUMN candidates_ready_by,
      DROP COLUMN candidates_ready_at
  `);
}
