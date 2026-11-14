// प्रारूप–14 भाग–II as a printable Excel sheet (.xlsx), beside the PDF of render-part2.ts.
//
// It takes the SAME `Part2Data` (map-part2.ts) and the SAME `Part2Template` (part2.template.ts) as
// the PDF, so every number and every printed word — including the officer's title by ward kind
// (रिटर्निंग अधिकारी for a PS ward, सहायक रिटर्निंग अधिकारी for a ZP ward) — is identical by
// construction. Nothing is read, added up or worded here.
//
// Layout only: a header block, the candidate-wise votes in ballot order, NOTA, the total, the
// verification lines, दिनांक / स्थान, the blank agents' table and the signature block. A4 portrait,
// fitted to one page wide. Hindi is written as UTF-8 text with a Devanagari font (Nirmala UI, with
// Mangal as the usual fallback on older machines).
import ExcelJS from 'exceljs';
import type { Part2Data } from './form-data.js';
import { part2SignatureTitle } from './templates/part2.template.js';
import type { Part2Template } from './templates/types.js';

/** The font every cell uses, so Devanagari renders on the officers' machines. */
const FONT = 'Nirmala UI';

/**
 * A4 portrait, fitted to one page wide. Built as one object and typed at the end: ExcelJS.PaperSize
 * is an ambient const enum, so 9 (A4) cannot be written as PaperSize.A4 here.
 */
const PAGE_SETUP = {
  paperSize: 9,
  orientation: 'portrait',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  horizontalCentered: true,
  margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
} as unknown as Partial<ExcelJS.PageSetup>;

const COL = { serial: 1, name: 2, votes: 3 } as const;
const LAST_COL = 3;

interface Style {
  size: number;
  bold?: boolean | undefined;
}

const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

interface Sheet {
  ws: ExcelJS.Worksheet;
  t: Part2Template;
  /** The next row to write. */
  row: number;
}

function font(s: Style): Partial<ExcelJS.Font> {
  return { name: FONT, size: s.size, bold: s.bold === true };
}

/** One line across the whole width. */
function line(
  sh: Sheet,
  text: string,
  style: Style,
  align: 'left' | 'center',
  opts: { wrap?: boolean; height?: number } = {},
): void {
  const row = sh.ws.getRow(sh.row);
  const cell = row.getCell(COL.serial);
  cell.value = text;
  cell.font = font(style);
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: opts.wrap === true };
  sh.ws.mergeCells(sh.row, COL.serial, sh.row, LAST_COL);
  if (opts.height !== undefined) row.height = opts.height;
  sh.row += 1;
}

/** "label" over the first two columns, its value (bold) in the third. */
function labelled(sh: Sheet, label: string, value: string | null, style: Style): void {
  const row = sh.ws.getRow(sh.row);
  const left = row.getCell(COL.serial);
  left.value = label;
  left.font = font(style);
  left.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  sh.ws.mergeCells(sh.row, COL.serial, sh.row, COL.name);
  const right = row.getCell(COL.votes);
  right.value = value ?? '';
  right.font = font(sh.t.style.value);
  right.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  sh.row += 1;
}

function blank(sh: Sheet, rows = 1): void {
  sh.row += rows;
}

/** One bordered table row; `value` is a number when it is a vote count. */
function tableRow(
  sh: Sheet,
  cells: readonly [string | null, string | null, string | number | null],
  styles: readonly [Style, Style, Style],
  opts: { centreName?: boolean } = {},
): void {
  const row = sh.ws.getRow(sh.row);
  const nameAlign = opts.centreName === true ? 'center' : 'left';
  const columns: readonly {
    col: number;
    value: string | number | null;
    style: Style;
    align: 'left' | 'center';
    wrap: boolean;
  }[] = [
    { col: COL.serial, value: cells[0], style: styles[0], align: 'center', wrap: false },
    { col: COL.name, value: cells[1], style: styles[1], align: nameAlign, wrap: true },
    { col: COL.votes, value: cells[2], style: styles[2], align: 'center', wrap: false },
  ];
  for (const c of columns) {
    const cell = row.getCell(c.col);
    cell.value = c.value;
    cell.font = font(c.style);
    cell.alignment = { horizontal: c.align, vertical: 'middle', wrapText: c.wrap };
    cell.border = BORDER;
  }
  sh.row += 1;
}

/** The total row: the label across the first two columns, the number in the third. */
function totalRow(sh: Sheet, label: string, total: string): void {
  const row = sh.ws.getRow(sh.row);
  const left = row.getCell(COL.serial);
  left.value = label;
  left.font = font(sh.t.style.header);
  left.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  left.border = BORDER;
  sh.ws.getRow(sh.row).getCell(COL.name).border = BORDER;
  sh.ws.mergeCells(sh.row, COL.serial, sh.row, COL.name);
  const right = row.getCell(COL.votes);
  right.value = numberOf(total);
  right.font = font(sh.t.style.name);
  right.alignment = { horizontal: 'center', vertical: 'middle' };
  right.border = BORDER;
  sh.row += 1;
}

