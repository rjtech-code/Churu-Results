import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  VOTER_TEMPLATE_HEADERS,
  runExportVoterTemplate,
} from '../../scripts/export-voter-template.js';
import {
  EXPECTED_BOOTHS,
  EXPECTED_TOTAL_VOTERS,
  runImportVoters,
} from '../../scripts/import-voters.js';
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

// ---------------------------------------------------------------- Part 14: polling-station workbook

const STATION_HEADERS = [
  'District',
  'PanchayatSamiti',
  'WardNumber',
  'PollingStationNumber',
  'Total_Elector',
];

/** Several rows per booth (one per village part); 5 booths, 1,313 voters in all. */
function stationRows(): Value[][] {
  return [
    ['CHURU', ALPHA, 1, 1, 100],
    ['CHURU', ALPHA, 2, 1, 91], // booth ALPHA 1 = 191
    ['CHURU', ALPHA, 1, 2, 380],
    ['CHURU', ALPHA, 1, 3, 60],
    ['CHURU', ALPHA, 3, 3, 40], // booth ALPHA 3 = 100
    ['CHURU', BETA, 1, 1, 30],
    ['CHURU', BETA, 1, 2, 612],
  ];
}
const STATION_TOTAL = 1313;

let stationCounter = 0;
async function writeStationWorkbook(rows: Value[][], sheet3: (number | null)[] | null) {
  const workbook = new ExcelJS.Workbook();
  // A decoy first sheet with the same columns but no voters (as in the real file's "Sheet1").
  const decoy = workbook.addWorksheet('Sheet1');
  decoy.addRow(['PanchayatSamiti', 'PollingStationNumber']);
  decoy.addRow([ALPHA, 99]);
  const s = workbook.addWorksheet('Sheet1_withvoters');
  s.addRow(STATION_HEADERS);
  for (const r of rows) s.addRow(r);
  if (sheet3 !== null) {
    const s3 = workbook.addWorksheet('Sheet3');
    s3.addRow(['Polling Station in Hindi', 'ZillaParishadConstituencyNumber', 'Voters']);
    for (const n of sheet3) s3.addRow(['विद्यालय', 1, n]);
  }
  const file = join(h.dir, `stations-${++stationCounter}.xlsx`);
  await workbook.xlsx.writeFile(file);
  return file;
}

const runStations = async (
  rows: Value[][],
  opts: {
    commit?: boolean;
    sheet3?: (number | null)[] | null;
    booths?: number;
    total?: number;
  } = {},
) => {
  const file = await writeStationWorkbook(
    rows,
    opts.sheet3 === undefined ? [1000, STATION_TOTAL - 1000] : opts.sheet3,
  );
  const result = await runImportVoters(
    {
      file,
      commit: opts.commit ?? true,
      expectedBooths: opts.booths ?? 5,
      expectedTotalVoters: opts.total ?? STATION_TOTAL,
    },
    makeCtx(h).ctx,
  );
  return { result, text: await readFile(result.reportPath, 'utf8') };
};
const votersOf = async (ps: string, boothNo: number) => {
  const [rows] = await h.app.query<RowDataPacket[]>(
    `SELECT b.registered_voters_male AS m, b.registered_voters_female AS f, b.registered_voters_total AS t
       FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
      WHERE ps.name_english = ? AND b.booth_no = ?`,
    [ps, boothNo],
  );
  return rows[0];
};

describe('import:voters, polling-station workbook (Sheet1_withvoters)', () => {
  it('sums Total_Elector per (PanchayatSamiti, PollingStationNumber); male/female stay empty', async () => {
    const auditBefore = await auditCount(h);
    const { result, text } = await runStations(stationRows());
    expect(result.ok).toBe(true);
    expect(text).toContain('polling-station workbook');
    expect(await votersOf(ALPHA, 1)).toEqual({ m: null, f: null, t: 191 });
    expect(await votersOf(ALPHA, 3)).toEqual({ m: null, f: null, t: 100 });
    expect(await votersOf(BETA, 2)).toEqual({ m: null, f: null, t: 612 });
    expect(await boothsWithVoters()).toBe(5);
    expect(await auditCount(h)).toBe(auditBefore + 1);
  });

  it('is a dry run by default: checks pass but nothing is written', async () => {
    const auditBefore = await auditCount(h);
    const { result } = await runStations(stationRows(), { commit: false });
    expect(result.ok).toBe(true);
    expect(await boothsWithVoters()).toBe(0);
    expect(await auditCount(h)).toBe(auditBefore);
  });

  it('the Churu defaults are 1,359 booths and 1,248,368 voters', () => {
    expect([EXPECTED_BOOTHS, EXPECTED_TOTAL_VOTERS]).toEqual([1359, 1_248_368]);
  });

  it.each([
    ['wrong booth count', { booths: 1359 }, 'expected exactly 1359'],
    ['grand total not the expected total', { total: 1_248_368 }, 'is not the expected 1248368'],
    [
      'grand total not equal to SUM(Sheet3.Voters)',
      { sheet3: [1000, 1] },
      'does not equal SUM(Sheet3.Voters)',
    ],
    ['no Sheet3 to cross-check', { sheet3: null }, 'no sheet "Sheet3"'],
    ['a bad Sheet3 cell', { sheet3: [STATION_TOTAL, -1] }, 'Voters'],
  ])('%s -> fails, nothing written', async (_name, opts, message) => {
    const { result, text } = await runStations(stationRows(), opts);
    expect(result.ok).toBe(false);
    expect(text).toContain(message);
    expect(await boothsWithVoters()).toBe(0);
  });

  it('an unknown booth or PS, a missing booth, or a bad Total_Elector -> fails, nothing written', async () => {
    const cases: [Value[][], string][] = [
      [[...stationRows().slice(0, 6), ['CHURU', BETA, 1, 9, 612]], 'has no booth 9'],
      [[...stationRows().slice(0, 6), ['CHURU', 'NOWHERE', 1, 2, 612]], 'Unknown Panchayat Samiti'],
      [[...stationRows().slice(0, 6), ['CHURU', BETA, 1, 2, -5]], 'Total_Elector'],
    ];
    for (const [rows, message] of cases) {
      const { result, text } = await runStations(rows);
      expect(result.ok).toBe(false);
      expect(text).toContain(message);
    }
    // Missing booth: the count check is told 4, and the DB still has 5 booths.
    const { result, text } = await runStations(stationRows().slice(0, 6), {
      booths: 4,
      total: STATION_TOTAL - 612,
      sheet3: [STATION_TOTAL - 612],
    });
    expect(result.ok).toBe(false);
    expect(text).toContain('Missing booth: booth 2 of');
    expect(await boothsWithVoters()).toBe(0);
  });

  it('is refused for a booth that already has a counting entry', async () => {
    await addBoothEntry(h, 'ZP');
    const { result, text } = await runStations(stationRows());
    expect(result.ok).toBe(false);
    expect(text).toContain('already has counting entries');
  });
});
