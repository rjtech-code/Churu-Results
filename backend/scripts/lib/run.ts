import type { Pool } from 'mysql2/promise';
import { ScriptError, describeDbError } from './db.js';
import { saveReportText } from './report.js';
import type { Report } from './report.js';

/** Everything a script needs from the outside world; tests pass their own. */
export interface ScriptContext {
  pool: Pool;
  reportsDir: string;
  /** Terminal output. */
  out: (text: string) => void;
  /** Asks a question on the terminal and returns the typed answer. */
  confirm: (question: string) => Promise<string>;
  now: () => Date;
}

export interface ScriptResult {
  ok: boolean;
  committed: boolean;
  reportPath: string;
}

/** Turns an exception during a run into a report error. Nothing was written (rolled back). */
export function reportFailure(report: Report, err: unknown): void {
  if (err instanceof ScriptError) {
    report.error(err.message);
  } else {
    report.error(`Stopped; nothing was written. Cause: ${describeDbError(err)}`);
  }
}

/** Prints the report, saves it under backend/reports/, and returns the outcome. */
export async function finishReport(
  ctx: ScriptContext,
  report: Report,
  startedAt: Date,
  committed: boolean,
): Promise<ScriptResult> {
  const text = report.render(startedAt, committed);
  const reportPath = await saveReportText(ctx.reportsDir, report.scriptName, startedAt, text);
  ctx.out(text);
  ctx.out(`Report saved to ${reportPath}`);
  return { ok: report.isOk(), committed, reportPath };
}
