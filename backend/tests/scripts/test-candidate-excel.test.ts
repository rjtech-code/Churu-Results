import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import ExcelJS from 'exceljs';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runImportCandidates } from '../../scripts/import-candidates.js';
import {
  BLANK_CATEGORY_COUNT,
  MAX_TEST_AGE,
  MIN_TEST_AGE,
  TEST_EXCEL_HEADERS,
  buildTestRows,
  runMakeTestCandidateExcel,
} from '../../scripts/make-test-candidate-excel.js';
import type { SourceCandidate } from '../../scripts/make-test-candidate-excel.js';
import { runResetCandidates } from '../../scripts/reset-candidates.js';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
} from '../../src/services/master-data/candidates.js';
import { EDUCATIONS, ageOn, parseDob } from '../../src/services/master-data/candidate-details.js';
import {
  ALPHA,
  BETA,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  resetDb,
  seedCandidates,
  seedGeography,
  seedParties,
} from './helpers.js';
import type { Harness, Value } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const GEN = 'सामान्य';
const SC_SEAT = 'अनुसूचित जाति';

/**
 * ALPHA 1: SC seat, 4 candidates. ALPHA 2 and BETA 1: unopposed general seats. ZP 1: general seat,
 * 5 candidates. ZP 2: unopposed OBC seat.
 */
function fixtureRows(): Value[][] {
  const name = (i: number) => `उम्मीदवार ${i}`;
  return [
    [ALPHA, 'PS', 1, 1, name(1), 'P1', 'M', SC_SEAT],
    [ALPHA, 'PS', 1, 2, name(2), 'P2', 'F', SC_SEAT],
    [ALPHA, 'PS', 1, 3, name(3), null, 'M', SC_SEAT],
    [ALPHA, 'PS', 1, 4, name(4), null, 'O', SC_SEAT],
    [ALPHA, 'PS', 2, 1, name(5), 'P1', 'F', GEN],
    [BETA, 'PS', 1, 1, name(6), null, 'M', GEN],
    [null, 'ZP', 1, 1, name(7), 'P1', 'M', GEN],
    [null, 'ZP', 1, 2, name(8), 'P2', 'F', GEN],
    [null, 'ZP', 1, 3, name(9), null, 'M', GEN],
    [null, 'ZP', 1, 4, name(10), null, 'F', GEN],
    [null, 'ZP', 1, 5, name(11), null, 'M', GEN],
    [null, 'ZP', 2, 1, name(12), 'P2', 'F', 'OBC'],
  ];
}

