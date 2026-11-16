// "अंतिम परिणाम हेतु चेक मीमो" — the officer's final-result check memo as a printable Excel sheet,
// built to the officer's own template (docs: Book1.xlsx):
//
//   कार्यालय रिटर्निंग अधिकारी, चूरू            (merged across every column)
//   जिला परिषद् आम चुनाव, 2026 / पंचायत समिति आम चुनाव, 2026
//   पंचायत समिति — <name>                      (PS wards only)
//   अंतिम परिणाम हेतु चेक मीमो
//   <ward no.> | polling booth number | one column per candidate | NOTA | TOTAL | REJECTED PB | (G+H)
//   A | B | C | …                               (the column-letter row the officers read along)
//   one row per booth, ward no. on the first booth row only
//   PB VOTES                                     (the ward's postal entry)
//   कुल योग                                      (all booths + the PB row)
//
// Layout only: every number comes in through CheckMemoData (check-memo.data.ts), which reads the
// same ward detail the DM report shows, so this memo can never disagree with the reports. A booth
// with no entry yet stays visibly EMPTY here — never 0.
import ExcelJS from 'exceljs';

/** The font every cell uses, so Devanagari renders on the officers' machines. */
const FONT = 'Nirmala UI';

/** A4 landscape (a ward may have 20 candidates), fitted to one page wide. */
const PAGE_SETUP = {
  paperSize: 9,
  orientation: 'landscape',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  horizontalCentered: true,
  margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
} as unknown as Partial<ExcelJS.PageSetup>;

const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

export interface CheckMemoBooth {
  /** The booth label from booth-no.ts ("12", "12A"). */
  boothNo: string;
  /** The Panchayat Samiti this booth belongs to (a ZP ward may span several). */
  psName: string;
  /** False while no live entry exists: the row stays empty instead of showing zeros. */
  entered: boolean;
  /** One per candidate column, in ballot order; the last one is NOTA. */
  votes: readonly number[];
  /** The sheet total the RO typed. */
  total: number | null;
}

export interface CheckMemoData {
  kind: 'PS' | 'ZP';
  wardNo: number;
  /** The ward's Panchayat Samiti (PS wards), named in its own heading line. */
  psName: string | null;
  /** Candidate names in ballot order (NOTA is not one of them: it has its own column). */
  candidates: readonly string[];
  /** In booth order; for a ZP ward grouped by Panchayat Samiti (see `multiPs`). */
  booths: readonly CheckMemoBooth[];
  /** A ZP ward whose booths come from more than one Panchayat Samiti. */
  multiPs: boolean;
  postal: {
    entered: boolean;
    votes: readonly number[];
    total: number | null;
    /** postal_entry.rejected_count — the officer may leave it unfilled. */
    rejected: number | null;
  };
}

/** Excel's column letters: 1 = A … 26 = Z, 27 = AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const HEAD_OFFICE = 'कार्यालय रिटर्निंग अधिकारी, चूरू';
const TITLE = 'अंतिम परिणाम हेतु चेक मीमो';
const ELECTION = { ZP: 'जिला परिषद् आम चुनाव, 2026', PS: 'पंचायत समिति आम चुनाव, 2026' } as const;
const SUM_HEADER = 'विधिमान्य एवं ख़ारिज मतपत्रों का योग (G+H)';
const PB_ROW = 'PB VOTES';
const TOTAL_ROW = 'कुल योग';

interface Columns {
  /** 1-based column numbers. */
  ward: number;
  booth: number;
  firstCandidate: number;
  nota: number;
  total: number;
  rejected: number;
  sum: number;
  last: number;
}

function columnsOf(candidates: number): Columns {
  const firstCandidate = 3;
  const nota = firstCandidate + candidates;
  return {
    ward: 1,
    booth: 2,
    firstCandidate,
    nota,
    total: nota + 1,
    rejected: nota + 2,
    sum: nota + 3,
    last: nota + 3,
  };
}

/** Every cell of a row in the table gets the same box, so the printed sheet is a real table. */
function boxRow(ws: ExcelJS.Worksheet, row: number, last: number, bold = false): void {
  for (let c = 1; c <= last; c++) {
    const cell = ws.getCell(row, c);
    cell.border = BORDER;
    cell.font = { name: FONT, size: 11, bold };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c <= 2 ? 'center' : 'right',
      wrapText: true,
    };
  }
}

function headingLine(ws: ExcelJS.Worksheet, row: number, last: number, text: string, size: number) {
  ws.mergeCells(row, 1, row, last);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: FONT, size, bold: true };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

