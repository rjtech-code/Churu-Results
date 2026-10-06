import ExcelJS from 'exceljs';
import type { CellValue } from 'exceljs';
import { normalizeText } from './text.js';

export type Cell = string | number | null;

export interface SheetRow {
  rowNumber: number;
  /** Values keyed by the column names the caller asked for. */
  cells: Readonly<Record<string, Cell>>;
  /** Text of every non-empty cell in the row (for checks such as "contains EXAMPLE"). */
  allText: readonly string[];
}

export type ReadSheetResult =
  { ok: true; sheetName: string; rows: SheetRow[] } | { ok: false; error: string };

function headerKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

/** Converts any exceljs cell value to trimmed NFC text, a number, or null. */
export function toCell(value: CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const text = normalizeText(value);
    return text === '' ? null : text;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if ('richText' in value) return toCell(value.richText.map((part) => part.text).join(''));
  if ('formula' in value || 'sharedFormula' in value) return toCell(value.result ?? null);
  if ('error' in value) return `#ERROR ${value.error}`;
  if ('hyperlink' in value) return toCell(value.text);
  return null;
}

/**
 * Reads the first worksheet whose header row (row 1) contains every required column.
 * Columns are matched by header name (case-insensitive), never by position.
 */
export async function readSheet(
  file: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Promise<ReadSheetResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(file);
  } catch (err) {
    return {
      ok: false,
      error: `Cannot read "${file}" as an .xlsx file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const problems: string[] = [];
  for (const sheet of workbook.worksheets) {
    const positions = new Map<string, number[]>();
    sheet.getRow(1).eachCell((cell, col) => {
      const text = toCell(cell.value);
      if (text === null) return;
      const key = headerKey(String(text));
      positions.set(key, [...(positions.get(key) ?? []), col]);
    });

    const missing = required.filter((name) => !positions.has(headerKey(name)));
    if (missing.length > 0) {
      problems.push(`sheet "${sheet.name}" is missing column(s): ${missing.join(', ')}`);
      continue;
    }
    const wanted = [...required, ...optional];
    const duplicated = wanted.filter((name) => (positions.get(headerKey(name))?.length ?? 0) > 1);
    if (duplicated.length > 0) {
      return {
        ok: false,
        error: `Sheet "${sheet.name}" has the column(s) ${duplicated.join(', ')} more than once.`,
      };
    }

    const rows: SheetRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: Record<string, Cell> = {};
      for (const name of wanted) {
        const col = positions.get(headerKey(name))?.[0];
        cells[name] = col === undefined ? null : toCell(row.getCell(col).value);
      }
      const allText: string[] = [];
      row.eachCell((cell) => {
        const value = toCell(cell.value);
        if (value !== null) allText.push(String(value));
      });
      if (allText.length === 0) continue; // fully empty row
      rows.push({ rowNumber: r, cells, allText });
    }
    return { ok: true, sheetName: sheet.name, rows };
  }

  return {
    ok: false,
    error: `No sheet has all required columns (${required.join(', ')}). ${problems.join('; ')}.`,
  };
}

/** Writes a simple one-sheet workbook with a bold, frozen header row. */
export async function writeSheet(
  file: string,
  sheets: readonly {
    name: string;
    headers: readonly string[];
    rows: readonly (readonly Cell[])[];
  }[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Churu results portal';
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow([...spec.headers]);
    sheet.getRow(1).font = { bold: true };
    for (const row of spec.rows) sheet.addRow([...row]);
    spec.headers.forEach((header, i) => {
      const width = Math.min(
        60,
        Math.max(header.length, ...spec.rows.map((r) => String(r[i] ?? '').length)) + 2,
      );
      sheet.getColumn(i + 1).width = width;
    });
  }
  await workbook.xlsx.writeFile(file);
}
