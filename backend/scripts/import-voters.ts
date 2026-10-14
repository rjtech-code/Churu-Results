// npm run import:voters -- --file <xlsx> [--commit]
// Two file formats:
//  - template: one row per booth (panchayat_samiti, booth_no, voters_male/female/other/total);
//  - polling-station workbook (Part 14): sheet "Sheet1_withvoters", several rows per booth;
//    registered voters = SUM(Total_Elector) per (PanchayatSamiti, PollingStationNumber). Male and
//    female are not in that file and are stored as NULL. Cross-checked against SUM(Sheet3.Voters).
import { basename } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { optionalInt, requireInt, requireText } from './lib/cells.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import { loadPanchayatSamitis } from './lib/lookups.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey } from './lib/text.js';
import { readNamedSheet, readSheet } from './lib/xlsx.js';
import type { SheetRow } from './lib/xlsx.js';

const REQUIRED = [
  'panchayat_samiti',
  'booth_no',
  'voters_male',
  'voters_female',
  'voters_total',
] as const;
const OPTIONAL = ['voters_other'] as const;

/** The polling-station workbook (Part 14). */
export const STATION_SHEET = 'Sheet1_withvoters';
const STATION_REQUIRED = ['PanchayatSamiti', 'PollingStationNumber', 'Total_Elector'] as const;
export const CHECK_SHEET = 'Sheet3';
const CHECK_REQUIRED = ['Voters'] as const;
/** Churu district (CLAUDE.md): 1,359 booths, 1,248,368 registered voters. */
export const EXPECTED_BOOTHS = 1359;
export const EXPECTED_TOTAL_VOTERS = 1_248_368;

export interface VotersOptions {
  file?: string | undefined;
  commit?: boolean | undefined;
  /** Polling-station format only; tests use small fixtures. Default: the Churu numbers. */
  expectedBooths?: number | undefined;
  expectedTotalVoters?: number | undefined;
}

/** One booth as read from the file, before it is matched to the database. */
interface FileBooth {
  rowNumbers: number[];
  psName: string;
  boothNo: number;
  male: number | null;
  female: number | null;
  total: number;
}

interface VoterRow {
  boothId: number;
  male: number | null;
  female: number | null;
  total: number;
}

/** Template format: one row per booth; male + female + other must equal total. */
function parseTemplateRows(rows: readonly SheetRow[], report: Report): FileBooth[] {
  const out: FileBooth[] = [];
  for (const row of rows) {
    const before = report.errors.length;
    const psName = requireText(row, 'panchayat_samiti', report);
    const boothNo = requireInt(row, 'booth_no', report, 1);
    const male = requireInt(row, 'voters_male', report, 0);
    const female = requireInt(row, 'voters_female', report, 0);
    const other = optionalInt(row, 'voters_other', report, 0, 0);
    const total = requireInt(row, 'voters_total', report, 0);
    if (psName === null || boothNo === null) continue;
    if (male !== null && female !== null && other !== null && total !== null) {
      if (male + female + other !== total) {
        report.error(
          `voters_total ${total} does not equal male ${male} + female ${female} + other ${other} = ${male + female + other}`,
          row.rowNumber,
        );
      }
    }
    // A row with a problem still counts as "present" (no extra "missing booth" error), but is
    // marked total = -1 so it is never written.
    const bad = report.errors.length !== before || total === null;
    out.push({ rowNumbers: [row.rowNumber], psName, boothNo, male, female, total: bad ? -1 : total });
  }
  return out;
}

/** Polling-station format: SUM(Total_Elector) grouped by (PanchayatSamiti, PollingStationNumber). */
function parseStationRows(rows: readonly SheetRow[], report: Report): FileBooth[] {
  const byKey = new Map<string, FileBooth>();
  for (const row of rows) {
    const psName = requireText(row, 'PanchayatSamiti', report);
    const boothNo = requireInt(row, 'PollingStationNumber', report, 1);
    const electors = requireInt(row, 'Total_Elector', report, 0);
    if (psName === null || boothNo === null) continue;
    const key = `${matchKey(psName)}|${boothNo}`;
    const booth = byKey.get(key) ?? {
      rowNumbers: [],
      psName,
      boothNo,
      male: null,
      female: null,
      total: 0,
    };
    booth.rowNumbers.push(row.rowNumber);
    if (electors === null || booth.total < 0) booth.total = -1; // error already reported
    else booth.total += electors;
    byKey.set(key, booth);
  }
  return [...byKey.values()];
}

