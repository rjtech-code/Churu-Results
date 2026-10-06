import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NOTA_NAME_HINDI, runImportCandidates } from '../../scripts/import-candidates.js';
import {
  ALPHA,
  CANDIDATE_HEADERS,
  addBoothEntry,
  auditCount,
  candidateRows,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  resetDb,
  seedGeography,
  seedParties,
  wardId,
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
  await seedParties(h);
});

const run = async (rows: Value[][], commit = true) => {
  const file = await writeXlsx(h, CANDIDATE_HEADERS, rows);
  const result = await runImportCandidates({ file, commit }, makeCtx(h).ctx);
  return { result, text: await readFile(result.reportPath, 'utf8') };
};
const candidates = () => count(h, 'SELECT COUNT(*) AS n FROM candidate');

async function ballot(id: number) {
  const [rows] = await h.app.query<RowDataPacket[]>(
    `SELECT c.ballot_position AS pos, c.name_hindi AS name, p.short_name AS party, c.gender, c.is_nota AS nota
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id WHERE c.ward_id = ? ORDER BY c.ballot_position`,
    [id],
  );
  return rows;
}

/** Any failing run must leave the DB exactly as before. */
async function expectNothingWritten() {
  expect(await candidates()).toBe(0);
  expect(await auditCount(h)).toBe(1 + 1); // the two seed imports only
}

