// npm run import:geography -- --file <xlsx> [--fixes <json>] [--ps-names <json>] [--replace] [--commit]
//
// Loads Panchayat Samitis, PS wards, ZP wards and booths from the polling-station Excel file.
// Each Excel ROW is a Gram Panchayat ward; several rows share one booth.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { requireInt, requireText } from './lib/cells.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { countOf, inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey, normalizeText } from './lib/text.js';
import { readSheet } from './lib/xlsx.js';

export const COLUMNS = {
  district: 'District',
  ps: 'PanchayatSamiti',
  gp: 'Grampanchayat',
  gpWard: 'WardNumber',
  boothNo: 'PollingStationNumber',
  nameHindi: 'Polling Station in Hindi',
  nameEnglish: 'Polling Station in English',
  psWard: 'PanchayatSamitiConstituenyNumber',
  zpWard: 'ZillaParishadConstituencyNumber',
} as const;

export const EXPECTED_COUNTS = {
  panchayatSamitis: 13,
  psWards: 231,
  zpWards: 39,
  booths: 1359,
} as const;

export const DISTRICT = { code: 'CHURU', nameEnglish: 'Churu', nameHindi: 'चूरू' } as const;

export type GeographyCounts = Record<keyof typeof EXPECTED_COUNTS, number>;

export interface GeographyOptions {
  file?: string | undefined;
  fixes?: string | undefined;
  psNames?: string | undefined;
  replace?: boolean | undefined;
  commit?: boolean | undefined;
}

export interface GeographyResult extends ScriptResult {
  counts: GeographyCounts | null;
  /** Number of booths with conflicting values (after fixes). */
  conflicts: number;
}

type FixField = 'ps_ward_no' | 'zp_ward_no' | 'name_hindi' | 'name_english';
const FIX_FIELDS: readonly FixField[] = ['ps_ward_no', 'zp_ward_no', 'name_hindi', 'name_english'];

interface Fix {
  index: number;
  psKey: string;
  psName: string;
  boothNo: number;
  field: FixField;
  value: number | string;
  reason: string;
  approvedBy: string;
  approvedOn: string;
}

interface ParsedRow {
  rowNumber: number;
  psKey: string;
  psName: string;
  boothNo: number;
  values: Record<FixField, number | string>;
}

interface Booth {
  psKey: string;
  psName: string;
  boothNo: number;
  rows: ParsedRow[];
  resolved: Record<FixField, number | string> | null; // null = conflict
}

const FIELD_LABELS: Record<FixField, string> = {
  ps_ward_no: 'PS ward numbers',
  zp_ward_no: 'ZP ward numbers',
  name_hindi: 'Hindi names',
  name_english: 'English names',
};

// ---------------------------------------------------------------- fixes file

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

export function parseFixes(raw: unknown, report: Report): Fix[] {
  if (!Array.isArray(raw)) {
    report.error('Fixes file must be a JSON list ([ ... ]) of fix objects.');
    return [];
  }
  const fixes: Fix[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, i) => {
    const where = `Fixes file entry #${i + 1}`;
    if (!isRecord(entry)) {
      report.error(`${where}: must be an object.`);
      return;
    }
    const text = (key: string): string | null => {
      const v = entry[key];
      return typeof v === 'string' && normalizeText(v) !== '' ? normalizeText(v) : null;
    };
    const missing = ['panchayat_samiti', 'reason', 'approved_by', 'approved_on'].filter(
      (k) => text(k) === null,
    );
    if (missing.length > 0) {
      report.error(`${where}: missing or empty ${missing.join(', ')} (every fix needs them).`);
    }
    const boothNo = entry.booth_no;
    if (typeof boothNo !== 'number' || !Number.isSafeInteger(boothNo) || boothNo < 1) {
      report.error(`${where}: "booth_no" must be a whole number greater than 0.`);
    }
    const field = entry.field;
    if (typeof field !== 'string' || !FIX_FIELDS.includes(field as FixField)) {
      report.error(`${where}: "field" must be one of ${FIX_FIELDS.join(', ')}.`);
    }
    const approvedOn = text('approved_on');
    if (approvedOn !== null && !isValidDate(approvedOn)) {
      report.error(`${where}: "approved_on" must be a real date written as YYYY-MM-DD.`);
    }
    const extra = Object.keys(entry).filter(
      (k) =>
        ![
          'panchayat_samiti',
          'booth_no',
          'field',
          'value',
          'reason',
          'approved_by',
          'approved_on',
        ].includes(k),
    );
    if (extra.length > 0) report.error(`${where}: unknown key(s) ${extra.join(', ')}.`);

    let value: number | string | null = null;
    if (field === 'ps_ward_no' || field === 'zp_ward_no') {
      const v = entry.value;
      if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1) value = v;
      else report.error(`${where}: "value" for ${field} must be a whole number greater than 0.`);
    } else if (field === 'name_hindi' || field === 'name_english') {
      value = text('value');
      if (value === null) report.error(`${where}: "value" for ${field} must be non-empty text.`);
    }

    const psName = text('panchayat_samiti');
    const reason = text('reason');
    const approvedBy = text('approved_by');
    if (
      psName === null ||
      reason === null ||
      approvedBy === null ||
      approvedOn === null ||
      !isValidDate(approvedOn) ||
      typeof boothNo !== 'number' ||
      value === null ||
      extra.length > 0
    ) {
      return;
    }
    const fix: Fix = {
      index: i + 1,
      psKey: matchKey(psName),
      psName,
      boothNo,
      field: field as FixField,
      value,
      reason,
      approvedBy,
      approvedOn,
    };
    const key = `${fix.psKey}|${fix.boothNo}|${fix.field}`;
    if (seen.has(key)) {
      report.error(`${where}: a second fix for ${fix.field} of booth ${boothNo} of ${psName}.`);
      return;
    }
    seen.add(key);
    fixes.push(fix);
  });
  return fixes;
}

