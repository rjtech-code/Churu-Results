// npm run export:voter-template [-- --out <xlsx>]
// One row per booth, with empty voter-count columns, to send to officials.
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { TEMPLATES_DIR, resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { writeSheet } from './lib/xlsx.js';

export const VOTER_TEMPLATE_HEADERS = [
  'panchayat_samiti',
  'booth_no',
  'booth_name_hindi',
  'ps_ward_no',
  'zp_ward_no',
  'voters_male',
  'voters_female',
  'voters_other',
  'voters_total',
] as const;

export const DEFAULT_VOTER_TEMPLATE = join(TEMPLATES_DIR, 'voter-counts-template.xlsx');

export async function runExportVoterTemplate(
  options: { out?: string | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult & { booths: number }> {
  const startedAt = ctx.now();
  const report = new Report('export-voter-template', 'read-only');
  const out = options.out ?? DEFAULT_VOTER_TEMPLATE;
  let booths = 0;
  try {
    const [rows] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT ps.name_english AS ps_name, b.booth_no, b.name_hindi, pw.ward_no AS ps_ward_no, zw.ward_no AS zp_ward_no
         FROM booth b
         JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id
         JOIN ward pw ON pw.id = b.ps_ward_id
         JOIN ward zw ON zw.id = b.zp_ward_id
        ORDER BY ps.name_english, b.booth_no`,
    );
    booths = rows.length;
    if (booths === 0) {
      report.error('There are no booths in the database. Run import:geography first.');
    } else {
      await writeSheet(out, [
        {
          name: 'voter-counts',
          headers: VOTER_TEMPLATE_HEADERS,
          rows: rows.map((r) => [
            String(r.ps_name),
            Number(r.booth_no),
            String(r.name_hindi),
            Number(r.ps_ward_no),
            Number(r.zp_ward_no),
            null,
            null,
            null,
            null,
          ]),
        },
      ]);
      report.line(`Wrote ${booths} booth rows to ${out}`);
      report.line(
        'Fill voters_male, voters_female, voters_other (may be empty = 0) and voters_total.',
      );
    }
  } catch (err) {
    reportFailure(report, err);
  }
  return { ...(await finishReport(ctx, report, startedAt, false)), booths };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { out: { type: 'string' } },
    'npm run export:voter-template [-- --out <xlsx>]',
  );
  return runExportVoterTemplate(
    { out: values.out === undefined ? undefined : resolveUserPath(values.out) },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
