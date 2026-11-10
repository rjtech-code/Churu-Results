// प्रारूप–14 भाग–II on one A4 portrait page (two for a very long ballot), ward sheet or booth sheet: header, the candidate-wise
// votes, the verification lines (blank for hand filling), date / place / supervisor, the agents'
// table (blank) and the officer's signature block. Layout only: words and sizes come from the template.
import type { Page } from '../pdf/document.js';
import type { FitStep } from '../pdf/fit.js';
import { columnsBlock, gap, gridBlock, renderOneOrTwoPages, textBlock } from '../pdf/flow.js';
import type { Block } from '../pdf/flow.js';
import type { TextStyle } from '../pdf/fonts.js';
import type { GridCell, GridSpec } from '../pdf/grid.js';
import type { Part2Data } from './form-data.js';
import { fullWidth, gapAt, styler, tableGrid, textCell } from './layout.js';
import type { Styler } from './layout.js';
import { part2SignatureTitle } from './templates/part2.template.js';
import type { Part2Template } from './templates/types.js';

const HEADER_ROW = 0;
const FIRST_BODY_ROW = 1;
const COL = { serial: 0, name: 1, votes: 2 } as const;

interface Ctx {
  page: Page;
  t: Part2Template;
  s: Styler<keyof Part2Template['style']>;
  g: (gap: number) => number;
  step: FitStep;
}

const leftText = (c: Ctx, text: string, style: TextStyle, after: number): Block =>
  textBlock(c.page, text, style, fullWidth(c.page, 'left', after));

/** "label   value" on one line; the value (bold) starts at slots.value and wraps in its slot. */
function labelled(c: Ctx, label: string, value: string | null, after: number): Block {
  const { page, t, s } = c;
  const at = page.width * t.slots.value;
  return columnsBlock(
    [
      [textBlock(page, label, s('body'), { x: page.left, width: at - 4, align: 'left', after: 0 })],
      [
        textBlock(page, value ?? '', s('value'), {
          x: page.left + at,
          width: page.width - at,
          align: 'left',
          after: 0,
        }),
      ],
    ],
    after,
  );
}

function votesTable(d: Part2Data, c: Ctx): GridSpec {
  const { t, s, page, step } = c;
  const centre = { align: 'center' as const };
  const body: [string, string, TextStyle, string][] = [
    ...d.rows.map((r): [string, string, TextStyle, string] => [
      r.serial,
      r.name,
      s('name'),
      r.votes,
    ]),
    [d.notaSerial, t.text.nota, s('cell'), d.nota],
  ];
  const totalRow = FIRST_BODY_ROW + body.length;
  const cells: GridCell[] = [
    ...t.text.headers.map((h, col) => textCell(HEADER_ROW, col, h, s('header'), centre)),
    ...body.flatMap(([serial, name, style, votes], i) => [
      textCell(FIRST_BODY_ROW + i, COL.serial, serial, s('cell'), centre),
      textCell(FIRST_BODY_ROW + i, COL.name, name, style, { align: 'left' }),
      textCell(FIRST_BODY_ROW + i, COL.votes, votes, s('name'), centre),
    ]),
    textCell(totalRow, COL.serial, t.text.total, s('header'), { align: 'left', colSpan: 2 }),
    textCell(totalRow, COL.votes, d.total, s('name'), centre),
  ];
  return tableGrid(t.table, page.width, step, totalRow + 1, cells);
}

function agentsTable(c: Ctx): GridSpec {
  const { t, s, page, step } = c;
  const centre = { align: 'center' as const };
  const cells: GridCell[] = [
    ...t.text.agentHeaders.map((h, col) => textCell(HEADER_ROW, col, h, s('header'), centre)),
    // Every cell drawn (blank ones too), so each row is fully ruled for hand writing.
    ...Array.from({ length: t.text.agentRows }, (_, i) => [
      textCell(FIRST_BODY_ROW + i, COL.serial, String(i + 1), s('cell'), centre),
      textCell(FIRST_BODY_ROW + i, COL.name, null, s('cell')),
      textCell(FIRST_BODY_ROW + i, COL.votes, null, s('cell')),
    ]).flat(),
  ];
  return tableGrid(t.agentsTable, page.width, step, FIRST_BODY_ROW + t.text.agentRows, cells);
}

