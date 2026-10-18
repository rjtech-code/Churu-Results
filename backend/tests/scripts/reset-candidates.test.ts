import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runResetCandidates } from '../../scripts/reset-candidates.js';
import type { ResetCandidatesOptions } from '../../scripts/reset-candidates.js';
import { insert } from '../helpers/db.js';
import {
  addBoothEntry,
  auditCount,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  resetDb,
  seedCandidates,
  seedGeography,
  seedParties,
  wardId,
} from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
let backup: string;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

/** Candidates + a booth entry with a vote + a locked, "ready" ward: everything the reset removes. */
beforeEach(async () => {
  await resetDb(h);
  await seedGeography(h);
  await seedParties(h);
  await seedCandidates(h);
  await addBoothEntry(h, 'PS');
  const alpha1 = await wardId(h, 'PS', 1);
  const [ids] = await h.app.query<RowDataPacket[]>(
    `SELECT e.id AS entry_id, c.id AS candidate_id, e.entered_by
       FROM booth_entry e JOIN candidate c ON c.ward_id = e.ward_id
      WHERE e.ward_id = ? ORDER BY c.ballot_position LIMIT 1`,
    [alpha1],
  );
  await insert(
    h.app,
    'INSERT INTO booth_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, 0)',
    [Number(ids[0]?.entry_id), alpha1, Number(ids[0]?.candidate_id)],
  );
  await h.app.execute(
    `UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test Officer',
            candidates_ready_at = NOW(3), candidates_ready_by = ? WHERE id = ?`,
    [Number(ids[0]?.entered_by), await wardId(h, 'ZP', 1)],
  );
  backup = join(h.dir, 'backup-test.sql.gz');
  await writeFile(backup, 'not really a dump, but not empty');
});

const run = (options: Partial<ResetCandidatesOptions>) => {
  const { ctx, output } = makeCtx(h);
  return runResetCandidates({ nodeEnv: 'test', backupFile: backup, ...options }, ctx).then(
    (result) => ({ result, output: output.join('\n') }),
  );
};

/** Everything the reset touches or must keep, as one comparable object. */
async function state() {
  const n = (sql: string) => count(h, sql);
  return {
    candidate: await n('SELECT COUNT(*) AS n FROM candidate'),
    booth_entry: await n('SELECT COUNT(*) AS n FROM booth_entry'),
    booth_entry_vote: await n('SELECT COUNT(*) AS n FROM booth_entry_vote'),
    locked: await n('SELECT COUNT(*) AS n FROM ward WHERE is_locked = 1'),
    ready: await n('SELECT COUNT(*) AS n FROM ward WHERE candidates_ready_at IS NOT NULL'),
    unopposed: await n('SELECT COUNT(*) AS n FROM ward WHERE is_unopposed = 1'),
    audit: await auditCount(h),
    kept: await keptState(),
  };
}

async function keptState() {
  const n = (sql: string) => count(h, sql);
  const [res] = await h.app.query<RowDataPacket[]>(
    'SELECT id, reservation_category FROM ward ORDER BY id',
  );
  return {
    district: await n('SELECT COUNT(*) AS n FROM district'),
    ps: await n('SELECT COUNT(*) AS n FROM panchayat_samiti'),
    ward: await n('SELECT COUNT(*) AS n FROM ward'),
    booth: await n('SELECT COUNT(*) AS n FROM booth'),
    party: await n('SELECT COUNT(*) AS n FROM party'),
    users: await n('SELECT COUNT(*) AS n FROM users'),
    settings: await n('SELECT COUNT(*) AS n FROM app_settings'),
    reservations: res,
  };
}

