import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  VOTER_TEMPLATE_HEADERS,
  runExportVoterTemplate,
} from '../../scripts/export-voter-template.js';
import { runImportVoters } from '../../scripts/import-voters.js';
import {
  ALPHA,
  BETA,
  addBoothEntry,
  auditCount,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  resetDb,
  seedGeography,
  writeXlsx,
} from './helpers.js';
import type { Harness, Value } from './helpers.js';

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
});

const HEADERS = [
  'panchayat_samiti',
  'booth_no',
  'voters_male',
  'voters_female',
  'voters_other',
  'voters_total',
];

/** All 5 fixture booths, valid. */
function voterRows(): Value[][] {
  return [
    [ALPHA, 1, 100, 90, 1, 191],
    [ALPHA, 2, 200, 180, null, 380],
    [ALPHA, 3, 50, 50, 0, 100],
    [BETA, 1, 10, 20, 0, 30],
    [BETA, 2, 300, 310, 2, 612],
  ];
}

const run = async (rows: Value[][], commit = true) => {
  const file = await writeXlsx(h, HEADERS, rows);
  const result = await runImportVoters({ file, commit }, makeCtx(h).ctx);
  return { result, text: await readFile(result.reportPath, 'utf8') };
};
const boothsWithVoters = () =>
  count(h, 'SELECT COUNT(*) AS n FROM booth WHERE registered_voters_total IS NOT NULL');

describe('import:voters', () => {
  it('imports counts for every booth (voters_other may be empty = 0)', async () => {
    const auditBefore = await auditCount(h);
    const { result } = await run(voterRows());
    expect(result.ok).toBe(true);
    const [rows] = await h.app.query<RowDataPacket[]>(
      `SELECT b.registered_voters_male AS m, b.registered_voters_female AS f, b.registered_voters_total AS t
         FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
        WHERE ps.name_english = ? AND b.booth_no = 2`,
      [ALPHA],
    );
    expect(rows).toEqual([{ m: 200, f: 180, t: 380 }]);
    expect(await boothsWithVoters()).toBe(5);
    expect(await auditCount(h)).toBe(auditBefore + 1);
  });

  it('a total that is not male + female + other fails and writes nothing', async () => {
    const rows = voterRows();
    rows[0] = [ALPHA, 1, 100, 90, 1, 190];
    const auditBefore = await auditCount(h);
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain(
      '[row 2] voters_total 190 does not equal male 100 + female 90 + other 1 = 191',
    );
    expect(await boothsWithVoters()).toBe(0);
    expect(await auditCount(h)).toBe(auditBefore);
  });

  it('an unknown booth fails', async () => {
    const { result, text } = await run([...voterRows(), [BETA, 9, 1, 1, 0, 2]]);
    expect(result.ok).toBe(false);
    expect(text).toContain(`[row 7] Unknown booth: ${BETA} has no booth 9`);
  });

  it('a missing booth fails', async () => {
    const { result, text } = await run(voterRows().slice(1));
    expect(result.ok).toBe(false);
    expect(text).toContain(`Missing booth: booth 1 of ${ALPHA} is not in the file`);
  });

  it('a booth listed twice fails', async () => {
    const rows = voterRows();
    const { result, text } = await run([...rows, rows[0] ?? []]);
    expect(result.ok).toBe(false);
    expect(text).toContain('[rows 2, 7] The same booth appears more than once');
  });

  it('negative or non-integer counts fail', async () => {
    const rows = voterRows();
    rows[0] = [ALPHA, 1, -5, 90, 0, 85];
    rows[1] = [ALPHA, 2, 'abc', 180, 0, 380];
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain('[row 2] "voters_male" must be a whole number (0 or more), got "-5"');
    expect(text).toContain('[row 3] "voters_male" must be a whole number (0 or more), got "abc"');
  });

  it('is refused for a booth that already has a counting entry', async () => {
    await addBoothEntry(h, 'PS');
    const { result, text } = await run(voterRows());
    expect(result.ok).toBe(false);
    expect(text).toContain(`Booth 1 of ${ALPHA} already has counting entries`);
    expect(await boothsWithVoters()).toBe(0);
  });

  it('export:voter-template writes one row per booth with empty count columns', async () => {
    const out = join(h.dir, 'voter-template.xlsx');
    const result = await runExportVoterTemplate({ out }, makeCtx(h).ctx);
    expect(result).toMatchObject({ ok: true, booths: 5 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const sheet = wb.worksheets[0];
    expect(sheet?.getRow(1).values).toEqual([undefined, ...VOTER_TEMPLATE_HEADERS]);
    expect(sheet?.rowCount).toBe(6);
    expect(sheet?.getRow(2).values).toEqual([undefined, ALPHA, 1, 'विद्यालय 1', 1, 1]);
  });
});