// ---------------------------------------------------------------- PS Hindi names file

function parsePsNames(
  raw: unknown,
  report: Report,
): Map<string, { english: string; hindi: string }> {
  const names = new Map<string, { english: string; hindi: string }>();
  if (!isRecord(raw)) {
    report.error(
      'PS names file must be a JSON object: { "<English PS name>": "<Hindi name>", ... }.',
    );
    return names;
  }
  for (const [english, hindi] of Object.entries(raw)) {
    if (typeof hindi !== 'string') {
      report.error(`PS names file: the value for "${english}" must be text.`);
      continue;
    }
    names.set(matchKey(english), { english: normalizeText(english), hindi: normalizeText(hindi) });
  }
  return names;
}

async function readJson(path: string, label: string, report: Report): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (err) {
    report.error(
      `Cannot read ${label} "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------- main

function distinctValues(
  rows: readonly ParsedRow[],
  field: FixField,
): Map<number | string, number[]> {
  const map = new Map<number | string, number[]>();
  for (const row of rows) {
    const v = row.values[field];
    map.set(v, [...(map.get(v) ?? []), row.rowNumber]);
  }
  return map;
}

export async function runImportGeography(
  options: GeographyOptions,
  ctx: ScriptContext,
): Promise<GeographyResult> {
  const startedAt = ctx.now();
  const report = new Report('import-geography', options.commit === true ? 'commit' : 'dry-run');
  let counts: GeographyCounts | null = null;
  let conflicts = 0;
  let committed = false;

  const done = async (): Promise<GeographyResult> => ({
    ...(await finishReport(ctx, report, startedAt, committed)),
    counts,
    conflicts,
  });

  if (options.file === undefined || options.file.trim() === '') {
    report.error('--file <xlsx> is required.');
    return done();
  }
  const file = options.file;
  report.line(`File: ${file}`);

  let sha256: string;
  try {
    sha256 = await sha256File(file);
  } catch (err) {
    report.error(`Cannot read file "${file}": ${err instanceof Error ? err.message : String(err)}`);
    return done();
  }
  report.line(`SHA-256: ${sha256}`);

  const sheet = await readSheet(file, Object.values(COLUMNS));
  if (!sheet.ok) {
    report.error(sheet.error);
    return done();
  }
  report.line(`Sheet: ${sheet.sheetName} (${sheet.rows.length} data rows)`);

  // 1. Row-level validation.
  const parsed: ParsedRow[] = [];
  for (const row of sheet.rows) {
    const errorsBefore = report.errors.length;
    const district = requireText(row, COLUMNS.district, report);
    const psName = requireText(row, COLUMNS.ps, report);
    requireText(row, COLUMNS.gp, report);
    requireInt(row, COLUMNS.gpWard, report, 1);
    const boothNo = requireInt(row, COLUMNS.boothNo, report, 1);
    const nameHindi = requireText(row, COLUMNS.nameHindi, report);
    const nameEnglish = requireText(row, COLUMNS.nameEnglish, report);
    const psWard = requireInt(row, COLUMNS.psWard, report, 1);
    const zpWard = requireInt(row, COLUMNS.zpWard, report, 1);
    if (district !== null && matchKey(district) !== DISTRICT.code) {
      report.error(`District must be Churu, got "${district}"`, row.rowNumber);
    }
    if (
      report.errors.length !== errorsBefore ||
      psName === null ||
      boothNo === null ||
      nameHindi === null ||
      nameEnglish === null ||
      psWard === null ||
      zpWard === null
    ) {
      continue;
    }
    parsed.push({
      rowNumber: row.rowNumber,
      psKey: matchKey(psName),
      psName,
      boothNo,
      values: {
        ps_ward_no: psWard,
        zp_ward_no: zpWard,
        name_hindi: nameHindi,
        name_english: nameEnglish,
      },
    });
  }

  // 2. Group rows into booths.
  const booths = new Map<string, Booth>();
  const psDisplay = new Map<string, string>();
  for (const row of parsed) {
    if (!psDisplay.has(row.psKey)) psDisplay.set(row.psKey, row.psName);
    const key = `${row.psKey}|${row.boothNo}`;
    const booth = booths.get(key);
    if (booth) booth.rows.push(row);
    else
      booths.set(key, {
        psKey: row.psKey,
        psName: row.psName,
        boothNo: row.boothNo,
        rows: [row],
        resolved: null,
      });
  }

  // 3. Apply approved fixes.
  const fixLines: string[] = [];
  const appliedFixes: Record<string, unknown>[] = [];
  if (options.fixes !== undefined) {
    const raw = await readJson(options.fixes, 'fixes file', report);
    if (raw !== undefined) {
      for (const fix of parseFixes(raw, report)) {
        const booth = booths.get(`${fix.psKey}|${fix.boothNo}`);
        if (!booth) {
          report.error(
            `Fixes file entry #${fix.index}: booth ${fix.boothNo} of "${fix.psName}" is not in the data file.`,
          );
          continue;
        }
        const before = [...distinctValues(booth.rows, fix.field).keys()];
        for (const row of booth.rows) row.values[fix.field] = fix.value;
        fixLines.push(
          `Booth ${fix.boothNo} of ${booth.psName}: ${fix.field} ${before.join(' / ')} -> ${String(fix.value)} ` +
            `(reason: ${fix.reason}; approved by ${fix.approvedBy} on ${fix.approvedOn}; rows ${booth.rows
              .map((r) => r.rowNumber)
              .join(', ')})`,
        );
        appliedFixes.push({
          panchayat_samiti: booth.psName,
          booth_no: fix.boothNo,
          field: fix.field,
          from: before,
          to: fix.value,
          reason: fix.reason,
          approved_by: fix.approvedBy,
          approved_on: fix.approvedOn,
        });
      }
    }
  }

  // 4. Each booth must have exactly one PS ward, ZP ward and name.
  for (const booth of booths.values()) {
    let ok = true;
    for (const field of FIX_FIELDS) {
      const values = distinctValues(booth.rows, field);
      if (values.size > 1) {
        ok = false;
        const detail = [...values.entries()]
          .map(([v, rows]) => `${String(v)} (row${rows.length > 1 ? 's' : ''} ${rows.join(', ')})`)
          .join(', ');
        report.error(
          `Booth ${booth.boothNo} of ${booth.psName} has conflicting ${FIELD_LABELS[field]}: ${detail}. ` +
            'Correct the source file or add an approved entry to the fixes file.',
          booth.rows.map((r) => r.rowNumber),
        );
      }
    }
    if (ok) {
      const first = booth.rows[0];
      booth.resolved = first ? { ...first.values } : null;
    } else {
      conflicts++;
    }
  }

  // 5. Derived counts.
  counts = {
    panchayatSamitis: psDisplay.size,
    psWards: new Set(parsed.map((r) => `${r.psKey}|${String(r.values.ps_ward_no)}`)).size,
    zpWards: new Set(parsed.map((r) => r.values.zp_ward_no)).size,
    booths: booths.size,
  };
  const countLabels: Record<keyof GeographyCounts, string> = {
    panchayatSamitis: 'Panchayat Samitis',
    psWards: 'PS wards',
    zpWards: 'ZP wards',
    booths: 'Booths',
  };
  const countLines = [`${'What'.padEnd(20)}${'found'.padStart(8)}${'expected'.padStart(10)}`];
  for (const key of Object.keys(EXPECTED_COUNTS) as (keyof GeographyCounts)[]) {
    countLines.push(
      `${countLabels[key].padEnd(20)}${String(counts[key]).padStart(8)}${String(EXPECTED_COUNTS[key]).padStart(10)}`,
    );
    if (counts[key] !== EXPECTED_COUNTS[key]) {
      report.warn(
        `${countLabels[key]}: found ${counts[key]}, expected ${EXPECTED_COUNTS[key]}. Check against the official numbers.`,
      );
    }
  }
  report.section('Derived counts', countLines);
  report.section('Applied fixes', fixLines);
  report.section('Panchayat Samitis in file', [...psDisplay.values()]);

  // 6. Hindi PS names.
  const hindiByPs = new Map<string, string>();
  const missingHindi: string[] = [];
  if (options.psNames !== undefined) {
    const raw = await readJson(options.psNames, 'PS names file', report);
    if (raw !== undefined) {
      for (const [key, entry] of parsePsNames(raw, report)) {
        if (!psDisplay.has(key)) {
          report.error(
            `PS names file: "${entry.english}" is not a Panchayat Samiti in the data file.`,
          );
        } else if (entry.hindi !== '') {
          hindiByPs.set(key, entry.hindi);
        }
      }
    }
  }
  for (const [key, name] of psDisplay) {
    if (!hindiByPs.has(key)) {
      missingHindi.push(name);
      report.warn(`No Hindi name for "${name}"; the English name is stored instead.`);
    }
  }
  const hindiOwners = new Map<string, string[]>();
  for (const [key, hindi] of hindiByPs) {
    hindiOwners.set(hindi, [...(hindiOwners.get(hindi) ?? []), psDisplay.get(key) ?? key]);
  }
  for (const [hindi, owners] of hindiOwners) {
    if (owners.length > 1)
      report.error(`PS names file: Hindi name "${hindi}" is used for ${owners.join(' and ')}.`);
  }

  // 7. Database checks and writes, all in one transaction.
  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      await checkDatabase(conn, options.replace === true, psDisplay, report);
      if (!report.isOk()) return { commit: false, value: undefined };

      await writeGeography(conn, booths, psDisplay, hindiByPs);
      await writeAudit(conn, {
        action: 'IMPORT_GEOGRAPHY',
        entity: 'geography',
        entityId: null,
        newValue: {
          file: basename(file),
          sha256,
          sheet: sheet.sheetName,
          counts,
          expected_counts: EXPECTED_COUNTS,
          replace: options.replace === true,
          fixes_applied: appliedFixes,
          ps_without_hindi_name: missingHindi,
        },
      });
      return { commit: options.commit === true, value: undefined };
    });
    committed = result.committed;
  } catch (err) {
    reportFailure(report, err);
  }
  return done();
}

