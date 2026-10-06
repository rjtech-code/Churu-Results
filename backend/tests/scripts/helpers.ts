import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { runImportCandidates } from '../../scripts/import-candidates.js';
import { runImportGeography } from '../../scripts/import-geography.js';
import { runImportParties } from '../../scripts/import-parties.js';
import type { ScriptContext } from '../../scripts/lib/run.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

export type Value = string | number | null;

/** Pools + a temp working dir shared by one test file. */
export interface Harness {
  app: Pool;
  migrator: Pool;
  dir: string;
}

export async function createHarness(): Promise<Harness> {
  return {
    app: createTestAppPool(),
    migrator: createTestMigrationPool(),
    dir: await mkdtemp(join(tmpdir(), 'churu-scripts-')),
  };
}

export async function closeHarness(h: Harness): Promise<void> {
  await h.app.end();
  await h.migrator.end();
}

export async function resetDb(h: Harness): Promise<void> {
  await resetData(h.migrator);
}

/** A script context that captures terminal output and answers prompts with `answer`. */
export function makeCtx(h: Harness, answer = ''): { ctx: ScriptContext; output: string[] } {
  const output: string[] = [];
  const ctx: ScriptContext = {
    pool: h.app,
    reportsDir: join(h.dir, 'reports'),
    out: (text) => output.push(text),
    confirm: (question) => {
      output.push(question);
      return Promise.resolve(answer);
    },
    now: () => new Date(),
  };
  return { ctx, output };
}

let fileCounter = 0;

/** Writes a fixture .xlsx (generated in the test, never real data). */
export async function writeXlsx(
  h: Harness,
  headers: readonly string[],
  rows: readonly (readonly Value[])[],
  sheetName = 'Sheet1',
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  for (const row of rows) sheet.addRow([...row]);
  const file = join(h.dir, `fixture-${++fileCounter}.xlsx`);
  await workbook.xlsx.writeFile(file);
  return file;
}

export async function writeJson(h: Harness, data: unknown): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  const file = join(h.dir, `fixture-${++fileCounter}.json`);
  await writeFile(file, JSON.stringify(data), 'utf8');
  return file;
}

// ---------------------------------------------------------------- geography fixture

export const GEO_HEADERS = [
  'District',
  'PanchayatSamiti',
  'Grampanchayat',
  'WardNumber',
  'PollingStationNumber',
  'Polling Station in Hindi',
  'Polling Station in English',
  'PanchayatSamitiConstituenyNumber',
  'ZillaParishadConstituencyNumber',
] as const;

export const ALPHA = 'ALPHA PANCHAYAT SAMITI';
export const BETA = 'BETA PANCHAYAT SAMITI';

export function geoRow(
  ps: string,
  boothNo: number,
  psWard: number,
  zpWard: number,
  gpWard = 1,
): Value[] {
  return [
    'CHURU',
    ps,
    'Gram',
    gpWard,
    boothNo,
    `विद्यालय ${boothNo}`,
    `School ${boothNo}`,
    psWard,
    zpWard,
  ];
}

/**
 * 2 PS, 3 PS wards (ALPHA 1, ALPHA 2, BETA 1), 2 ZP wards (ZP 1 spans both PS), 5 booths.
 * ALPHA booth 1 has two GP-ward rows.
 */
export function geoRows(): Value[][] {
  return [
    geoRow(ALPHA, 1, 1, 1, 1),
    geoRow(ALPHA, 1, 1, 1, 2),
    geoRow(ALPHA, 2, 1, 1),
    geoRow(ALPHA, 3, 2, 2),
    geoRow(BETA, 1, 1, 1),
    geoRow(BETA, 2, 1, 2),
  ];
}

export async function seedGeography(h: Harness): Promise<void> {
  const file = await writeXlsx(h, GEO_HEADERS, geoRows());
  const result = await runImportGeography({ file, commit: true }, makeCtx(h).ctx);
  if (!result.ok) throw new Error('fixture geography import failed');
}

