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

/** Why a sheet could not be read; `error` is the English text the CLI prints. */
export type SheetFailure =
  | { kind: 'UNREADABLE' }
  | { kind: 'DUPLICATE_COLUMNS'; columns: string[] }
  | { kind: 'MISSING_COLUMNS'; columns: string[] };

export type ReadSheetResult =
  | { ok: true; sheetName: string; rows: SheetRow[] }
  | { ok: false; error: string; failure: SheetFailure };

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
      failure: { kind: 'UNREADABLE' },
    };
  }
  return pickSheet(workbook, required, optional);
}

/**
 * Reads the worksheet with exactly this name (header row 1, columns by name like readSheet).
 * Returns null when the workbook has no such sheet, so callers can tell formats apart.
 */
export async function readNamedSheet(
  file: string,
  sheetName: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Promise<ReadSheetResult | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(file);
  } catch (err) {
    return {
      ok: false,
      error: `Cannot read "${file}" as an .xlsx file: ${err instanceof Error ? err.message : String(err)}`,
      failure: { kind: 'UNREADABLE' },
    };
  }
  const sheet = workbook.getWorksheet(sheetName);
  if (sheet === undefined) return null;
  return pickSheet(workbook, required, optional, [sheet]);
}

/** English text (CLI/logs only; the web shows the Hindi text for failure.kind). */
const UNREADABLE_UPLOAD = 'Cannot read the file as an .xlsx file.';

/** Same as readSheet, for an uploaded file already in memory (checked by assertXlsxUpload first). */
export async function readSheetFromBuffer(
  data: Buffer,
  required: readonly string[],
  optional: readonly string[] = [],
): Promise<ReadSheetResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's typings want its own Buffer type; a Node Buffer is what it reads.
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: UNREADABLE_UPLOAD, failure: { kind: 'UNREADABLE' } };
  }
  return pickSheet(workbook, required, optional);
}

function pickSheet(
  workbook: ExcelJS.Workbook,
  required: readonly string[],
  optional: readonly string[],
  sheets: readonly ExcelJS.Worksheet[] = workbook.worksheets,
): ReadSheetResult {
  const problems: string[] = [];
  let missingColumns: string[] = [...required];
  for (const sheet of sheets) {
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
      if (missing.length < missingColumns.length) missingColumns = missing;
      continue;
    }
    const wanted = [...required, ...optional];
    const duplicated = wanted.filter((name) => (positions.get(headerKey(name))?.length ?? 0) > 1);
    if (duplicated.length > 0) {
      return {
        ok: false,
        error: `Sheet "${sheet.name}" has the column(s) ${duplicated.join(', ')} more than once.`,
        failure: { kind: 'DUPLICATE_COLUMNS', columns: duplicated },
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
    failure: { kind: 'MISSING_COLUMNS', columns: missingColumns },
  };
}

export interface SheetDropdown {
  /** The header the dropdown belongs to. */
  column: string;
  /** An Excel list formula: '"PS,ZP"' or a range such as 'lists!$A$1:$A$13'. */
  formula: string;
  /** How many data rows (below the header) get the dropdown. */
  rows: number;
}

export interface SheetSpec {
  name: string;
  headers: readonly string[];
  rows: readonly (readonly Cell[])[];
  /** Excel filter dropdowns on the header row. */
  autoFilter?: boolean;
  /** A bold red line ABOVE the header (e.g. a confidentiality warning); the header moves to row 2. */
  notice?: string;
  /** In-cell dropdown lists for data entry (templates). */
  dropdowns?: readonly SheetDropdown[];
  /** A helper sheet (e.g. the values behind a dropdown), hidden from the officer. */
  hidden?: boolean;
}

function buildWorkbook(sheets: readonly SheetSpec[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Churu results portal';
  for (const spec of sheets) {
    const headerRow = spec.notice === undefined ? 1 : 2;
    const sheet = workbook.addWorksheet(spec.name, {
      views: [{ state: 'frozen', ySplit: headerRow }],
      ...(spec.hidden === true ? { state: 'hidden' as const } : {}),
    });
    if (spec.notice !== undefined) {
      sheet.addRow([spec.notice]);
      sheet.mergeCells(1, 1, 1, Math.max(1, spec.headers.length));
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFC00000' } };
      sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
      sheet.getRow(1).height = 36;
    }
    sheet.addRow([...spec.headers]);
    sheet.getRow(headerRow).font = { bold: true };
    if (spec.autoFilter === true)
      sheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow, column: spec.headers.length },
      };
    for (const row of spec.rows) sheet.addRow([...row]);
    spec.headers.forEach((header, i) => {
      const width = Math.min(
        60,
        Math.max(header.length, ...spec.rows.map((r) => String(r[i] ?? '').length)) + 2,
      );
      sheet.getColumn(i + 1).width = width;
    });
    for (const dropdown of spec.dropdowns ?? []) {
      const col = spec.headers.indexOf(dropdown.column) + 1;
      if (col === 0) throw new Error(`dropdown for unknown column ${dropdown.column}`);
      for (let r = headerRow + 1; r <= headerRow + dropdown.rows; r++) {
        sheet.getCell(r, col).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [dropdown.formula],
        };
      }
    }
  }
  return workbook;
}

/** Writes a workbook (one sheet per spec) with a bold, frozen header row. */
export async function writeSheet(file: string, sheets: readonly SheetSpec[]): Promise<void> {
  await buildWorkbook(sheets).xlsx.writeFile(file);
}

/** Same as writeSheet, in memory (for downloads). */
export async function writeSheetToBuffer(sheets: readonly SheetSpec[]): Promise<Buffer> {
  const data = await buildWorkbook(sheets).xlsx.writeBuffer();
  return Buffer.from(data);
}
