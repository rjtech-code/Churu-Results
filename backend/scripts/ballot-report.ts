// npm run ballot:report [-- --ps <name>] [-- --out <xlsx>]
// Printable ballot list for the two-person cross-check against the official list.
import type { RowDataPacket } from 'mysql2/promise';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { loadPanchayatSamitis, loadWards } from './lib/lookups.js';
import type { WardRow } from './lib/lookups.js';
import { resolveUserPath } from './lib/paths.js';
import { Report, istStamp } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey } from './lib/text.js';
import type { Cell } from './lib/xlsx.js';
import { writeSheet } from './lib/xlsx.js';
import { join } from 'node:path';

export const BALLOT_REPORT_HEADERS = [
  'ward_no',
  'ward_id',
  'reservation_category',
  'locked',
  'ballot_position',
  'name_hindi',
  'party',
  'gender',
  'nota',
  'unopposed',
] as const;

/** Excel sheet names: max 31 chars, no []:*?/\ characters, unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name
    .replace(/ PANCHAYAT SAMITI$/i, '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .slice(0, 31)
    .trim();
  let candidate = base;
  for (let i = 2; used.has(candidate.toUpperCase()); i++) candidate = `${base.slice(0, 27)} (${i})`;
  used.add(candidate.toUpperCase());
  return candidate;
}

export async function runBallotReport(
  options: { ps?: string | undefined; out?: string | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult & { outFile: string | null; sheets: string[] }> {
  const startedAt = ctx.now();
  const report = new Report('ballot-report', 'read-only');
  const outFile = options.out ?? join(ctx.reportsDir, `ballot-report-${istStamp(startedAt)}.xlsx`);
  const sheets: { name: string; headers: readonly string[]; rows: Cell[][] }[] = [];
  try {
    const psByName = await loadPanchayatSamitis(ctx.pool);
    let onlyPs: number | null = null;
    if (options.ps !== undefined) {
      const ps = psByName.get(matchKey(options.ps));
      if (!ps) report.error(`Unknown Panchayat Samiti "${options.ps}"`);
      else onlyPs = ps.id;
    }
    const wards = await loadWards(ctx.pool);
    const [candidates] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT c.ward_id, c.ballot_position, c.name_hindi, c.gender, c.is_nota,
              p.short_name, p.name_hindi AS party_hindi
         FROM candidate c LEFT JOIN party p ON p.id = c.party_id
        ORDER BY c.ward_id, c.ballot_position`,
    );
    const byWard = new Map<number, RowDataPacket[]>();
    for (const c of candidates)
      byWard.set(Number(c.ward_id), [...(byWard.get(Number(c.ward_id)) ?? []), c]);

    const rowsFor = (list: WardRow[]): Cell[][] => {
      const rows: Cell[][] = [];
      for (const w of list) {
        const base: Cell[] = [
          w.ward_no,
          w.id,
          w.reservation_category,
          w.is_locked === 1 ? 'LOCKED' : 'open',
        ];
        const cands = byWard.get(w.id) ?? [];
        if (cands.length === 0) rows.push([...base, null, 'NO CANDIDATES', null, null, null, null]);
        for (const c of cands) {
          const nota = Number(c.is_nota) === 1;
          rows.push([
            ...base,
            Number(c.ballot_position),
            String(c.name_hindi),
            nota
              ? null
              : c.short_name === null
                ? 'निर्दलीय (independent)'
                : `${String(c.short_name)} — ${String(c.party_hindi)}`,
            c.gender === null ? null : String(c.gender),
            nota ? 'NOTA' : null,
            w.is_unopposed === 1 ? 'UNOPPOSED' : null,
          ]);
        }
      }
      return rows;
    };

    if (report.isOk()) {
      const used = new Set<string>();
      for (const ps of psByName.values()) {
        if (onlyPs !== null && ps.id !== onlyPs) continue;
        const list = wards.filter((w) => w.ward_type === 'PS' && w.panchayat_samiti_id === ps.id);
        sheets.push({
          name: sheetName(ps.name_english, used),
          headers: BALLOT_REPORT_HEADERS,
          rows: rowsFor(list),
        });
        report.line(`${ps.name_english}: ${list.length} PS wards`);
      }
      if (onlyPs === null) {
        const zp = wards.filter((w) => w.ward_type === 'ZP');
        sheets.push({
          name: sheetName('ZP', used),
          headers: BALLOT_REPORT_HEADERS,
          rows: rowsFor(zp),
        });
        report.line(`ZP: ${zp.length} ZP wards`);
      }
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
