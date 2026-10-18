// A one-page form as a top-to-bottom list of blocks (each knows its height and how to draw itself).
// The same list is measured for each fit step, then drawn once with the first step that fits, so
// measuring and drawing can never disagree.
import { finish, openPage } from './document.js';
import type { Page, PageSpec } from './document.js';
import { FormDoesNotFitError, firstFit, scaledSize } from './fit.js';
import type { FitStep } from './fit.js';
import type { LatinFamily, TextStyle } from './fonts.js';
import { drawGrid, gridHeight, measureGrid } from './grid.js';
import type { GridSpec } from './grid.js';
import type { Align } from './typesetter.js';

export interface Block {
  height: number;
  draw: (top: number) => void;
}

export interface OnePageTemplate {
  title: string;
  page: PageSpec;
  latin: LatinFamily;
  fitSteps: readonly FitStep[];
  minFontSize: number;
}

/** Builds the form's blocks for one step (sizes and spacing already scaled). */
export type BuildBlocks = (page: Page, step: FitStep) => Block[];

const totalHeight = (blocks: readonly Block[]): number =>
  blocks.reduce((sum, b) => sum + b.height, 0);

/** Renders `build` on exactly one page with the first fitting step; else FormDoesNotFitError. */
export async function renderOnePage(t: OnePageTemplate, build: BuildBlocks): Promise<Buffer> {
  const page = await openPage(t.page, t.latin, t.title);
  const step = firstFit(t.fitSteps, (s) => totalHeight(build(page, s)), page.height);
  if (step === null) throw new FormDoesNotFitError(t.title);
  let top = page.top;
  for (const block of build(page, step)) {
    block.draw(top);
    top += block.height;
  }
  return finish(page.ts.doc);
}

/** A style at this step's size (never below the template's minimum). */
export const styleAt = (style: TextStyle, step: FitStep, min: number): TextStyle => ({
  ...style,
  size: scaledSize(style.size, step, min),
});

/** Empty space. */
export const gap = (height: number): Block => ({ height, draw: () => undefined });

/** Wrapped text across `width` from `x`, then `after` pt of space. */
export function textBlock(
  page: Page,
  text: string,
  style: TextStyle,
  opts: { x: number; width: number; align: Align; after: number },
): Block {
  const lines = page.ts.wrap(text, opts.width, style);
  const height = page.ts.blockHeight(lines.length, style);
  return {
    height: height + opts.after,
    draw: (top) => {
      page.ts.drawBlock(lines, { x: opts.x, y: top, width: opts.width }, style, opts.align);
    },
  };
}

/** Pieces of text on one line, each in its own slot (x, width, alignment). */
export function lineBlock(
  page: Page,
  items: readonly { text: string; x: number; width: number; align: Align }[],
  style: TextStyle,
  after: number,
): Block {
  return {
    height: page.ts.lineHeight(style) + after,
    draw: (top) => {
      for (const item of items)
        page.ts.drawLine(item.text, item.x, top, item.width, item.align, style);
    },
  };
}

/** A ruled table at `x`, then `after` pt of space. */
export function gridBlock(page: Page, spec: GridSpec, x: number, after: number): Block {
  const rows = measureGrid(page.ts, spec);
  return {
    height: gridHeight(rows) + after,
    draw: (top) => {
      drawGrid(page.ts, spec, x, top, rows);
    },
  };
}

/** A horizontal rule from `x` across `width`. */
export function ruleBlock(
  page: Page,
  x: number,
  width: number,
  lineWidth: number,
  after: number,
): Block {
  return {
    height: lineWidth + after,
    draw: (top) => {
      page.ts.doc
        .lineWidth(lineWidth)
        .moveTo(x, top)
        .lineTo(x + width, top)
        .stroke();
    },
  };
}

/** Blocks side by side (each column flows down from the same top); as tall as the tallest. */
export function columnsBlock(columns: readonly (readonly Block[])[], after: number): Block {
  const height = Math.max(0, ...columns.map(totalHeight));
  return {
    height: height + after,
    draw: (top) => {
      for (const column of columns) {
        let y = top;
        for (const block of column) {
          block.draw(y);
          y += block.height;
        }
      }
    },
  };
}
