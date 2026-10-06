import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runBallotLock } from '../../scripts/ballot-lock.js';
import { runBallotReport } from '../../scripts/ballot-report.js';
import { runBallotUnlock } from '../../scripts/ballot-unlock.js';
import {
  ALPHA,
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
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetDb(h);
  await seedGeography(h);
  await seedParties(h);
  await seedCandidates(h); // ALPHA PS ward 1 (2 + NOTA) and ZP ward 1 (unopposed)
});

const lockedCount = () => count(h, 'SELECT COUNT(*) AS n FROM ward WHERE is_locked = 1');

interface LockState {
  is_locked: number;
  locked_by: number | null;
  locked_by_name: string | null;
  has_time: number;
}

async function lockState(id: number): Promise<LockState | undefined> {
  const [rows] = await h.app.query<RowDataPacket[]>(
    'SELECT is_locked, locked_by, locked_by_name, locked_at IS NOT NULL AS has_time FROM ward WHERE id = ?',
    [id],
  );
  const row = rows[0];
  // Expressions come back as BIGINT strings from the pool (bigNumberStrings), so convert.
  if (row === undefined) return undefined;
  return {
    is_locked: Number(row.is_locked),
    locked_by: row.locked_by === null ? null : Number(row.locked_by),
    locked_by_name: row.locked_by_name === null ? null : String(row.locked_by_name),
    has_time: Number(row.has_time),
  };
}

describe('ballot:lock', () => {
  it('locks a ward with --yes and writes one audit row', async () => {
    const id = await wardId(h, 'PS', 1);
    const before = await auditCount(h);
    const result = await runBallotLock(
      { ward: String(id), by: 'Ram Lal, ARO', commit: true, yes: true },
      makeCtx(h).ctx,
    );
    expect(result).toMatchObject({ ok: true, committed: true, locked: [id] });
    expect(await lockState(id)).toEqual({
      is_locked: 1,
      locked_by: null,
      locked_by_name: 'Ram Lal, ARO',
      has_time: 1,
    });
    expect(await auditCount(h)).toBe(before + 1);
    const [audit] = await h.app.query<RowDataPacket[]>(
      "SELECT entity_id, new_value FROM audit_log WHERE action = 'BALLOT_LOCK'",
    );
    expect(audit[0]).toMatchObject({
      entity_id: String(id),
      new_value: { locked_by_name: 'Ram Lal, ARO', locked_ward_ids: [id] },
    });
  });

  it('without --yes asks to type LOCK; any other answer locks nothing', async () => {
    const id = await wardId(h, 'PS', 1);
    const { ctx, output } = makeCtx(h, 'lock');
    const result = await runBallotLock({ ward: String(id), by: 'Ram', commit: true }, ctx);
    expect(result.ok).toBe(false);
    expect(output).toContain('Type LOCK to confirm: ');
    expect(await lockedCount()).toBe(0);

    const yes = await runBallotLock(
      { ward: String(id), by: 'Ram', commit: true },
      makeCtx(h, 'LOCK').ctx,
    );
    expect(yes.ok).toBe(true);
    expect(await lockedCount()).toBe(1);
  });

  it('--all with any ward lacking candidates is an error and locks nothing', async () => {
    const result = await runBallotLock(
      { all: true, by: 'Ram', commit: true, yes: true },
      makeCtx(h).ctx,
    );
    expect(result.ok).toBe(false);
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toContain('has no candidates; it cannot be locked');
    expect(await lockedCount()).toBe(0);
  });

  it("--ps locks only that PS's PS wards; already-locked wards are skipped and listed", async () => {
    // Give ALPHA PS ward 2 a candidate so every ALPHA ward is lockable.
    await seedCandidates(h, [[ALPHA, 'PS', 2, 1, 'अकेला', null, 'M', null]]);
    const ward1 = await wardId(h, 'PS', 1);
    const ward2 = await wardId(h, 'PS', 2);
    await runBallotLock(
      { ward: String(ward1), by: 'Ram', commit: true, yes: true },
      makeCtx(h).ctx,
    );
    const result = await runBallotLock(
      { ps: ALPHA.toLowerCase(), by: 'Ram', commit: true, yes: true },
      makeCtx(h).ctx,
    );
    expect(result).toMatchObject({ ok: true, locked: [ward2], alreadyLocked: [ward1] });
    expect(await readFile(result.reportPath, 'utf8')).toContain('Already locked — skipped (1)');
    expect(await lockedCount()).toBe(2); // the ZP ward is not touched by --ps
  });

  it('requires exactly one selector and --by', async () => {
    const result = await runBallotLock(
      { all: true, ward: '1', commit: true, yes: true },
      makeCtx(h).ctx,
    );
    expect(result.ok).toBe(false);
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toContain('Give exactly one of --ward <id>, --ps <name> or --all.');
    expect(text).toContain('--by "<person name>" is required.');
  });

  it('a dry run locks nothing and writes no audit row', async () => {
    const before = await auditCount(h);
    const result = await runBallotLock(
      { ward: String(await wardId(h, 'PS', 1)), by: 'Ram' },
      makeCtx(h).ctx,
    );
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(await lockedCount()).toBe(0);
    expect(await auditCount(h)).toBe(before);
  });
});