async function checkDatabase(
  conn: PoolConnection,
  replace: boolean,
  psInFile: Map<string, string>,
  report: Report,
): Promise<void> {
  const wards = await countOf(conn, 'SELECT COUNT(*) AS n FROM ward');
  const booths = await countOf(conn, 'SELECT COUNT(*) AS n FROM booth');
  if (wards + booths > 0) {
    if (!replace) {
      report.error(
        `Geography already exists in the database (${wards} wards, ${booths} booths). ` +
          'Use --replace to re-import it.',
      );
      return;
    }
    const candidates = await countOf(conn, 'SELECT COUNT(*) AS n FROM candidate');
    const boothEntries = await countOf(conn, 'SELECT COUNT(*) AS n FROM booth_entry');
    const postalEntries = await countOf(conn, 'SELECT COUNT(*) AS n FROM postal_entry');
    if (candidates + boothEntries + postalEntries > 0) {
      report.error(
        `--replace refused: the database already has ${candidates} candidate(s), ` +
          `${boothEntries} booth entr(ies) and ${postalEntries} postal entr(ies). ` +
          'Geography can only be replaced before candidates are loaded.',
      );
      return;
    }
    const withVoters = await countOf(
      conn,
      'SELECT COUNT(*) AS n FROM booth WHERE registered_voters_total IS NOT NULL',
    );
    report.warn(
      `--replace: ${wards} wards and ${booths} booths will be deleted and re-created. ` +
        `Voter counts (${withVoters} booth(s) have them) are lost and MUST be imported again (npm run import:voters).`,
    );
  }

  const [existing] = await conn.query<RowDataPacket[]>(
    `SELECT ps.name_english, (SELECT COUNT(*) FROM users u WHERE u.panchayat_samiti_id = ps.id) AS users
       FROM panchayat_samiti ps`,
  );
  for (const row of existing) {
    const name = String(row.name_english);
    if (!psInFile.has(matchKey(name)) && Number(row.users) > 0) {
      report.error(
        `Panchayat Samiti "${name}" is in the database with user accounts but not in the file; it cannot be removed.`,
      );
    }
  }
}

