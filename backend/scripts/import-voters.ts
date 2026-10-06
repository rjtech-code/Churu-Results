// npm run import:voters -- --file <xlsx> [--commit]
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
import { readSheet } from './lib/xlsx.js';

const REQUIRED = [
  'panchayat_samiti',
  'booth_no',
  'voters_male',
  'voters_female',
  'voters_total',
] as const;
const OPTIONAL = ['voters_other'] as const;

export interface VotersOptions {
  file?: string | undefined;
  commit?: boolean | undefined;
}

interface VoterRow {
  rowNumber: number;
  boothId: number;
  male: number;
  female: number;
  total: number;
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
  const sheet = await readSheet(file, REQUIRED, OPTIONAL);
  if (!sheet.ok) {
    report.error(sheet.error);
    return done();
  }
  report.line(`Sheet: ${sheet.sheetName} (${sheet.rows.length} data rows)`);

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
      for (const row of sheet.rows) {
        const before = report.errors.length;
        const psName = requireText(row, 'panchayat_samiti', report);
        const boothNo = requireInt(row, 'booth_no', report, 1);
        const male = requireInt(row, 'voters_male', report, 0);
        const female = requireInt(row, 'voters_female', report, 0);
        const other = optionalInt(row, 'voters_other', report, 0, 0);
        const total = requireInt(row, 'voters_total', report, 0);
        if (psName === null || boothNo === null) continue;
        const ps = psByName.get(matchKey(psName));
        if (!ps) {
          report.error(`Unknown Panchayat Samiti "${psName}"`, row.rowNumber);
          continue;
        }
        const booth = boothByKey.get(`${ps.id}|${boothNo}`);
        if (!booth) {
          report.error(`Unknown booth: ${psName} has no booth ${boothNo}`, row.rowNumber);
          continue;
        }
        const boothId = Number(booth.id);
        seen.set(boothId, [...(seen.get(boothId) ?? []), row.rowNumber]);
        if (Number(booth.has_entry) === 1) {
          report.error(
            `Booth ${boothNo} of ${ps.name_english} already has counting entries; its voter counts can no longer be changed`,
            row.rowNumber,
          );
        }
        if (male === null || female === null || other === null || total === null) continue;
        if (male + female + other !== total) {
          report.error(
            `voters_total ${total} does not equal male ${male} + female ${female} + other ${other} = ${male + female + other}`,
            row.rowNumber,
          );
        }
        if (report.errors.length === before)
          valid.push({ rowNumber: row.rowNumber, boothId, male, female, total });
      }

      for (const [, rows] of seen) {
        if (rows.length > 1) report.error('The same booth appears more than once', rows);
      }
      const missing = boothRows.filter((b) => !seen.has(Number(b.id)));
      for (const b of missing) {
        report.error(
          `Missing booth: booth ${Number(b.booth_no)} of ${String(b.ps_name)} is not in the file`,
        );
      }
      report.line(
        `Booths in database: ${boothRows.length}; rows in file: ${sheet.rows.length}; missing: ${missing.length}`,
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
