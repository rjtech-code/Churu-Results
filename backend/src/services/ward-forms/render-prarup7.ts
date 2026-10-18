// Prarup-7 on ONE A4 landscape page: header, result statement, declaration and signature block
// (the printed form uses two pages). Layout only: words, sizes and widths come from the template.
import type { Page } from '../pdf/document.js';
import type { FitStep } from '../pdf/fit.js';
import { columnsBlock, gridBlock, renderOnePage, textBlock } from '../pdf/flow.js';
import type { Block } from '../pdf/flow.js';
import type { GridCell, GridSpec } from '../pdf/grid.js';
import type { Align } from '../pdf/typesetter.js';
import type { Prarup7Data, Prarup7Row } from './form-data.js';
import { fullWidth, gapAt, styler, tableGrid, textCell } from './layout.js';
import type { Styler } from './layout.js';
import { PLACEHOLDER } from './templates/prarup7.template.js';
import type { Prarup7Template } from './templates/types.js';

/** Grid columns of the result table: 1, 2, 3, (क)-(च), 5, 6, 7, 8 of the printed form. */
const COL = {
  ward: 0,
  uncontested: 1,
  contested: 2,
  particulars: 3,
  votes: 9,
  rejected: 10,
  lot: 11,
  remarks: 12,
} as const;
const PARTICULAR_COLUMNS = 6;
/** Head rows of the result table; the candidates start below them. */
const HEAD_ROW = { heads: 0, letters: 1, particularHeads: 2, numbers: 3 } as const;
const FIRST_BODY_ROW = 4;
/** The printed column numbers 1..8 sit on these columns; number 4 spans (क)-(च). */
const NUMBERED_COLUMNS = [
  COL.ward,
  COL.uncontested,
  COL.contested,
  COL.particulars,
  COL.votes,
  COL.rejected,
  COL.lot,
  COL.remarks,
];
/** Declaration table: heads, numbers, the winner's row. */
const DECLARATION_ROW = { heads: 0, numbers: 1, winner: 2 } as const;
const DECLARATION_ROWS = 3;
/** Declaration table columns that hold running text (left-aligned). */
const DECLARATION_TEXT_COLUMNS = new Set([1, 2]);

/** What every block of one fit step needs. */
interface Ctx {
  page: Page;
  t: Prarup7Template;
  s: Styler<keyof Prarup7Template['style']>;
  g: (gap: number) => number;
  step: FitStep;
}

function resultHead({ t, s }: Ctx): GridCell[] {
  const c = t.text.columns;
  const head = (col: number, text: string) =>
    textCell(HEAD_ROW.heads, col, text, s('columnHead'), { rowSpan: HEAD_ROW.numbers });
  const sub = (row: number, texts: readonly string[]) =>
    texts.map((text, i) => textCell(row, COL.particulars + i, text, s('columnHead')));
  return [
    head(COL.ward, c.ward),
    head(COL.uncontested, c.uncontested),
    head(COL.contested, c.contested),
    textCell(HEAD_ROW.heads, COL.particulars, c.particulars, s('columnHead'), {
      colSpan: PARTICULAR_COLUMNS,
    }),
    ...sub(HEAD_ROW.letters, c.letters),
    ...sub(HEAD_ROW.particularHeads, c.particularHeads),
    head(COL.votes, c.votes),
    head(COL.rejected, c.rejected),
    head(COL.lot, c.lot),
    head(COL.remarks, c.remarks),
    ...NUMBERED_COLUMNS.map((col, i) =>
      textCell(HEAD_ROW.numbers, col, t.text.columnNumbers[i] ?? null, s('columnNumber'), {
        colSpan: col === COL.particulars ? PARTICULAR_COLUMNS : 1,
      }),
    ),
  ];
}

function resultRow(row: number, r: Prarup7Row, { s }: Ctx): GridCell[] {
  const p = r.particulars;
  const left = { align: 'left' as const };
  const centred = [p.category, p.education, p.age, p.occupation, p.heldPanchSarpanch];
  return [
    textCell(row, COL.contested, r.contested, s('cell'), left),
    textCell(row, COL.particulars, p.address, s('cell'), left),
    ...centred.map((v, i) => textCell(row, COL.particulars + 1 + i, v, s('cell'))),
    textCell(row, COL.votes, r.votes, s('cell')),
    textCell(row, COL.lot, null, s('cell')),
    textCell(row, COL.remarks, null, s('cell')),
  ];
}