export const PARTY_HEADERS = ['name_hindi', 'name_english', 'short_name', 'symbol'] as const;

export async function seedParties(h: Harness): Promise<void> {
  const file = await writeXlsx(h, PARTY_HEADERS, [
    ['पार्टी एक', 'Party One', 'P1', 'कमल'],
    ['पार्टी दो', 'Party Two', 'P2', 'हाथ'],
  ]);
  const result = await runImportParties({ file, commit: true }, makeCtx(h).ctx);
  if (!result.ok) throw new Error('fixture party import failed');
}

export const CANDIDATE_HEADERS = [
  'panchayat_samiti',
  'election',
  'ward_no',
  'ballot_position',
  'name_hindi',
  'party_short_name',
  'gender',
  'reservation_category',
] as const;

/** ALPHA PS ward 1: two candidates; ZP ward 1: one candidate (unopposed). */
export function candidateRows(): Value[][] {
  return [
    [ALPHA, 'PS', 1, 1, 'राम', 'P1', 'M', 'सामान्य'],
    [ALPHA, 'PS', 1, 2, 'सीता', null, 'F', 'सामान्य'],
    [null, 'ZP', 1, 1, 'गीता', 'P2', 'F', 'महिला'],
  ];
}

export async function seedCandidates(h: Harness, rows = candidateRows()): Promise<void> {
  const file = await writeXlsx(h, CANDIDATE_HEADERS, rows);
  const result = await runImportCandidates({ file, commit: true }, makeCtx(h).ctx);
  if (!result.ok) throw new Error('fixture candidate import failed');
}

// ---------------------------------------------------------------- DB helpers

export async function count(
  h: Harness,
  sql: string,
  params: (string | number)[] = [],
): Promise<number> {
  const [rows] = await h.app.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export const auditCount = (h: Harness): Promise<number> =>
  count(h, 'SELECT COUNT(*) AS n FROM audit_log');

export async function wardId(
  h: Harness,
  type: 'PS' | 'ZP',
  wardNo: number,
  psName?: string,
): Promise<number> {
  const [rows] = await h.app.execute<RowDataPacket[]>(
    type === 'PS'
      ? `SELECT w.id FROM ward w JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id
          WHERE w.ward_type = 'PS' AND ps.name_english = ? AND w.ward_no = ?`
      : "SELECT id FROM ward WHERE ward_type = 'ZP' AND ward_no = ?",
    type === 'PS' ? [psName ?? ALPHA, wardNo] : [wardNo],
  );
  const id: unknown = rows[0]?.id;
  if (typeof id !== 'number') throw new Error('ward not found');
  return id;
}

/** Inserts a booth entry for ALPHA booth 1 directly (counting itself is a later part). */
export async function addBoothEntry(h: Harness, ballotFor: 'PS' | 'ZP'): Promise<void> {
  const [ps] = await h.app.execute<RowDataPacket[]>(
    'SELECT id FROM panchayat_samiti WHERE name_english = ?',
    [ALPHA],
  );
  const psId = Number(ps[0]?.id);
  const userId = await insert(
    h.app,
    "INSERT INTO users (username, full_name, password_hash, role, panchayat_samiti_id) VALUES (?, 'Test RO', 'x', 'PS_RO', ?)",
    [`ro_fixture_${ballotFor.toLowerCase()}`, psId],
  );
  const [booth] = await h.app.execute<RowDataPacket[]>(
    'SELECT id, ps_ward_id, zp_ward_id FROM booth WHERE panchayat_samiti_id = ? AND booth_no = 1',
    [psId],
  );
  const b = booth[0];
  await insert(
    h.app,
    'INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, ?, ?, 1, 0, ?)',
    [Number(b?.id), ballotFor, Number(ballotFor === 'PS' ? b?.ps_ward_id : b?.zp_ward_id), userId],
  );
}

export async function reportFiles(h: Harness): Promise<string[]> {
  const dir = join(h.dir, 'reports');
  try {
    const names = await readdir(dir);
    return await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
  } catch {
    return [];
  }
}