describe('reset-candidates guards (nothing written)', () => {
  it('refuses in production without --yes-this-is-dummy-data, and prints the database name', async () => {
    const before = await state();
    const { result, output } = await run({ nodeEnv: 'production', commit: true });
    expect(result.ok).toBe(false);
    expect(result.committed).toBe(false);
    expect(output).toContain('Database: churu_test');
    expect(output).toContain('--yes-this-is-dummy-data');
    expect(await state()).toEqual(before);
  });

  it('refuses without a backup file, with a missing, an empty or a too-old one', async () => {
    const before = await state();
    const empty = join(h.dir, 'empty.sql.gz');
    await writeFile(empty, '');
    const old = join(h.dir, 'old.sql.gz');
    await writeFile(old, 'dump');
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000);
    await utimes(old, twoDaysAgo, twoDaysAgo);

    const cases: [Partial<ResetCandidatesOptions>, string][] = [
      [{ backupFile: undefined }, '--backup-file <path> is required'],
      [{ backupFile: join(h.dir, 'nope.sql.gz') }, 'Backup file not found'],
      [{ backupFile: empty }, 'Backup file is empty'],
      [{ backupFile: old }, 'the limit is 24'],
      [{ backupFile: old, maxBackupAgeHours: 1 }, 'the limit is 1'],
      [{ maxBackupAgeHours: Number.NaN }, '--max-backup-age-hours must be'],
    ];
    for (const [options, message] of cases) {
      const { result, output } = await run({ ...options, commit: true });
      expect(result.ok, message).toBe(false);
      expect(output).toContain(message);
    }
    // The old backup passes with a larger limit (dry run).
    expect((await run({ backupFile: old, maxBackupAgeHours: 72 })).result.ok).toBe(true);
    expect(await state()).toEqual(before);
  });

  it('refuses while ward_declarations has a row, printing the counts, even with every flag', async () => {
    const zp1 = await wardId(h, 'ZP', 1);
    const [c] = await h.app.query<RowDataPacket[]>(
      'SELECT id FROM candidate WHERE ward_id = ? AND is_nota = 0',
      [zp1],
    );
    const [u] = await h.app.query<RowDataPacket[]>('SELECT id FROM users LIMIT 1');
    await insert(
      h.app,
      `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot, declared_by)
       VALUES (?, 1, 'DECLARED', ?, 1, '{}', ?)`,
      [zp1, Number(c[0]?.id), Number(u[0]?.id)],
    );
    const before = await state();
    const { result, output } = await run({
      nodeEnv: 'production',
      yesDummyData: true,
      commit: true,
    });
    expect(result.ok).toBe(false);
    expect(output).toContain('ward_declarations has 1 row(s) and voided_entry has 0 row(s)');
    expect(output).toContain('Use the full database reset procedure instead');
    expect(await state()).toEqual(before);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM ward_declarations')).toBe(1);
  });
});

describe('reset-candidates', () => {
  it('dry run prints the counts and changes nothing', async () => {
    const before = await state();
    const { result, output } = await run({});
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
    expect(output).toContain('Database: churu_test');
    expect(output).toContain('candidate: 4'); // 3 candidates + NOTA of ALPHA ward 1
    expect(output).toContain('booth_entry_vote: 1');
    expect(output).toContain('DRY RUN OK');
    expect(await state()).toEqual(before);
  });

  it('commit deletes candidates and their counting data, resets ward fields, keeps the rest, audits once', async () => {
    const before = await state();
    expect(before).toMatchObject({ candidate: 4, booth_entry: 1, booth_entry_vote: 1, locked: 1 });
    // Production works only with the explicit flag.
    const { result, output } = await run({
      nodeEnv: 'production',
      yesDummyData: true,
      commit: true,
    });
    expect(result.ok, output).toBe(true);
    expect(result.committed).toBe(true);
    expect(await state()).toEqual({
      candidate: 0,
      booth_entry: 0,
      booth_entry_vote: 0,
      locked: 0,
      ready: 0,
      unopposed: 0,
      audit: before.audit + 1,
      kept: before.kept,
    });
    expect(
      await count(
        h,
        'SELECT COUNT(*) AS n FROM ward WHERE locked_at IS NOT NULL OR locked_by IS NOT NULL OR locked_by_name IS NOT NULL OR candidates_ready_by IS NOT NULL',
      ),
    ).toBe(0);
    const [audit] = await h.app.query<RowDataPacket[]>(
      'SELECT action, user_id, old_value, new_value FROM audit_log ORDER BY id DESC LIMIT 1',
    );
    expect(audit[0]).toMatchObject({ action: 'CANDIDATES_RESET', user_id: null });
    expect(audit[0]?.old_value).toMatchObject({ deleted: { candidate: 4, booth_entry_vote: 1 } });
    expect(audit[0]?.new_value).toMatchObject({ backup_file: 'backup-test.sql.gz' });
  });
});
