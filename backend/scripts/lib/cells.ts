import type { Report } from './report.js';
import type { SheetRow } from './xlsx.js';

/** Required text cell. Reports an error and returns null when empty. */
export function requireText(row: SheetRow, column: string, report: Report): string | null {
  const value = row.cells[column] ?? null;
  if (value === null) {
    report.error(`"${column}" is empty`, row.rowNumber);
    return null;
  }
  return String(value);
}

export function optionalText(row: SheetRow, column: string): string | null {
  const value = row.cells[column] ?? null;
  return value === null ? null : String(value);
}

function toInteger(value: string | number): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** Whole number >= min (min is 1 for "positive", 0 for "non-negative"). */
export function requireInt(
  row: SheetRow,
  column: string,
  report: Report,
  min: 0 | 1,
): number | null {
  const value = row.cells[column] ?? null;
  if (value === null) {
    report.error(`"${column}" is empty`, row.rowNumber);
    return null;
  }
  return checkInt(value, row, column, report, min);
}

/** Like requireInt, but an empty cell gives `fallback`. */
export function optionalInt(
  row: SheetRow,
  column: string,
  report: Report,
  min: 0 | 1,
  fallback: number,
): number | null {
  const value = row.cells[column] ?? null;
  return value === null ? fallback : checkInt(value, row, column, report, min);
}

function checkInt(
  value: string | number,
  row: SheetRow,
  column: string,
  report: Report,
  min: 0 | 1,
): number | null {
  const n = toInteger(value);
  if (n === null || n < min) {
    const rule = min === 1 ? 'a whole number greater than 0' : 'a whole number (0 or more)';
    report.error(`"${column}" must be ${rule}, got "${String(value)}"`, row.rowNumber);
    return null;
  }
  return n;
}
