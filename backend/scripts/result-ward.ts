// npm run result:ward -- --ward <id>
// Read only: prints one ward's computed result (for checking by eye during testing).
import { loadWardResult } from '../src/services/result-loader.js';
import type { WardResult } from '../src/services/result.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { loadWards, wardLabel } from './lib/lookups.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

function yesNo(value: boolean): string {
  return value ? 'YES' : 'no';
}

/** The printable lines for one ward result. */
export function describeResult(label: string, r: WardResult): string[] {
  const lines = [
    `Ward:      ${label}`,
    `Status:    ${r.status}`,
    `Booths:    ${r.boothsEntered} of ${r.boothsTotal} entered; rounds seen: ${r.roundsSeen.join(', ') || '-'}`,
    `Postal:    ${r.postalEntered ? 'entered' : 'NOT entered'}${r.rejectedPostal === null ? '' : `; rejected postal ballots: ${r.rejectedPostal}`}`,
    `Valid votes: ${r.totalValidVotes} (NOTA ${r.notaVotes})`,
    '',
    `${'pos'.padStart(3)}  ${'id'.padStart(6)}  ${'booth'.padStart(8)}  ${'postal'.padStart(7)}  ${'total'.padStart(8)}  ${'rank'.padStart(4)}  name`,
  ];
  for (const c of r.candidates) {
    lines.push(
      `${String(c.ballotPosition).padStart(3)}  ${String(c.id).padStart(6)}  ${String(c.boothVotes).padStart(8)}  ` +
        `${String(c.postalVotes).padStart(7)}  ${String(c.totalVotes).padStart(8)}  ${(c.rank === null ? '-' : String(c.rank)).padStart(4)}  ` +
        `${c.nameHindi}${c.isNota ? ' [NOTA]' : ''}`,
    );
  }
  lines.push('', 'Top 3 (real candidates):');
  for (const t of r.top3) {
    lines.push(
      `  ${t.rank}. ${t.nameHindi} (id ${t.candidateId}) — ${t.totalVotes}${t.tiedWithPrevious ? '  (TIED with the row above)' : ''}`,
    );
  }
  lines.push(
    '',
    `Margin:    ${r.margin === null ? '-' : String(r.margin)}`,
    `Winner:    ${r.winnerCandidateId === null ? '- (the engine never picks a winner; only a declaration or an unopposed ward sets one)' : String(r.winnerCandidateId)}`,
    `Declaration: ${r.declaration === null ? 'none' : `version ${r.declaration.version}, ${r.declaration.status}, winner ${r.declaration.winnerCandidateId}, margin ${r.declaration.margin}`}`,
    `Flags:     topTied=${yesNo(r.topTied)}  notaHighest=${yesNo(r.notaHighest)}  declarationMismatch=${yesNo(r.declarationMismatch)}`,
  );
  return lines;
}

export async function runResultWard(
  options: { ward?: string | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('result-ward', 'read-only');
  const wardId =
    options.ward !== undefined && /^\d+$/.test(options.ward) ? Number(options.ward) : null;
  if (wardId === null)
    report.error('--ward <id> is required (a number; see npm run ballot:report).');
  else {
    try {
      const ward = (await loadWards(ctx.pool)).find((w) => w.id === wardId);
      if (!ward) report.error(`No ward with id ${wardId}.`);
      else
        report.section(
          'Result',
          describeResult(wardLabel(ward), await loadWardResult(ctx.pool, wardId)),
        );
    } catch (err) {
      reportFailure(report, err);
    }
  }
  return finishReport(ctx, report, startedAt, false);
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { ward: { type: 'string' } },
    'npm run result:ward -- --ward <id>',
  );
  return runResultWard(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