async function readXlsx(file: string): Promise<{ headers: string[]; rows: Value[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('no sheet');
  const all: Value[][] = [];
  sheet.eachRow((row) => {
    const values: Value[] = [];
    for (let c = 1; c <= TEST_EXCEL_HEADERS.length; c++) {
      const v = row.getCell(c).value;
      values.push(v === null || v === undefined ? null : (v as string | number));
    }
    all.push(values);
  });
  const [headers, ...rows] = all;
  return { headers: (headers ?? []).map(String), rows };
}

describe('test-candidate-excel (database)', () => {
  beforeEach(async () => {
    await resetDb(h);
    await seedGeography(h);
    await seedParties(h);
    await seedCandidates(h, fixtureRows());
  });

  it('writes the importer’s exact columns, imports with 0 errors, and survives a reset + re-import', async () => {
    const { ctx, output } = makeCtx(h);
    const auditBefore = await count(h, 'SELECT COUNT(*) AS n FROM audit_log');
    const result = await runMakeTestCandidateExcel(ctx);
    expect(result.ok, output.join('\n')).toBe(true);
    expect(output.join('\n')).toContain('Database: churu_test');
    expect(result.rows).toBe(12);
    const file = result.file ?? '';
    expect(basename(file)).toMatch(/^TEST-candidates-\d{8}-\d{6}-\d{3}\.xlsx$/);
    // Read-only: no audit row, candidates untouched.
    expect(await count(h, 'SELECT COUNT(*) AS n FROM audit_log')).toBe(auditBefore);

    const { headers, rows } = await readXlsx(file);
    expect(headers).toEqual([...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS]);
    const col = (r: Value[], name: (typeof TEST_EXCEL_HEADERS)[number]) =>
      r[TEST_EXCEL_HEADERS.indexOf(name)] ?? null;
    // Same lists, same order; the seat reservation copied exactly.
    expect(rows.map((r) => [col(r, 'name_hindi'), col(r, 'reservation_category')])).toEqual(
      // The fixture is already in export order: PS before ZP, PS name, ward, ballot position.
      fixtureRows().map((r) => [r[4], r[7]]),
    );
    // Blanks on the unopposed general seats first (ALPHA 2, BETA 1), then the next general seat.
    const blanks = rows.filter((r) => col(r, 'candidate_category') === null);
    expect(blanks.map((r) => col(r, 'name_hindi'))).toEqual([
      'उम्मीदवार 5',
      'उम्मीदवार 6',
      'उम्मीदवार 7',
    ]);
    // Reserved seats follow the seat.
    for (const r of rows) {
      if (col(r, 'reservation_category') === SC_SEAT)
        expect(col(r, 'candidate_category')).toBe('SC');
      if (col(r, 'reservation_category') === 'OBC')
        expect(col(r, 'candidate_category')).toBe('OBC');
    }
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toContain('Unopposed wards (exactly one row): 3');
    expect(text).toContain('PS ward 2 of ALPHA PANCHAYAT SAMITI');

    // The real importer accepts it (dry run).
    const dry = await runImportCandidates({ file, commit: false }, makeCtx(h).ctx);
    expect(dry.ok, await readFile(dry.reportPath, 'utf8')).toBe(true);

    // The rehearsal: reset, then import the file.
    const backup = join(h.dir, 'b.sql.gz');
    await writeFile(backup, 'x');
    const reset = await runResetCandidates(
      { nodeEnv: 'test', backupFile: backup, commit: true },
      makeCtx(h).ctx,
    );
    expect(reset.ok).toBe(true);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM candidate')).toBe(0);
    const imported = await runImportCandidates({ file, commit: true }, makeCtx(h).ctx);
    expect(imported.ok, await readFile(imported.reportPath, 'utf8')).toBe(true);

    expect(await count(h, 'SELECT COUNT(*) AS n FROM candidate WHERE is_nota = 0')).toBe(12);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM ward WHERE is_unopposed = 1')).toBe(3);
    expect(
      await count(
        h,
        'SELECT COUNT(*) AS n FROM candidate WHERE is_nota = 0 AND candidate_category IS NULL',
      ),
    ).toBe(BLANK_CATEGORY_COUNT);
    expect(
      await count(
        h,
        'SELECT COUNT(*) AS n FROM candidate WHERE is_nota = 0 AND (education IS NULL OR mobile IS NULL OR (dob IS NULL AND age_stated IS NULL))',
      ),
    ).toBe(0);
    const [res] = await h.app.query<RowDataPacket[]>(
      'SELECT DISTINCT reservation_category AS r FROM ward WHERE reservation_category IS NOT NULL',
    );
    expect(new Set(res.map((r) => String(r.r)))).toEqual(new Set(['OBC', SC_SEAT, GEN]));
  });

  it('refuses when there are no candidates', async () => {
    await resetDb(h);
    const result = await runMakeTestCandidateExcel(makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(result.file).toBeNull();
  });
});

describe('buildTestRows (pure)', () => {
  const general = (n: number): SourceCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      wardId: i + 1,
      wardType: 'PS',
      wardNo: i + 1,
      psName: ALPHA,
      reservation: i % 2 === 0 ? GEN : 'UR (W)',
      isUnopposed: i % 10 === 0,
      position: 1,
      nameHindi: `नाम ${i}`,
      partyShort: null,
      gender: 'M',
    }));

  it('spreads the fake details as asked, and is deterministic', () => {
    const cands = general(1000);
    const { rows, blankRows } = buildTestRows(cands);
    expect(buildTestRows(cands).rows).toEqual(rows);

    const withDob = rows.filter((r) => r.dob !== null);
    expect(withDob.length / rows.length).toBeGreaterThan(0.65);
    expect(withDob.length / rows.length).toBeLessThan(0.75);
    for (const r of rows) {
      expect((r.dob === null) !== (r.age === null)).toBe(true);
      const iso = r.dob === null ? null : parseDob(String(r.dob));
      if (r.dob !== null) expect(iso).not.toBeNull();
      const age = iso !== null ? ageOn(iso) : Number(r.age);
      expect(age).toBeGreaterThanOrEqual(MIN_TEST_AGE);
      expect(age).toBeLessThanOrEqual(MAX_TEST_AGE);
      expect(String(r.mobile)).toMatch(/^90000\d{5}$/);
    }
    expect(new Set(rows.map((r) => r.education))).toEqual(new Set(EDUCATIONS));

    expect(blankRows).toHaveLength(BLANK_CATEGORY_COUNT);
    expect(blankRows.every((i) => cands[i]?.isUnopposed)).toBe(true);
    const cats = rows.map((r) => r.candidate_category);
    expect(cats.filter((c) => c === null)).toHaveLength(BLANK_CATEGORY_COUNT);
    const gen = cats.filter((c) => c === 'GEN').length / rows.length;
    expect(gen).toBeGreaterThan(0.72);
    expect(gen).toBeLessThan(0.88);
    expect(cats).toContain('SC');
    expect(cats).toContain('OBC');
    expect(cats).not.toContain('ST');
  });
});
