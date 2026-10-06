// npm run import:parties -- --file <xlsx> [--commit]
import { basename } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { requireText } from './lib/cells.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey } from './lib/text.js';
import { readSheet } from './lib/xlsx.js';

export const PARTY_COLUMNS = ['name_hindi', 'name_english', 'short_name', 'symbol'] as const;
type PartyField = (typeof PARTY_COLUMNS)[number];
type Party = Record<PartyField, string> & { rowNumber: number };

export interface PartiesOptions {
  file?: string | undefined;
  commit?: boolean | undefined;
}

export async function runImportParties(
  options: PartiesOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('import-parties', options.commit === true ? 'commit' : 'dry-run');
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

  const sheet = await readSheet(file, PARTY_COLUMNS);
  if (!sheet.ok) {
    report.error(sheet.error);
    return done();
  }
  report.line(`Sheet: ${sheet.sheetName} (${sheet.rows.length} data rows)`);

  const parties: Party[] = [];
  for (const row of sheet.rows) {
    const before = report.errors.length;
    const values = PARTY_COLUMNS.map((c) => requireText(row, c, report));
    if (report.errors.length !== before) continue;
    const [name_hindi, name_english, short_name, symbol] = values as [
      string,
      string,
      string,
      string,
    ];
    parties.push({ rowNumber: row.rowNumber, name_hindi, name_english, short_name, symbol });
  }

  // Unique within the file (case-insensitive, like the database collation).
  for (const field of ['short_name', 'name_hindi', 'name_english'] as const) {
    const groups = new Map<string, number[]>();
    for (const p of parties)
      groups.set(matchKey(p[field]), [...(groups.get(matchKey(p[field])) ?? []), p.rowNumber]);
    for (const [value, rows] of groups) {
      if (rows.length > 1)
        report.error(`${field} "${value}" appears more than once in the file`, rows);
    }
  }

  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const [existingRows] = await conn.query<RowDataPacket[]>(
        'SELECT id, name_hindi, name_english, short_name, symbol FROM party',
      );
      const existing = existingRows.map((r) => ({
        name_hindi: String(r.name_hindi),
        name_english: String(r.name_english),
        short_name: String(r.short_name),
        symbol: String(r.symbol),
      }));
      const toInsert: Party[] = [];
      const unchanged: string[] = [];
      for (const p of parties) {
        const same = existing.find((e) => matchKey(e.short_name) === matchKey(p.short_name));
        if (same) {
          const differs = PARTY_COLUMNS.filter((f) => same[f] !== p[f]);
          if (differs.length === 0) unchanged.push(p.short_name);
          else {
            report.error(
              `Party "${p.short_name}" already exists with different ${differs.join(', ')}; changing an existing party is not supported`,
              p.rowNumber,
            );
          }
          continue;
        }
        for (const field of ['name_hindi', 'name_english'] as const) {
          const clash = existing.find((e) => matchKey(e[field]) === matchKey(p[field]));
          if (clash) {
            report.error(
              `${field} "${p[field]}" already belongs to party "${clash.short_name}" in the database`,
              p.rowNumber,
            );
          }
        }
        toInsert.push(p);
      }
      report.section(
        'New parties',
        toInsert.map(
          (p) => `${p.short_name} — ${p.name_hindi} / ${p.name_english} — symbol ${p.symbol}`,
        ),
      );
      report.section('Already in database (unchanged)', unchanged);
      if (!report.isOk()) return { commit: false, value: undefined };

      for (const p of toInsert) {
        await conn.execute(
          'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
          [p.name_hindi, p.name_english, p.short_name, p.symbol],
        );
      }
      await writeAudit(conn, {
        action: 'IMPORT_PARTIES',
        entity: 'party',
        entityId: null,
        newValue: {
          file: basename(file),
          sha256,
          inserted: toInsert.map((p) => p.short_name),
          unchanged,
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
    'npm run import:parties -- --file <xlsx> [--commit]',
  );
  return runImportParties(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