describe('ballot:unlock', () => {
  async function lockAlpha1(): Promise<number> {
    const id = await wardId(h, 'PS', 1);
    await runBallotLock({ ward: String(id), by: 'Ram', commit: true, yes: true }, makeCtx(h).ctx);
    return id;
  }

  it('unlocks with a reason and records it in the audit log', async () => {
    const id = await lockAlpha1();
    const result = await runBallotUnlock(
      { ward: String(id), reason: 'Candidate name misspelt', by: 'Shyam', commit: true },
      makeCtx(h).ctx,
    );
    expect(result.ok).toBe(true);
    expect(await lockState(id)).toEqual({
      is_locked: 0,
      locked_by: null,
      locked_by_name: null,
      has_time: 0,
    });
    const [audit] = await h.app.query<RowDataPacket[]>(
      "SELECT reason, old_value, new_value FROM audit_log WHERE action = 'BALLOT_UNLOCK'",
    );
    expect(audit[0]).toMatchObject({
      reason: 'Candidate name misspelt',
      old_value: { locked_by_name: 'Ram' },
      new_value: { unlocked_by_name: 'Shyam' },
    });
  });

  it('is refused when the ward has a booth entry', async () => {
    const id = await lockAlpha1();
    await addBoothEntry(h, 'PS');
    const result = await runBallotUnlock(
      { ward: String(id), reason: 'x', by: 'Shyam', commit: true },
      makeCtx(h).ctx,
    );
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('it can no longer be unlocked');
    expect((await lockState(id))?.is_locked).toBe(1);
  });

  it('fails without a reason', async () => {
    const id = await lockAlpha1();
    for (const reason of [undefined, '   ']) {
      const result = await runBallotUnlock(
        { ward: String(id), reason, by: 'Shyam', commit: true },
        makeCtx(h).ctx,
      );
      expect(result.ok).toBe(false);
      expect(await readFile(result.reportPath, 'utf8')).toContain('--reason "<text>" is required.');
    }
    expect((await lockState(id))?.is_locked).toBe(1);
  });

  it('fails for a ward that is not locked', async () => {
    const result = await runBallotUnlock(
      { ward: String(await wardId(h, 'PS', 1)), reason: 'x', by: 'Shyam', commit: true },
      makeCtx(h).ctx,
    );
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('is not locked');
  });
});

describe('ballot:report', () => {
  it('writes one sheet per PS plus ZP, with NOTA and unopposed marked', async () => {
    const out = join(h.dir, 'ballot.xlsx');
    const result = await runBallotReport({ out }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    expect(result.sheets).toEqual(['ALPHA', 'BETA', 'ZP']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const alpha = wb.getWorksheet('ALPHA');
    const rows = (alpha?.getSheetValues() ?? [])
      .slice(2)
      .map((r) => (Array.isArray(r) ? r.slice(1) : []));
    expect(rows.map((r) => [r[0], r[4], r[5], r[8]])).toEqual([
      [1, 1, 'राम', undefined],
      [1, 2, 'सीता', undefined],
      [1, 3, 'इनमें से कोई नहीं', 'NOTA'],
      [2, undefined, 'NO CANDIDATES', undefined],
    ]);
    const zp = wb.getWorksheet('ZP')?.getRow(2).values;
    expect(Array.isArray(zp) ? zp[10] : null).toBe('UNOPPOSED');
  });

  it('--ps limits the report to one Panchayat Samiti', async () => {
    const result = await runBallotReport(
      { ps: ALPHA, out: join(h.dir, 'alpha.xlsx') },
      makeCtx(h).ctx,
    );
    expect(result.sheets).toEqual(['ALPHA']);
  });
});