/** Vote strings are written as numbers so the sheet adds up; anything else stays text. */
function numberOf(text: string): number | string {
  return /^\d+$/.test(text) ? Number(text) : text;
}

/** दिनांक / स्थान on the left, the counting supervisor's line on the right. */
function footerLine(
  sh: Sheet,
  label: string,
  value: string | null,
  right: string | null,
  t: Part2Template,
): void {
  const row = sh.ws.getRow(sh.row);
  const a = row.getCell(COL.serial);
  a.value = label;
  a.font = font(t.style.body);
  a.alignment = { horizontal: 'left', vertical: 'middle' };
  const b = row.getCell(COL.name);
  b.value = value ?? '';
  b.font = font(t.style.value);
  b.alignment = { horizontal: 'left', vertical: 'middle' };
  if (right !== null) {
    const c = row.getCell(COL.votes);
    c.value = right;
    c.font = font(t.style.heading);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  sh.row += 1;
}

/**
 * The whole form. `data` and `t` are exactly what renderPart2 (PDF) is given.
 */
export async function renderPart2Xlsx(data: Part2Data, t: Part2Template): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Churu results portal';
  workbook.title = t.title;
  const ws = workbook.addWorksheet('Prarup-14', { pageSetup: PAGE_SETUP });
  ws.getColumn(COL.serial).width = 10;
  ws.getColumn(COL.name).width = 46;
  ws.getColumn(COL.votes).width = 30;
  const sh: Sheet = { ws, t, row: 1 };
  const text = t.text;

  // ---- header block
  line(sh, text.form, t.style.form, 'center');
  line(sh, text.rules, t.style.rules, 'center');
  line(sh, text.title, t.style.title, 'center');
  line(sh, text.part, t.style.part, 'center');
  blank(sh);

  // ---- निर्वाचन का विवरण
  line(sh, text.details, t.style.heading, 'left');
  labelled(sh, text.bodyName[data.kind], data.bodyName, t.style.body);
  labelled(sh, text.wardNo, data.wardNo, t.style.body);
  labelled(sh, text.booth, data.booth, t.style.body);
  blank(sh);

  // ---- votes
  line(sh, text.candidates, t.style.heading, 'left');
  tableRow(
    sh,
    [text.headers[0], text.headers[1], text.headers[2]],
    [t.style.header, t.style.header, t.style.header],
    { centreName: true },
  );
  for (const r of data.rows) {
    tableRow(sh, [r.serial, r.name, numberOf(r.votes)], [t.style.cell, t.style.name, t.style.name]);
  }
  tableRow(
    sh,
    [data.notaSerial, text.nota, numberOf(data.nota)],
    [t.style.cell, t.style.cell, t.style.name],
  );
  totalRow(sh, text.total, data.total);
  blank(sh);

  // ---- verification (blank for hand filling, as on the PDF)
  line(sh, text.verification, t.style.heading, 'left');
  line(sh, `${text.tallyQuestion}  ${text.tallyAnswer}`, t.style.body, 'left', {
    wrap: true,
    height: 32,
  });
  line(sh, text.discrepancy, t.style.body, 'left', { wrap: true });
  blank(sh, 3);

  // ---- दिनांक / स्थान and the supervisor
  footerLine(sh, text.date, data.date, null, t);
  footerLine(sh, text.place, data.place, text.supervisor, t);
  blank(sh);

  // ---- agents (blank, fully ruled)
  line(sh, text.agents, t.style.heading, 'left', { wrap: true });
  tableRow(
    sh,
    [text.agentHeaders[0], text.agentHeaders[1], text.agentHeaders[2]],
    [t.style.header, t.style.header, t.style.header],
    { centreName: true },
  );
  for (let i = 1; i <= text.agentRows; i++) {
    tableRow(sh, [String(i), null, null], [t.style.cell, t.style.cell, t.style.cell]);
  }
  blank(sh, 2);

  // ---- the officer's signature block
  const title = sh.ws.getRow(sh.row).getCell(COL.votes);
  title.value = `${part2SignatureTitle(data.kind)} ${text.signatureOf}`;
  title.font = font(t.style.heading);
  title.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  sh.row += 1;
  const seal = sh.ws.getRow(sh.row).getCell(COL.votes);
  seal.value = text.seal;
  seal.font = font(t.style.heading);
  seal.alignment = { horizontal: 'left', vertical: 'middle' };

  const data_ = await workbook.xlsx.writeBuffer();
  return Buffer.from(data_);
}