describe('import:candidates', () => {
  it('imports candidates and auto-adds NOTA at N+1', async () => {
    const { result, text } = await run(candidateRows());
    expect(result.ok).toBe(true);
    const alpha1 = await wardId(h, 'PS', 1);
    expect(await ballot(alpha1)).toEqual([
      { pos: 1, name: 'राम', party: 'P1', gender: 'M', nota: 0 },
      { pos: 2, name: 'सीता', party: null, gender: 'F', nota: 0 },
      { pos: 3, name: NOTA_NAME_HINDI, party: null, gender: null, nota: 1 },
    ]);
    const [ward] = await h.app.query<RowDataPacket[]>(
      'SELECT is_unopposed, reservation_category FROM ward WHERE id = ?',
      [alpha1],
    );
    expect(ward).toEqual([{ is_unopposed: 0, reservation_category: 'सामान्य' }]);
    expect(text).toContain('Wards loaded for the first time (2)');
  });

  it('a single-candidate ward becomes unopposed with no NOTA, and is listed', async () => {
    const { result, text } = await run(candidateRows());
    expect(result.unopposedWards).toEqual([`ZP ward 1 (ward id ${await wardId(h, 'ZP', 1)})`]);
    const zp1 = await wardId(h, 'ZP', 1);
    expect(await ballot(zp1)).toEqual([
      { pos: 1, name: 'गीता', party: 'P2', gender: 'F', nota: 0 },
    ]);
    const [ward] = await h.app.query<RowDataPacket[]>(
      'SELECT is_unopposed FROM ward WHERE id = ?',
      [zp1],
    );
    expect(ward).toEqual([{ is_unopposed: 1 }]);
    expect(text).toContain('UNOPPOSED wards — exactly one candidate, no NOTA (1)');
  });

  it('a duplicate ballot position fails', async () => {
    const rows = candidateRows();
    rows[1] = [ALPHA, 'PS', 1, 1, 'सीता', null, 'F', 'सामान्य'];
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain('[rows 2, 3] PS ward 1 of ALPHA PANCHAYAT SAMITI');
    expect(text).toContain('ballot_position 1 is used more than once');
    await expectNothingWritten();
  });

  it('a gap in ballot positions fails', async () => {
    const rows = candidateRows();
    rows[1] = [ALPHA, 'PS', 1, 3, 'सीता', null, 'F', 'सामान्य'];
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain('ballot positions must be 1..2 with no gaps; found 1, 3');
    await expectNothingWritten();
  });

  it('an unknown ward fails', async () => {
    const { result, text } = await run([
      ...candidateRows(),
      [ALPHA, 'PS', 7, 1, 'मोहन', null, 'M', null],
    ]);
    expect(result.ok).toBe(false);
    expect(text).toContain(`[row 5] ${ALPHA} has no PS ward 7`);
    await expectNothingWritten();
  });

  it('an unknown ZP ward and an unknown Panchayat Samiti fail', async () => {
    const { result, text } = await run([
      [null, 'ZP', 9, 1, 'मोहन', null, 'M', null],
      ['NOWHERE PANCHAYAT SAMITI', 'PS', 1, 1, 'सोहन', null, 'M', null],
    ]);
    expect(result.ok).toBe(false);
    expect(text).toContain('[row 2] ZP ward 9 does not exist');
    expect(text).toContain('[row 3] Unknown Panchayat Samiti "NOWHERE PANCHAYAT SAMITI"');
  });

  it('an unknown party fails', async () => {
    const rows = candidateRows();
    rows[0] = [ALPHA, 'PS', 1, 1, 'राम', 'XYZ', 'M', 'सामान्य'];
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain('[row 2] Unknown party short name "XYZ"');
    await expectNothingWritten();
  });

  it('two candidates of one party in a ward fail (independents are exempt)', async () => {
    const rows = candidateRows();
    rows[1] = [ALPHA, 'PS', 1, 2, 'सीता', 'p1', 'F', 'सामान्य'];
    rows.push([ALPHA, 'PS', 2, 1, 'क', null, 'M', null], [ALPHA, 'PS', 2, 2, 'ख', null, 'M', null]);
    const { result, text } = await run(rows);
    expect(result.ok).toBe(false);
    expect(text).toContain('[rows 2, 3] PS ward 1 of ALPHA PANCHAYAT SAMITI');
    expect(text).toContain('party "P1" has more than one candidate');
    expect(text).not.toMatch(/ERROR .*PS ward 2 of ALPHA/);
    await expectNothingWritten();
  });

  it('invalid gender, empty name and a reservation category that differs within a ward fail', async () => {
    const { result, text } = await run([
      [ALPHA, 'PS', 1, 1, 'राम', null, 'X', 'सामान्य'],
      [ALPHA, 'PS', 1, 2, null, null, 'F', 'सामान्य'],
      [ALPHA, 'PS', 2, 1, 'क', null, 'm', 'सामान्य'],
      [ALPHA, 'PS', 2, 2, 'ख', null, 'f', 'महिला'],
    ]);
    expect(result.ok).toBe(false);
    expect(text).toContain('[row 2] "gender" must be M, F or O, got "X"');
    expect(text).toContain('[row 3] "name_hindi" is empty');
    expect(text).toContain('reservation_category must be the same on every row of the ward');
  });

  it('a row containing EXAMPLE is rejected', async () => {
    const { result, text } = await run([
      ...candidateRows(),
      ['EXAMPLE - X', 'PS', 2, 1, 'नाम', null, 'M', null],
    ]);
    expect(result.ok).toBe(false);
    expect(text).toContain('[row 5] This row is a template EXAMPLE row');
    await expectNothingWritten();
  });

  it('a locked ward is refused', async () => {
    await h.app.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Tester' WHERE id = ?",
      [await wardId(h, 'PS', 1)],
    );
    const { result, text } = await run(candidateRows());
    expect(result.ok).toBe(false);
    expect(text).toContain('the ballot is LOCKED');
    await expectNothingWritten();
  });

  it('re-import replaces only the wards in the file, and says which', async () => {
    await run(candidateRows());
    const { result, text } = await run([
      [ALPHA, 'PS', 1, 1, 'नया उम्मीदवार', 'P2', 'O', null],
      [ALPHA, 'PS', 1, 2, 'दूसरा', null, 'M', null],
      [ALPHA, 'PS', 1, 3, 'तीसरा', null, 'F', null],
    ]);
    expect(result.ok).toBe(true);
    const alpha1 = await wardId(h, 'PS', 1);
    expect(result.replacedWards).toEqual([`PS ward 1 of ${ALPHA} (ward id ${alpha1})`]);
    expect(text).toContain('Wards whose candidates are REPLACED (1)');
    expect((await ballot(alpha1)).map((c) => String(c.name))).toEqual([
      'नया उम्मीदवार',
      'दूसरा',
      'तीसरा',
      NOTA_NAME_HINDI,
    ]);
    expect(await ballot(await wardId(h, 'ZP', 1))).toHaveLength(1); // untouched
    expect(text).toContain('keeps 1 existing candidate(s)');
  });

  it('a ward with counting entries is refused on re-import', async () => {
    await run(candidateRows());
    await addBoothEntry(h, 'PS');
    const { result, text } = await run(candidateRows());
    expect(result.ok).toBe(false);
    expect(text).toContain('counting entries already exist');
  });

  it('ZP rows with a panchayat_samiti give a warning but still import; empty wards warn', async () => {
    const rows = candidateRows();
    rows[2] = [ALPHA, 'ZP', 1, 1, 'गीता', 'P2', 'F', 'महिला'];
    const { result, text } = await run(rows);
    expect(result.ok).toBe(true);
    expect(text).toContain('[row 4] "panchayat_samiti" is ignored for ZP rows');
    expect(text).toMatch(/WARNING \d+ ward\(s\) have no candidates at all yet/);
  });

  it('a dry run writes nothing', async () => {
    const { result, text } = await run(candidateRows(), false);
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(text).toContain('DRY RUN OK');
    await expectNothingWritten();
  });
});
