// CLI adapters over the shared cell rules (src/services/master-data/cells.ts): same rules, the
// problems go straight into the script's Report in English.
import * as shared from '../../src/services/master-data/cells.js';
import { IssueList } from '../../src/services/master-data/issues.js';
import { reportIssues } from '../../src/services/master-data/issues-en.js';
import type { Report } from './report.js';
import type { SheetRow } from './xlsx.js';

function withReport<T>(report: Report, check: (issues: IssueList) => T): T {
  const issues = new IssueList();
  const value = check(issues);
  reportIssues(report, issues);
  return value;
}

/** Required text cell. Reports an error and returns null when empty. */
export function requireText(row: SheetRow, column: string, report: Report): string | null {
  return withReport(report, (issues) => shared.requireText(row, column, issues));
}

export const optionalText = shared.optionalText;

/** Whole number >= min (min is 1 for "positive", 0 for "non-negative"). */
export function requireInt(
  row: SheetRow,
  column: string,
  report: Report,
  min: 0 | 1,
): number | null {
  return withReport(report, (issues) => shared.requireInt(row, column, issues, min));
}

/** Like requireInt, but an empty cell gives `fallback`. */
export function optionalInt(
  row: SheetRow,
  column: string,
  report: Report,
  min: 0 | 1,
  fallback: number,
): number | null {
  return withReport(report, (issues) => shared.optionalInt(row, column, issues, min, fallback));
}