export async function runImportVoters(
  options: VotersOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('import-voters', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const done = () => finishReport(ctx, report, startedAt, committed);

  if (options.file === undefined || options.file.trim() === '') {
    report.error('--file <xlsx> is required.');
    return done();
  }
  const file = options.file;
  let sha256: string;
  try {
    sha256 = await sha256File(file);
  } catch (err) {
    report.error(`Cannot read file "${file}": ${err instanceof Error ? err.message : String(err)}`);
    return done();
  }
  report.line(`File: ${file}`);
  report.line(`SHA-256: ${sha256}`);
  const stations = await readNamedSheet(file, STATION_SHEET, STATION_REQUIRED);
  const stationFormat = stations !== null;
  const sheet = stations ?? (await readSheet(file, REQUIRED, OPTIONAL));
  if (!sheet.ok) {
    report.error(sheet.error);
    return done();
  }
  report.line(
    `Sheet: ${sheet.sheetName} (${sheet.rows.length} data rows; format: ${stationFormat ? 'polling-station workbook' : 'voter template'})`,
  );
  const fileBooths = stationFormat
    ? parseStationRows(sheet.rows, report)
    : parseTemplateRows(sheet.rows, report);

  if (stationFormat) {
    const expectedBooths = options.expectedBooths ?? EXPECTED_BOOTHS;
    const expectedTotal = options.expectedTotalVoters ?? EXPECTED_TOTAL_VOTERS;
    if (fileBooths.length !== expectedBooths) {
      report.error(
        `The file has ${fileBooths.length} booths (PanchayatSamiti + PollingStationNumber); expected exactly ${expectedBooths}`,
      );
    }
    if (report.isOk()) {
      const fileTotal = fileBooths.reduce((sum, b) => sum + b.total, 0);
      report.line(`Total_Elector grand total: ${fileTotal}`);
      if (fileTotal !== expectedTotal)
        report.error(`Total_Elector grand total ${fileTotal} is not the expected ${expectedTotal}`);
      const check = await readNamedSheet(file, CHECK_SHEET, CHECK_REQUIRED);
      if (check === null) report.error(`The file has no sheet "${CHECK_SHEET}" to cross-check`);
      else if (!check.ok) report.error(check.error);
      else {
        let checkTotal = 0;
        for (const row of check.rows) {
          const voters = requireInt(row, 'Voters', report, 0);
          if (voters !== null) checkTotal += voters;
        }
        report.line(`${CHECK_SHEET}.Voters total: ${checkTotal}`);
        if (report.isOk() && checkTotal !== fileTotal) {
          report.error(
            `Total_Elector grand total ${fileTotal} does not equal SUM(${CHECK_SHEET}.Voters) ${checkTotal}`,
          );
        }
      }
    }
  }

  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const psByName = await loadPanchayatSamitis(conn);
      const [boothRows] = await conn.query<RowDataPacket[]>(
        `SELECT b.id, b.panchayat_samiti_id, b.booth_no, ps.name_english AS ps_name,
                EXISTS (SELECT 1 FROM booth_entry e WHERE e.booth_id = b.id) AS has_entry
           FROM booth b JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
          ORDER BY ps.name_english, b.booth_no`,
      );
      if (boothRows.length === 0) {
        report.error('There are no booths in the database. Run import:geography first.');
        return { commit: false, value: undefined };
      }
      const boothByKey = new Map(
        boothRows.map((b) => [`${Number(b.panchayat_samiti_id)}|${Number(b.booth_no)}`, b]),
      );

      const seen = new Map<number, number[]>();
      const valid: VoterRow[] = [];
      for (const fb of fileBooths) {
        const ps = psByName.get(matchKey(fb.psName));
        if (!ps) {
          report.error(`Unknown Panchayat Samiti "${fb.psName}"`, fb.rowNumbers);
          continue;
        }
        const booth = boothByKey.get(`${ps.id}|${fb.boothNo}`);
        if (!booth) {
          report.error(`Unknown booth: ${fb.psName} has no booth ${fb.boothNo}`, fb.rowNumbers);
          continue;
        }
        const boothId = Number(booth.id);
        seen.set(boothId, [...(seen.get(boothId) ?? []), ...fb.rowNumbers]);
        let ok = fb.total >= 0;
        if (Number(booth.has_entry) === 1) {
          ok = false;
          report.error(
            `Booth ${fb.boothNo} of ${ps.name_english} already has counting entries; its voter counts can no longer be changed`,
            fb.rowNumbers,
          );
        }
        if (ok) valid.push({ boothId, male: fb.male, female: fb.female, total: fb.total });
      }

      if (!stationFormat) {
        for (const [, rows] of seen) {
          if (rows.length > 1) report.error('The same booth appears more than once', rows);
        }
      }
      const missing = boothRows.filter((b) => !seen.has(Number(b.id)));
      for (const b of missing) {
        report.error(
          `Missing booth: booth ${Number(b.booth_no)} of ${String(b.ps_name)} is not in the file`,
        );
      }
      report.line(
        `Booths in database: ${boothRows.length}; booths in file: ${fileBooths.length}; missing: ${missing.length}`,
      );
      if (!report.isOk()) return { commit: false, value: undefined };

      let grandTotal = 0;
      for (const v of valid) {
        grandTotal += v.total;
        await conn.execute(
          `UPDATE booth SET registered_voters_male = ?, registered_voters_female = ?, registered_voters_total = ?
            WHERE id = ?`,
          [v.male, v.female, v.total, v.boothId],
        );
      }
      report.line(`Booths updated: ${valid.length}; total registered voters: ${grandTotal}`);
      await writeAudit(conn, {
        action: 'IMPORT_VOTERS',
        entity: 'booth',
        entityId: null,
        newValue: {
          file: basename(file),
          sha256,
          booths_updated: valid.length,
          total_voters: grandTotal,
          format: stationFormat ? 'polling-station' : 'template',
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

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run import:voters -- --file <xlsx> [--commit]',
  );
  return runImportVoters(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
