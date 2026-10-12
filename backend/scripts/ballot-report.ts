// npm run ballot:report [-- --ps <name>] [-- --out <xlsx>]
// Printable ballot list for the two-person cross-check against the official list.
import { join } from 'node:path';
import {
  BALLOT_REPORT_HEADERS,
  buildBallotReportSheets,
} from '../src/services/master-data/ballot-report.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { loadPanchayatSamitis } from './lib/lookups.js';
import { resolveUserPath } from './lib/paths.js';
import { Report, istStamp } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey } from './lib/text.js';
import type { SheetSpec } from './lib/xlsx.js';
import { writeSheet } from './lib/xlsx.js';

export { BALLOT_REPORT_HEADERS };

export async function runBallotReport(
  options: { ps?: string | undefined; out?: string | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult & { outFile: string | null; sheets: string[] }> {
  const startedAt = ctx.now();
  const report = new Report('ballot-report', 'read-only');
  const outFile = options.out ?? join(ctx.reportsDir, `ballot-report-${istStamp(startedAt)}.xlsx`);
  let sheets: SheetSpec[] = [];
  try {
    const psByName = await loadPanchayatSamitis(ctx.pool);
    let onlyPs: number | null = null;
    if (options.ps !== undefined) {
      const ps = psByName.get(matchKey(options.ps));
      if (!ps) report.error(`Unknown Panchayat Samiti "${options.ps}"`);
      else onlyPs = ps.id;
    }
    if (report.isOk()) {
      const built = await buildBallotReportSheets(ctx.pool, {
        ps: onlyPs ?? 'ALL',
        includeZp: onlyPs === null,
      });
      sheets = built.sheets;
      for (const line of built.lines) report.line(line);
      if (sheets.length === 0)
        report.error('Nothing to report: no Panchayat Samitis in the database.');
      else {
        await writeSheet(outFile, sheets);
        report.line(`Ballot report written to ${outFile}`);
        report.line(
          'Print it; two people cross-check it against the official candidate list before ballot:lock.',
        );
      }
    }
  } catch (err) {
    reportFailure(report, err);
  }
  const result = await finishReport(ctx, report, startedAt, false);
  return { ...result, outFile: result.ok ? outFile : null, sheets: sheets.map((s) => s.name) };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { ps: { type: 'string' }, out: { type: 'string' } },
    'npm run ballot:report [-- --ps <name>] [--out <xlsx>]',
  );
  return runBallotReport(
    { ps: values.ps, out: values.out === undefined ? undefined : resolveUserPath(values.out) },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