/** Columns 1, 2 and 6 are one cell for the whole ward. */
function wardCells(d: Prarup7Data, { t, s }: Ctx): GridCell[] {
  const rowSpan = d.rows.length;
  const uncontested = d.contested
    ? t.text.none
    : d.rows.map((r) => r.uncontested).join(t.formats.lineBreak);
  return [
    {
      row: FIRST_BODY_ROW,
      col: COL.ward,
      rowSpan,
      paragraphs: [
        { text: d.wardNo, style: s('wardNo') },
        { text: d.reservation, style: s('cell') },
      ],
    },
    textCell(FIRST_BODY_ROW, COL.uncontested, uncontested, s('cell'), {
      rowSpan,
      align: d.contested ? 'center' : 'left',
    }),
    textCell(FIRST_BODY_ROW, COL.rejected, d.rejected, s('cell'), { rowSpan }),
  ];
}

function resultTable(d: Prarup7Data, c: Ctx): GridSpec {
  const cells = [
    ...resultHead(c),
    ...wardCells(d, c),
    ...d.rows.flatMap((r, i) => resultRow(FIRST_BODY_ROW + i, r, c)),
  ];
  return tableGrid(c.t.table, c.page.width, c.step, FIRST_BODY_ROW + d.rows.length, cells);
}

function declarationTable(d: Prarup7Data, { t, s, page, step }: Ctx): GridSpec {
  const tx = t.text;
  const dc = d.declaration;
  const winner = [
    tx.declarationSerial,
    dc.office,
    dc.nameAndAddress.join(t.formats.lineBreak),
    dc.gender,
    dc.category,
    d.wardNoPadded,
    null,
  ];
  const cells = [
    ...tx.declarationColumns.map((h, col) =>
      textCell(DECLARATION_ROW.heads, col, h, s('columnHead')),
    ),
    ...tx.declarationNumbers.map((n, col) =>
      textCell(DECLARATION_ROW.numbers, col, n, s('columnNumber')),
    ),
    ...winner.map((text, col) =>
      textCell(DECLARATION_ROW.winner, col, text, s('declarationCell'), {
        align: DECLARATION_TEXT_COLUMNS.has(col) ? 'left' : 'center',
      }),
    ),
  ];
  return tableGrid(t.declarationTable, page.width, step, DECLARATION_ROWS, cells);
}

/** The header line: each item wraps inside its own slot, so a long PS list never overlaps. */
function headerLine(d: Prarup7Data, { t, s, page }: Ctx, after: number): Block {
  const items = t.text.header;
  const slots = items.map((item, i) => {
    const value = d.header[item.value];
    const end = items[i + 1]?.at ?? 1;
    const text = value === null ? item.label : t.formats.labelled(item.label, value);
    return [
      textBlock(page, text, s('header'), {
        x: page.left + page.width * item.at,
        width: page.width * (end - item.at) - t.headerGutter,
        align: 'left',
        after: 0,
      }),
    ];
  });
  return columnsBlock(slots, after);
}

/** स्थान / दिनांक (blank for hand filling) on the left, the Returning Officer's block on the right. */
function footer(d: Prarup7Data, { t, s, page, g }: Ctx): Block {
  const split = page.width * t.footerSplit;
  const line = (text: string, x: number, width: number, align: Align) =>
    textBlock(page, text, s('footer'), { x, width, align, after: g(t.gaps.footerLine) });
  const left = [t.text.place, t.text.date].map((text) => line(text, page.left, split, 'left'));
  // Empty lines stay as blank lines, for hand filling.
  const right = [...t.text.signature, d.signaturePlace ?? ''].map((text) =>
    line(text, page.left + split, page.width - split, 'center'),
  );
  return columnsBlock([left, right], 0);
}

function prarup7Blocks(d: Prarup7Data, t: Prarup7Template, page: Page, step: FitStep): Block[] {
  const c: Ctx = { page, t, step, s: styler(t.style, step, t.minFontSize), g: gapAt(step) };
  const { s, g } = c;
  const gaps = t.gaps;
  const sentence = t.text.declaration.replace(PLACEHOLDER.ward, d.wardNoPadded);
  return [
    textBlock(page, t.text.form, s('form'), fullWidth(page, 'center', g(gaps.form))),
    textBlock(page, t.text.rules, s('rules'), fullWidth(page, 'center', g(gaps.rules))),
    textBlock(page, t.text.heading, s('heading'), fullWidth(page, 'center', g(gaps.heading))),
    textBlock(page, t.text.office, s('office'), fullWidth(page, 'left', g(gaps.office))),
    headerLine(d, c, g(gaps.header)),
    gridBlock(page, resultTable(d, c), page.left, g(gaps.table)),
    textBlock(page, sentence, s('declaration'), fullWidth(page, 'left', g(gaps.declaration))),
    gridBlock(page, declarationTable(d, c), page.left, g(gaps.declarationTable)),
    footer(d, c),
  ];
}

export function renderPrarup7(data: Prarup7Data, t: Prarup7Template): Promise<Buffer> {
  return renderOnePage(t, (page, step) => prarup7Blocks(data, t, page, step));
}