/** The check memo of one ward as .xlsx bytes. */
export async function renderCheckMemoXlsx(data: CheckMemoData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Churu ZP-PS Results';
  const ws = wb.addWorksheet('चेक मीमो', { pageSetup: PAGE_SETUP, views: [{ state: 'normal' }] });
  const col = columnsOf(data.candidates.length);
  const last = col.last;

  // ---- heading block (merged across every column, centred)
  ws.mergeCells(1, 1, 2, last);
  const office = ws.getCell(1, 1);
  office.value = HEAD_OFFICE;
  office.font = { name: FONT, size: 14, bold: true };
  office.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  let row = 3;
  headingLine(ws, row++, last, ELECTION[data.kind], 12);
  if (data.kind === 'PS' && data.psName !== null) {
    headingLine(ws, row++, last, `पंचायत समिति — ${data.psName}`, 12);
  }
  headingLine(ws, row++, last, TITLE, 13);

  // ---- header row, then the column-letter row
  const headerRow = row++;
  const header = [
    data.kind === 'ZP' ? 'zp ward no.' : 'ps ward no.',
    'polling booth number',
    ...data.candidates,
    'NOTA',
    'TOTAL',
    'REJECTED PB',
    SUM_HEADER,
  ];
  header.forEach((text, i) => {
    ws.getCell(headerRow, i + 1).value = text;
  });
  boxRow(ws, headerRow, last, true);
  for (let c = 1; c <= last; c++) {
    ws.getCell(headerRow, c).alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
  }
  ws.getRow(headerRow).height = 46;

  const letterRow = row++;
  for (let c = 1; c <= last; c++) ws.getCell(letterRow, c).value = columnLetter(c);
  boxRow(ws, letterRow, last, true);
  for (let c = 1; c <= last; c++) {
    ws.getCell(letterRow, c).alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // ---- one row per booth (the ward number on the first booth row only)
  const sumFormula = (r: number) => ({
    formula: `${columnLetter(col.total)}${String(r)}+${columnLetter(col.rejected)}${String(r)}`,
  });
  const dataRows: number[] = [];
  let firstBoothRow = 0;
  let currentPs: string | null = null;
  for (const booth of data.booths) {
    // A ZP ward can span several Panchayat Samitis, and booth numbers start again in each of them:
    // a sub-heading row names the Panchayat Samiti the booths below belong to.
    if (data.multiPs && booth.psName !== currentPs) {
      currentPs = booth.psName;
      ws.mergeCells(row, 1, row, last);
      const cell = ws.getCell(row, 1);
      cell.value = `पंचायत समिति — ${booth.psName}`;
      cell.font = { name: FONT, size: 11, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      for (let c = 1; c <= last; c++) ws.getCell(row, c).border = BORDER;
      row++;
    }
    if (firstBoothRow === 0) {
      firstBoothRow = row;
      ws.getCell(row, col.ward).value = data.wardNo;
    }
    ws.getCell(row, col.booth).value = booth.boothNo;
    if (booth.entered) {
      booth.votes.forEach((v, i) => {
        ws.getCell(row, col.firstCandidate + i).value = v;
      });
      if (booth.total !== null) ws.getCell(row, col.total).value = booth.total;
      ws.getCell(row, col.sum).value = sumFormula(row);
    }
    boxRow(ws, row, last);
    dataRows.push(row);
    row++;
  }

  // ---- the ward's postal entry
  const pbRow = row++;
  ws.getCell(pbRow, col.booth).value = PB_ROW;
  if (data.postal.entered) {
    data.postal.votes.forEach((v, i) => {
      ws.getCell(pbRow, col.firstCandidate + i).value = v;
    });
    if (data.postal.total !== null) ws.getCell(pbRow, col.total).value = data.postal.total;
    if (data.postal.rejected !== null) ws.getCell(pbRow, col.rejected).value = data.postal.rejected;
    ws.getCell(pbRow, col.sum).value = sumFormula(pbRow);
  }
  boxRow(ws, pbRow, last, true);
  dataRows.push(pbRow);

  // ---- कुल योग: every booth plus the postal row, so the memo can verify the final result
  const totalRow = row;
  ws.getCell(totalRow, col.booth).value = TOTAL_ROW;
  const cells = (c: number) => dataRows.map((r) => `${columnLetter(c)}${String(r)}`).join(',');
  for (let c = col.firstCandidate; c <= col.rejected; c++) {
    ws.getCell(totalRow, c).value = { formula: `SUM(${cells(c)})` };
  }
  ws.getCell(totalRow, col.sum).value = sumFormula(totalRow);
  boxRow(ws, totalRow, last, true);

  // ---- widths: the numbers stay narrow, names wrap instead of being cut off
  ws.getColumn(col.ward).width = 12;
  ws.getColumn(col.booth).width = 24;
  for (let c = col.firstCandidate; c < col.nota; c++) ws.getColumn(c).width = 18;
  ws.getColumn(col.nota).width = 10;
  ws.getColumn(col.total).width = 12;
  ws.getColumn(col.rejected).width = 14;
  ws.getColumn(col.sum).width = 20;
  ws.pageSetup.printArea = `A1:${columnLetter(last)}${String(totalRow)}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