/** दिनांक, then स्थान on the left with the supervisor's signature on the right. */
function datePlace(d: Part2Data, c: Ctx): Block[] {
  const { page, t, s, g } = c;
  const right = page.width * t.slots.right;
  const line = (label: string, value: string | null, after: number) =>
    columnsBlock(
      [
        [textBlock(page, label, s('body'), { x: page.left, width: 60, align: 'left', after: 0 })],
        [
          textBlock(page, value ?? '', s('value'), {
            x: page.left + 62,
            width: right - 70,
            align: 'left',
            after: 0,
          }),
        ],
      ],
      after,
    );
  return [
    line(t.text.date, d.date, g(t.gaps.date)),
    columnsBlock(
      [
        [line(t.text.place, d.place, 0)],
        [
          textBlock(page, t.text.supervisor, s('heading'), {
            x: page.left + right,
            width: page.width - right,
            align: 'center',
            after: 0,
          }),
        ],
      ],
      g(t.gaps.place),
    ),
  ];
}

/** A fixed band for the pen signature, then the officer's title (by ward kind) and पदनाम एवं सील. */
function officer(d: Part2Data, c: Ctx): Block[] {
  const { page, t, s } = c;
  const right = page.width * t.slots.right;
  const at = { x: page.left + right, width: page.width - right, align: 'left' as const };
  return [
    gap(t.signatureSpace),
    textBlock(page, `${part2SignatureTitle(d.kind)} ${t.text.signatureOf}`, s('heading'), {
      ...at,
      after: 3,
    }),
    textBlock(page, t.text.seal, s('heading'), { ...at, after: 0 }),
  ];
}

function part2Parts(d: Part2Data, t: Part2Template, page: Page, step: FitStep): [Block[], Block[]] {
  const c: Ctx = { page, t, step, s: styler(t.style, step, t.minFontSize), g: gapAt(step) };
  const { s, g } = c;
  const gaps = t.gaps;
  const centred = (text: string, key: keyof Part2Template['style'], after: number) =>
    textBlock(page, text, s(key), fullWidth(page, 'center', after));
  return [
    [
      centred(t.text.form, 'form', g(gaps.form)),
      centred(t.text.rules, 'rules', g(gaps.rules)),
      centred(t.text.title, 'title', g(gaps.title)),
      centred(t.text.part, 'part', g(gaps.part)),
      leftText(c, t.text.details, s('heading'), g(gaps.details)),
      labelled(c, t.text.bodyName[d.kind], d.bodyName, g(gaps.line)),
      labelled(c, t.text.wardNo, d.wardNo, g(gaps.line)),
      labelled(c, t.text.booth, d.booth, g(gaps.line)),
      leftText(c, t.text.candidates, s('heading'), g(gaps.candidates)),
      gridBlock(page, votesTable(d, c), page.left, g(gaps.table)),
      leftText(c, t.text.verification, s('heading'), g(gaps.verification)),
      leftText(c, `${t.text.tallyQuestion}  ${t.text.tallyAnswer}`, s('body'), g(gaps.tally)),
      leftText(c, t.text.discrepancy, s('body'), g(gaps.tally) * 4),
    ],
    [
      ...datePlace(d, c),
      leftText(c, t.text.agents, s('heading'), g(gaps.agents)),
      gridBlock(page, agentsTable(c), page.left, g(gaps.agentsTable)),
      ...officer(d, c),
    ],
  ];
}

/**
 * One page whenever it fits. A very long ballot gets two: the votes and the verification lines on
 * page 1; date / place, the agents' table and the officer's block together on page 2.
 */
export function renderPart2(data: Part2Data, t: Part2Template): Promise<Buffer> {
  return renderOneOrTwoPages(t, {
    onePage: (page, step) => part2Parts(data, t, page, step).flat(),
    twoPages: (page, step) => part2Parts(data, t, page, step),
  });
}
