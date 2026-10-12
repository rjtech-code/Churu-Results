// npm run import:parties -- --file <xlsx> [--commit]
import { basename } from 'node:path';
import { IssueList } from '../src/services/master-data/issues.js';
import { reportIssues } from '../src/services/master-data/issues-en.js';
import {
  PARTY_COLUMNS,
  checkParties,
  insertParties,
  loadParties,
  parsePartyRows,
} from '../src/services/master-data/parties.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { readSheet } from './lib/xlsx.js';

export { PARTY_COLUMNS };

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

  const issues = new IssueList();
  const parties = parsePartyRows(sheet.rows, issues);

  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const { toInsert, unchanged } = checkParties(parties, await loadParties(conn), issues);
      reportIssues(report, issues);
      report.section(
        'New parties',
        toInsert.map(
          (p) => `${p.short_name} — ${p.name_hindi} / ${p.name_english} — symbol ${p.symbol}`,
        ),
      );
      report.section('Already in database (unchanged)', unchanged);
      if (!report.isOk()) return { commit: false, value: undefined };

      await insertParties(conn, toInsert);
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
