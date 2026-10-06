import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runImportGeography } from '../../scripts/import-geography.js';
import {
  ALPHA,
  BETA,
  GEO_HEADERS,
  auditCount,
  closeHarness,
  count,
  createHarness,
  geoRow,
  geoRows,
  makeCtx,
  resetDb,
  seedCandidates,
  seedGeography,
  seedParties,
  writeJson,
  writeXlsx,
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
});

const geoTableCounts = async () => ({
  ps: await count(h, 'SELECT COUNT(*) AS n FROM panchayat_samiti'),
  wards: await count(h, 'SELECT COUNT(*) AS n FROM ward'),
  booths: await count(h, 'SELECT COUNT(*) AS n FROM booth'),
});

/** ALPHA booth 1 rows disagree on the ZP ward (1 vs 2), like Rajgarh booth 69. */
function conflictRows() {
  const rows = geoRows();
  rows[1] = geoRow(ALPHA, 1, 1, 2, 2);
  return rows;
}

const validFix = {
  panchayat_samiti: ALPHA,
  booth_no: 1,
  field: 'zp_ward_no',
  value: 1,
  reason: 'RO letter confirms ZP ward 1',
  approved_by: 'Test Officer',
  approved_on: '2026-10-01',
};

describe('import:geography', () => {
  it('imports a valid file with the correct counts and one audit row', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.counts).toEqual({ panchayatSamitis: 2, psWards: 3, zpWards: 2, booths: 5 });
    expect(await geoTableCounts()).toEqual({ ps: 2, wards: 5, booths: 5 });

    // BETA booth 2 -> BETA PS ward 1 and ZP ward 2 (ZP ward 1 spans both PS).
    const [rows] = await h.app.query<RowDataPacket[]>(
      `SELECT pw.ward_no AS ps_ward, zw.ward_no AS zp_ward, b.name_hindi FROM booth b
         JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
         JOIN ward pw ON pw.id = b.ps_ward_id JOIN ward zw ON zw.id = b.zp_ward_id
        WHERE ps.name_english = ? AND b.booth_no = 2`,
      [BETA],
    );
    expect(rows).toEqual([{ ps_ward: 1, zp_ward: 2, name_hindi: 'विद्यालय 2' }]);

    const [audit] = await h.app.query<RowDataPacket[]>(
      'SELECT action, user_id, new_value FROM audit_log',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'IMPORT_GEOGRAPHY', user_id: null });
    expect(audit[0]?.new_value).toMatchObject({
      counts: { booths: 5 },
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
  });

  it('a booth with conflicting ZP wards fails, lists its rows, and writes nothing', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, conflictRows());
    const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(result.conflicts).toBe(1);
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toContain(
      `[rows 2, 3] Booth 1 of ${ALPHA} has conflicting ZP ward numbers: 1 (row 2), 2 (row 3)`,
    );
    expect(text).toContain('NOTHING was written');
    expect(await geoTableCounts()).toEqual({ ps: 0, wards: 0, booths: 0 });
    expect(await auditCount(h)).toBe(0);
  });

  it('a valid approved fix resolves the conflict and is recorded', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, conflictRows());
    const fixes = await writeJson(h, [validFix]);
    const result = await runImportGeography({ file, fixes, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    const [rows] = await h.app.query<RowDataPacket[]>(
      `SELECT zw.ward_no AS zp_ward FROM booth b JOIN ward zw ON zw.id = b.zp_ward_id
         JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id WHERE ps.name_english = ? AND b.booth_no = 1`,
      [ALPHA],
    );
    expect(rows).toEqual([{ zp_ward: 1 }]);
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toContain(
      'reason: RO letter confirms ZP ward 1; approved by Test Officer on 2026-10-01',
    );
    const [audit] = await h.app.query<RowDataPacket[]>('SELECT new_value FROM audit_log');
    expect(audit[0]?.new_value).toMatchObject({
      fixes_applied: [
        { booth_no: 1, field: 'zp_ward_no', from: [1, 2], to: 1, approved_by: 'Test Officer' },
      ],
    });
  });

  it.each(['reason', 'approved_by', 'approved_on'])(
    'a fix without %s fails the import',
    async (key) => {
      const file = await writeXlsx(h, GEO_HEADERS, conflictRows());
      const fix = Object.fromEntries(Object.entries(validFix).filter(([k]) => k !== key));
      const fixes = await writeJson(h, [fix]);
      const result = await runImportGeography({ file, fixes, commit: true }, makeCtx(h).ctx);
      expect(result.ok).toBe(false);
      expect(await readFile(result.reportPath, 'utf8')).toContain(`missing or empty ${key}`);
      expect(await geoTableCounts()).toEqual({ ps: 0, wards: 0, booths: 0 });
    },
  );

  it('a fix for a booth that is not in the file fails', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const fixes = await writeJson(h, [{ ...validFix, booth_no: 99 }]);
    const result = await runImportGeography({ file, fixes, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('booth 99');
  });

  it('a dry run validates but writes nothing', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const result = await runImportGeography({ file }, makeCtx(h).ctx);
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(await readFile(result.reportPath, 'utf8')).toContain('DRY RUN OK. Nothing was written');
    expect(await geoTableCounts()).toEqual({ ps: 0, wards: 0, booths: 0 });
    expect(await auditCount(h)).toBe(0);
  });

  it('refuses to import again without --replace', async () => {
    await seedGeography(h);
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('Use --replace');
  });

  it('--replace re-creates wards and booths, keeps PS rows, and warns about voter counts', async () => {
    await seedGeography(h);
    const [before] = await h.app.query<RowDataPacket[]>(
      'SELECT id, name_english FROM panchayat_samiti ORDER BY id',
    );
    const rows = geoRows();
    rows.push(geoRow(BETA, 3, 2, 2));
    const file = await writeXlsx(h, GEO_HEADERS, rows);
    const result = await runImportGeography({ file, replace: true, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    expect(await geoTableCounts()).toEqual({ ps: 2, wards: 6, booths: 6 });
    const [after] = await h.app.query<RowDataPacket[]>(
      'SELECT id, name_english FROM panchayat_samiti ORDER BY id',
    );
    expect(after).toEqual(before);
    expect(await readFile(result.reportPath, 'utf8')).toContain('MUST be imported again');
  });

  it('--replace is refused once candidates exist', async () => {
    await seedGeography(h);
    await seedParties(h);
    await seedCandidates(h);
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const result = await runImportGeography({ file, replace: true, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain('--replace refused');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM candidate')).toBeGreaterThan(0);
  });

  it('a missing header fails clearly and names the column', async () => {
    const headers = GEO_HEADERS.filter((c) => c !== 'ZillaParishadConstituencyNumber');
    const file = await writeXlsx(
      h,
      headers,
      geoRows().map((r) => r.slice(0, 8)),
    );
    const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await readFile(result.reportPath, 'utf8')).toContain(
      'sheet "Sheet1" is missing column(s): ZillaParishadConstituencyNumber',
    );
  });

  it('columns are matched by name, not position', async () => {
    const order = [...GEO_HEADERS].reverse();
    const rows = geoRows().map((r) => [...r].reverse());
    const file = await writeXlsx(h, order, rows);
    const result = await runImportGeography({ file }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    expect(result.counts?.booths).toBe(5);
  });

  it('rejects empty cells, non-positive numbers and other districts with row numbers', async () => {
    const rows = geoRows();
    rows[0] = ['CHURU', ALPHA, 'Gram', 1, 0, 'x', 'x', 1, 1];
    rows[2] = ['JAIPUR', ALPHA, 'Gram', 1, 2, null, 'x', 1, 1];
    const file = await writeXlsx(h, GEO_HEADERS, rows);
    const text = await readFile(
      (await runImportGeography({ file }, makeCtx(h).ctx)).reportPath,
      'utf8',
    );
    expect(text).toContain(
      '[row 2] "PollingStationNumber" must be a whole number greater than 0, got "0"',
    );
    expect(text).toContain('[row 4] "Polling Station in Hindi" is empty');
    expect(text).toContain('[row 4] District must be Churu, got "JAIPUR"');
  });

  it('stores Hindi PS names from --ps-names and warns for missing ones', async () => {
    const file = await writeXlsx(h, GEO_HEADERS, geoRows());
    const psNames = await writeJson(h, { [ALPHA]: '  अल्फा  ', [BETA]: '' });
    const result = await runImportGeography({ file, psNames, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true);
    const [rows] = await h.app.query<RowDataPacket[]>(
      'SELECT name_english, name_hindi FROM panchayat_samiti ORDER BY name_english',
    );
    expect(rows).toEqual([
      { name_english: ALPHA, name_hindi: 'अल्फा' },
      { name_english: BETA, name_hindi: BETA },
    ]);
    expect(await readFile(result.reportPath, 'utf8')).toContain(`No Hindi name for "${BETA}"`);
  });

  it('normalises Unicode (NFC) and spaces so the same name is always identical', async () => {
    const rows = geoRows();
    const decomposed = 'विद्यालय 1'.normalize('NFD');
    rows[0] = ['CHURU', `  ${ALPHA}  `, 'Gram', 1, 1, `  ${decomposed}  `, 'School   1', 1, 1];
    const file = await writeXlsx(h, GEO_HEADERS, rows);
    const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(true); // rows 2 and 3 of booth 1 agree after normalisation
    const [stored] = await h.app.query<RowDataPacket[]>(
      `SELECT ps.name_english, b.name_hindi, b.name_english AS booth_en FROM booth b
         JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id WHERE b.booth_no = 1 AND ps.name_english = ?`,
      [ALPHA],
    );
    // Compared in JavaScript (byte-exact), not with the case/accent-insensitive DB collation.
    expect(stored).toEqual([
      { name_english: ALPHA, name_hindi: 'विद्यालय 1'.normalize('NFC'), booth_en: 'School 1' },
    ]);
  });
});

describe('import:geography on the real docs/polling-stations.xlsx (dry run)', () => {
  it('derives 13 PS / 231 PS wards / 39 ZP wards / 1,359 booths and reports Rajgarh booth 69', async () => {
    const file = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'polling-stations.xlsx');
    const result = await runImportGeography({ file }, makeCtx(h).ctx);
    expect(result.counts).toEqual({
      panchayatSamitis: 13,
      psWards: 231,
      zpWards: 39,
      booths: 1359,
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toBe(1);
    const text = await readFile(result.reportPath, 'utf8');
    expect(text).toMatch(
      /Booth 69 of RAJGARH PANCHAYAT SAMITI has conflicting ZP ward numbers: 23 \(rows [\d, ]+\), 30 \(row \d+\)/,
    );
    expect(await geoTableCounts()).toEqual({ ps: 0, wards: 0, booths: 0 });
  });
});
