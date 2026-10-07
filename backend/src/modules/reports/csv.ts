// CSV for Excel: UTF-8 with BOM (so Hindi shows correctly), every cell quoted, and CSV/formula
// injection blocked: a text cell starting with = + - @ (or tab / CR) gets a leading apostrophe.
export type Cell = string | number | null;

const BOM = '﻿';
const DANGEROUS = /^[=+\-@\t\r]/u;

export function csvCell(value: Cell): string {
  if (value === null) return '""';
  const text =
    typeof value === 'number' ? String(value) : DANGEROUS.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** "20261120-101502" in IST, for file names. */
export function istStampForFile(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000).toISOString(); // 2026-11-20T10:15:02.123Z (shifted)
  return `${ist.slice(0, 10).replaceAll('-', '')}-${ist.slice(11, 19).replaceAll(':', '')}`;
}
