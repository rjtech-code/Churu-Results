import type { Pool, PoolConnection } from 'mysql2/promise';
import type { AuditActor } from './audit.js';
import { ScriptError, describeDbError } from './db.js';
import { saveReportText } from './report.js';
import type { Report } from './report.js';

/** Everything a script needs from the outside world; tests pass their own. */
export interface ScriptContext {
  pool: Pool;
  reportsDir: string;
  /** AES key for the encrypted RO password copies (users:create, users:reset-password). */
  roPasswordKey: Buffer;
  /** Terminal output. */
  out: (text: string) => void;
  /** Asks a question on the terminal and returns the typed answer. */
  confirm: (question: string) => Promise<string>;
  now: () => Date;
  /** Who did it, for the audit rows. Left out by the CLI (user_id NULL = script). */
  actor?: AuditActor;
  /**
   * An open transaction to join instead of starting one (Super Admin full reset: several runners
   * in ONE transaction). The caller commits or rolls back; the runner never does.
   */
  joinConnection?: PoolConnection;
}

export interface ScriptResult {
  ok: boolean;
  committed: boolean;
  reportPath: string;
  /** The report's error and warning lines (the Super Admin panel shows them). */
  errors: readonly string[];
  warnings: readonly string[];
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
  return {
    ok: report.isOk(),
    committed,
    reportPath,
    errors: [...report.errors],
    warnings: [...report.warnings],
  };
}