async function insertId(
  conn: PoolConnection,
  sql: string,
  params: (string | number | null)[],
): Promise<number> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result.insertId;
}

async function writeGeography(
  conn: PoolConnection,
  booths: Map<string, Booth>,
  psInFile: Map<string, string>,
  hindiByPs: Map<string, string>,
): Promise<void> {
  // District.
  const [districtRows] = await conn.execute<RowDataPacket[]>(
    'SELECT id FROM district WHERE code = ?',
    [DISTRICT.code],
  );
  const districtId =
    districtRows[0] !== undefined
      ? Number(districtRows[0].id)
      : await insertId(
          conn,
          'INSERT INTO district (code, name_english, name_hindi) VALUES (?, ?, ?)',
          [DISTRICT.code, DISTRICT.nameEnglish, DISTRICT.nameHindi],
        );

  // Old wards and booths go (only reachable when --replace passed all checks).
  await conn.execute('DELETE FROM booth');
  await conn.execute('DELETE FROM ward');

  // Panchayat Samitis: keep existing rows (user accounts point to them), add new, drop unused.
  const [existing] = await conn.query<RowDataPacket[]>(
    'SELECT id, name_english FROM panchayat_samiti',
  );
  const psIds = new Map<string, number>();
  for (const row of existing) {
    const key = matchKey(String(row.name_english));
    if (psInFile.has(key)) psIds.set(key, Number(row.id));
    else await conn.execute('DELETE FROM panchayat_samiti WHERE id = ?', [Number(row.id)]);
  }
  for (const [key, english] of psInFile) {
    const hindi = hindiByPs.get(key) ?? english;
    const id = psIds.get(key);
    if (id !== undefined) {
      await conn.execute(
        'UPDATE panchayat_samiti SET name_english = ?, name_hindi = ? WHERE id = ?',
        [english, hindi, id],
      );
    } else {
      psIds.set(
        key,
        await insertId(
          conn,
          'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
          [districtId, english, hindi],
        ),
      );
    }
  }

  // Wards.
  const psWardIds = new Map<string, number>();
  const zpWardIds = new Map<number, number>();
  const sorted = [...booths.values()].sort(
    (a, b) => a.psName.localeCompare(b.psName) || a.boothNo - b.boothNo,
  );
  for (const booth of sorted) {
    if (!booth.resolved) throw new Error('internal: unresolved booth reached the write phase');
    const psId = psIds.get(booth.psKey);
    if (psId === undefined) throw new Error('internal: unknown PS');
    const psWardNo = Number(booth.resolved.ps_ward_no);
    const zpWardNo = Number(booth.resolved.zp_ward_no);
    const psWardKey = `${psId}|${psWardNo}`;
    if (!psWardIds.has(psWardKey)) {
      psWardIds.set(
        psWardKey,
        await insertId(
          conn,
          "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('PS', ?, ?, ?)",
          [districtId, psId, psWardNo],
        ),
      );
    }
    if (!zpWardIds.has(zpWardNo)) {
      zpWardIds.set(
        zpWardNo,
        await insertId(
          conn,
          "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, NULL, ?)",
          [districtId, zpWardNo],
        ),
      );
    }
    await conn.execute(
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, name_english, ps_ward_id, zp_ward_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        psId,
        booth.boothNo,
        String(booth.resolved.name_hindi),
        String(booth.resolved.name_english),
        psWardIds.get(psWardKey) ?? null,
        zpWardIds.get(zpWardNo) ?? null,
      ],
    );
  }
}

const USAGE =
  'npm run import:geography -- --file <xlsx> [--fixes <json>] [--ps-names <json>] [--replace] [--commit]';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    {
      file: { type: 'string' },
      fixes: { type: 'string' },
      'ps-names': { type: 'string' },
      replace: { type: 'boolean' },
      commit: { type: 'boolean' },
    },
    USAGE,
  );
  return runImportGeography(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      fixes: values.fixes === undefined ? undefined : resolveUserPath(values.fixes),
      psNames: values['ps-names'] === undefined ? undefined : resolveUserPath(values['ps-names']),
      replace: values.replace,
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
