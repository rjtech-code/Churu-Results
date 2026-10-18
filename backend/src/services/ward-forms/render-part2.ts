// Part-II on one A4 page: the filled result table; every other line stays printed and blank for
// hand filling, as on the official form. Layout only: words and sizes come from the template.
import type { Page } from '../pdf/document.js';
import type { FitStep } from '../pdf/fit.js';
import { gap, gridBlock, lineBlock, renderOnePage, ruleBlock, textBlock } from '../pdf/flow.js';
import type { Block } from '../pdf/flow.js';
import type { GridSpec } from '../pdf/grid.js';
import type { Align } from '../pdf/typesetter.js';
import type { Part2Data } from './form-data.js';
import { fullWidth, gapAt, styler, tableGrid, textCell } from './layout.js';
import type { Styler } from './layout.js';
import type { Part2Template } from './templates/types.js';

/** Table columns: S. No., Name of Candidate, No. of votes recorded. */
const COL = { serial: 0, name: 1, votes: 2 } as const;
const HEADER_ROW = 0;
const FIRST_BODY_ROW = 1;

/** What every block of one fit step needs. */
interface Ctx {
  page: Page;
  t: Part2Template;
  s: Styler<keyof Part2Template['style']>;
  g: (gap: number) => number;
}

/** A piece of text in a horizontal slot of a line. */
const slot = (text: string, x: number, width: number, align: Align = 'left') => ({
  text,
  x,
  width,
  align,
});

function tableSpec(data: Part2Data, { t, s }: Ctx, step: FitStep): GridSpec {
  const body = [
    ...data.rows.map((r) => [r.serial, r.name, r.votes] as const),
    [null, t.text.nota, data.nota] as const,
    [t.text.total, null, data.total] as const,
  ];
  const cells = [
    ...t.text.headers.map((h, col) =>
      textCell(HEADER_ROW, col, h, s('header'), { align: 'center' }),
    ),
    ...body.flatMap((r, i) =>
      r.map((text, col) =>
        textCell(FIRST_BODY_ROW + i, col, text, s('cell'), {
          align: col === COL.votes ? 'center' : 'left',
        }),
      ),
    ),
  ];
  return tableGrid(t.table, t.table.width, step, FIRST_BODY_ROW + body.length, cells);
}

/** The right-hand column: Counting Supervisor, Full Signature, Returning Officer. */
const rightSlot = ({ page, t }: Ctx, text: string) =>
  slot(
    text,
    page.left + page.width * t.slots.signatureFrom,
    page.width * (1 - t.slots.signatureFrom),
    'center',
  );

/** Place / Date and the agents' heading, as on the form. */
function headBlocks(c: Ctx): Block[] {
  const { page, t, s, g } = c;
  const tx = t.text;
  const indentX = page.left + t.indent;
  const agentsX = page.left + page.width * t.slots.agentsFrom;
  return [
    lineBlock(page, [slot(tx.place, indentX, page.width)], s('body'), 0),
    lineBlock(
      page,
      [slot(tx.date, indentX, page.width), rightSlot(c, tx.supervisor)],
      s('body'),
      g(t.gaps.place),
    ),
    lineBlock(
      page,
      [
        slot(tx.agents, agentsX, page.width * t.slots.agentsWidth, 'center'),
        rightSlot(c, tx.fullSignature),
      ],
      s('body'),
      g(t.gaps.agents),
    ),
  ];
}

/** The numbered agent lines, then the dotted lines; the last one carries the RO's signature. */
function agentBlocks(c: Ctx): Block[] {
  const { page, t, s, g } = c;
  const tx = t.text;
  const indentX = page.left + t.indent;
  const line = (slots: ReturnType<typeof slot>[]) =>
    lineBlock(page, slots, s('body'), g(t.gaps.agentLine));
  const numbered = Array.from({ length: tx.agentLines }, (_, i) =>
    line([slot(t.serial(i + 1), indentX, page.width)]),
  );
  const dotted = Array.from({ length: tx.dottedLines }, (_, i) =>
    line([
      slot(tx.dots, indentX, page.width),
      ...(i === tx.dottedLines - 1 ? [rightSlot(c, tx.returningOfficer)] : []),
    ]),
  );
  return [...numbered, ...dotted];
}

function part2Blocks(data: Part2Data, t: Part2Template, page: Page, step: FitStep): Block[] {
  const c: Ctx = { page, t, s: styler(t.style, step, t.minFontSize), g: gapAt(step) };
  const { s, g } = c;
  return [
    textBlock(page, t.text.rules, s('rules'), fullWidth(page, 'center', g(t.gaps.rules))),
    textBlock(page, t.text.part, s('part'), fullWidth(page, 'center', g(t.gaps.part))),
    textBlock(page, t.text.caption, s('caption'), fullWidth(page, 'center', 0)),
    gridBlock(
      page,
      tableSpec(data, c, step),
      page.left + (page.width - t.table.width) / 2,
      g(t.gaps.table),
    ),
    textBlock(page, t.text.tally, s('body'), fullWidth(page, 'left', g(t.gaps.tally))),
    ...headBlocks(c),
    ...agentBlocks(c),
    gap(g(t.gaps.footnote)),
    ruleBlock(page, page.left, page.width, t.table.lineWidth, g(t.gaps.rule)),
    textBlock(page, t.text.footnote, s('footnote'), fullWidth(page, 'left', 0)),
  ];
}

export function renderPart2(data: Part2Data, t: Part2Template): Promise<Buffer> {
  return renderOnePage(t, (page, step) => part2Blocks(data, t, page, step));
}
