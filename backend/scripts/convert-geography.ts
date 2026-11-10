// npm run convert:geography -- --file <raw xlsx> --out-dir <folder>
//
// FILE ONLY (never opens the database). Turns the official polling-station Excel (Hindi district and
// PS names, Gram Panchayat ward lists such as "1,2,3", booth numbers such as "15A") into the format
// import:geography reads, without changing the importer:
//   Geography_CLEAN_import-format.xlsx   District = Churu, PS = the system's English name,
//                                        WardNumber = the first number of the list (the importer only
//                                        checks it is a number; it is never stored). All booths, "A"
//                                        booths (e.g. "15A") included: the database has booth_suffix.
// Any PS name not in PS_HINDI_TO_ENGLISH, a row without a number in WardNumber, or a booth number
// that is not like 12 / 12A stops the run.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { COLUMNS, DISTRICT } from '../src/services/setup/geography.js';
import { boothLabel, parseBoothNo } from '../src/services/booth-no.js';
import { normalizeText } from '../src/services/master-data/text.js';
import { readSheet, writeSheet } from '../src/services/master-data/xlsx.js';
import type { Cell, SheetRow } from '../src/services/master-data/xlsx.js';
import { isMainModule, parseCli } from './lib/cli.js';
import { resolveUserPath } from './lib/paths.js';

const USAGE = 'npm run convert:geography -- --file <raw xlsx> --out-dir <folder>';

export const CLEAN_FILE = 'Geography_CLEAN_import-format.xlsx';

/** PS names as the official file writes them -> the system's English PS names. */
export const PS_HINDI_TO_ENGLISH: Readonly<Record<string, string>> = {
  चूरू: 'CHURU PANCHAYAT SAMITI',
  'चूरू उत्तर': 'CHURU NORTH HQ CHURU PANCHAYAT SAMITI',
  सरदारशहर: 'SARDARSHAHAR PANCHAYAT SAMITI',
  'सरदारशहर पूर्व': 'SARDARSHAHAR EAST PANCHAYAT SAMITI',
  तारानगर: 'TARANAGAR EAST PANCHAYAT SAMITI',
  'तारानगर पश्चिम (भालेरी)मुख्यालय तारानगर':
    'TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI',
  रतनगढ़: 'RATANGARH PANCHAYAT SAMITI',
  सुजानगढ़: 'SUJANGARH PANCHAYAT SAMITI',
  बीदासर: 'BIDASAR PANCHAYAT SAMITI',
  भानीपुरा: 'BHANIPURA PANCHAYAT SAMITI',
  'राजगढ़ (चूरू)': 'RAJGARH PANCHAYAT SAMITI',
  चांदगोठी: 'CHANDGOTHI HQ RAJGARH PANCHAYAT SAMITI',
  सिद्धमुख: 'SIDDHMUKH PANCHAYAT SAMITI',
};
const PS_BY_KEY = new Map(
  Object.entries(PS_HINDI_TO_ENGLISH).map(([hindi, english]) => [normalizeText(hindi), english]),
);

export interface ConvertResult {
  clean: Cell[][];
  errors: string[];
}

/** "1,2,3" -> 1, "वार्ड सं. 4 से 5" -> 4, 7 -> 7; null when the cell has no number. */
export function firstNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isSafeInteger(cell) && cell >= 1 ? cell : null;
  const match = cell === null ? null : /\d+/u.exec(cell);
  return match ? Number(match[0]) : null;
}

export function convertGeographyRows(rows: readonly SheetRow[]): ConvertResult {
  const result: ConvertResult = { clean: [], errors: [] };
  for (const row of rows) {
    const c = row.cells;
    const at = `row ${String(row.rowNumber)}`;
    const rawPs = c[COLUMNS.ps] ?? null;
    const ps = rawPs === null ? undefined : PS_BY_KEY.get(normalizeText(String(rawPs)));
    if (ps === undefined) {
      result.errors.push(`${at}: Panchayat Samiti "${String(rawPs)}" is not in the name mapping.`);
      continue;
    }
    const rawBoothNo = c[COLUMNS.boothNo] ?? null;
    const boothNo = parseBoothNo(rawBoothNo);
    if (boothNo === null) {
      result.errors.push(`${at}: booth number "${String(rawBoothNo)}" is not like 12 or 12A.`);
      continue;
    }
    const gpWard = firstNumber(c[COLUMNS.gpWard] ?? null);
    if (gpWard === null) {
      result.errors.push(`${at}: WardNumber "${String(c[COLUMNS.gpWard])}" has no number.`);
      continue;
    }
    result.clean.push([
      DISTRICT.nameEnglish,
      ps,
      c[COLUMNS.gp] ?? null,
      gpWard,
      // A whole number stays a number cell; "15A" stays text.
      boothNo.suffix === '' ? boothNo.no : boothLabel(boothNo.no, boothNo.suffix),
      c[COLUMNS.nameHindi] ?? null,
      c[COLUMNS.nameEnglish] ?? null,
      c[COLUMNS.psWard] ?? null,
      c[COLUMNS.zpWard] ?? null,
    ]);
  }
  return result;
}

export async function main(argv: string[]): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, 'out-dir': { type: 'string' } },
    USAGE,
  );
  if (values.file === undefined || values['out-dir'] === undefined) {
    console.error(`Usage: ${USAGE}`);
    return { ok: false };
  }
  const sheet = await readSheet(resolveUserPath(values.file), Object.values(COLUMNS));
  if (!sheet.ok) {
    console.error(`ERROR: ${sheet.error}`);
    return { ok: false };
  }
  const { clean, errors } = convertGeographyRows(sheet.rows);
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`);
    console.error('Nothing was written.');
    return { ok: false };
  }
  const outDir = resolveUserPath(values['out-dir']);
  await mkdir(outDir, { recursive: true });
  await writeSheet(join(outDir, CLEAN_FILE), [
    { name: 'polling-stations', headers: Object.values(COLUMNS), rows: clean },
  ]);
  console.log(`Read ${String(sheet.rows.length)} rows from sheet "${sheet.sheetName}".`);
  console.log(`${CLEAN_FILE}: ${String(clean.length)} booths -> ${outDir}`);
  return { ok: true };
}

if (isMainModule(import.meta.url)) {
  const { ok } = await main(process.argv.slice(2));
  process.exitCode = ok ? 0 : 1;
}
