// सारणी-"क" / सारणी-"ख" as the officer's own printable sheet: the merged title rows, the dark
// header band, the numbered row (1 2 3 4 5) under it, bordered data rows and the signature block.
// Layout only — every value comes in through Sarni (sarni.ts).
import ExcelJS from 'exceljs';
import type { Sarni } from './sarni.js';

/** The font every cell uses, so Devanagari renders on the officers' machines. */
const FONT = 'Nirmala UI';
const LAST_COL = 5;

/** A4 portrait, fitted to one page wide; the two header rows repeat on every printed page. */
const PAGE_SETUP = {
  paperSize: 9,
  orientation: 'portrait',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  horizontalCentered: true,
  margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
} as unknown as Partial<ExcelJS.PageSetup>;

const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FF2E3B52' },
};
const NUM_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFE8EAEF' },
};

const HEADERS: readonly string[] = [
  'क्र.सं.',
  'निर्वाचन क्षेत्र\nसंख्याक',
  'निर्वाचन क्षेत्र का वर्गीकरण\n(अ.जा./अ.ज.जा./अ.पि.व.\n/महिला/सामान्य)',
  'निर्वाचित सदस्य\nका नाम',
  'संबद्ध मान्यता प्राप्त\nराजनैतिक दल का नाम',
];
// Column A is 10, not the default 9: ExcelJS leaves a default-width column out of the file, and
// the printed sheet should carry every width it was given.
const WIDTHS: readonly number[] = [10, 22, 34, 30, 34];
const TITLE = { ZP: 'सारणी- "क"', PS: 'सारणी- "ख"' } as const;
const SIGN = 'हस्ताक्षर रिटर्निंग अधिकारी';
const SIGN_SUB = 'मय नाम, पदनाम एवं मोहर सहित';
const DISTRICT = 'चूरू';

/** One merged, centred line across the table. */
function titleRow(
  ws: ExcelJS.Worksheet,
  row: number,
  value: string,
  size: number,
  underline = false,
) {
  ws.mergeCells(row, 1, row, LAST_COL);
  const cell = ws.getCell(row, 1);
  cell.value = value;
  cell.font = { name: FONT, size, bold: true, underline };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
}

/**
 * Sarni_K_ZP.xlsx / Sarni_Kh_<PS>.xlsx. The Panchayat Samiti's ENGLISH name is used (and reduced to
 * letters and digits): a file name travels in an HTTP header, where Devanagari cannot go — the ST
 * Format downloads name their files the same way.
 */
export function sarniFileName(data: Sarni, psNameEnglish: string | null): string {
  if (data.kind === 'ZP') return 'Sarni_K_ZP.xlsx';
  const safe = (psNameEnglish ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Sarni_Kh_${safe === '' ? 'PS' : safe}.xlsx`;
}

export async function writeSarni(data: Sarni): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Churu ZP-PS Results';
  const ws = wb.addWorksheet(data.kind === 'ZP' ? 'सारणी क' : 'सारणी ख', {
    pageSetup: PAGE_SETUP,
  });
  let row = 1;
  titleRow(ws, row++, TITLE[data.kind], 14, true);
  if (data.kind === 'ZP') {
    titleRow(ws, row++, 'सदस्य जिला परिषद', 13);
  } else {
    // The template's two numbered lines, filled from the system instead of left as dots.
    for (const [n, label, value] of [
      ['1.', 'जिला', DISTRICT],
      ['2.', 'सदस्य पंचायत समिति', data.psName ?? ''],
    ] as const) {
      ws.mergeCells(row, 1, row, LAST_COL);
      const cell = ws.getCell(row, 1);
      cell.value = `${n}  ${label}   ${value}`;
      cell.font = { name: FONT, size: 12, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      row++;
    }
  }
  ws.getRow(row++).height = 8; // the blank line the template leaves above the table

  // ---- the dark header band
  const headerRow = row++;
  HEADERS.forEach((text, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = text;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEAD_FILL;
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(headerRow).height = 58;

  // ---- the numbered row (1 2 3 4 5)
  const numberRow = row++;
  for (let c = 1; c <= LAST_COL; c++) {
    const cell = ws.getCell(numberRow, c);
    cell.value = c;
    cell.font = { name: FONT, size: 11, bold: true };
    cell.fill = NUM_FILL;
    cell.border = BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  // Both header rows repeat when the table runs past one printed page.
  ws.pageSetup.printTitlesRow = `${String(headerRow)}:${String(numberRow)}`;

  // ---- one row per ward
  for (const r of data.rows) {
    const values: (string | number)[] = [
      r.serial,
      r.wardNo,
      r.classification ?? '',
      r.memberName,
      r.partyName,
    ];
    values.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v === '' ? null : v;
      cell.font = { name: FONT, size: 11 };
      cell.border = BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i <= 1 ? 'center' : 'left',
        wrapText: true,
      };
    });
    ws.getRow(row).height = 24;
    row++;
  }

  // ---- the signature block
  row++;
  ws.mergeCells(row, 3, row, LAST_COL);
  const sign = ws.getCell(row, 3);
  sign.value = SIGN;
  sign.font = { name: FONT, size: 12, bold: true };
  sign.alignment = { vertical: 'middle', horizontal: 'center' };
  row++;
  ws.mergeCells(row, 3, row, LAST_COL);
  const sub = ws.getCell(row, 3);
  sub.value = SIGN_SUB;
  sub.font = { name: FONT, size: 10 };
  sub.alignment = { vertical: 'middle', horizontal: 'center' };

  WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  ws.pageSetup.printArea = `A1:E${String(row)}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
