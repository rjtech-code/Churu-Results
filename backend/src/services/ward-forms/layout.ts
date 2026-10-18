// Layout helpers shared by the ward-form renderers (Part-II, Prarup-7): styles, gaps and tables at
// one fit step, plain text cells and full-width text. Pure; no DB.
import type { Page } from '../pdf/document.js';
import type { FitStep } from '../pdf/fit.js';
import { styleAt } from '../pdf/flow.js';
import type { TextStyle } from '../pdf/fonts.js';
import type { GridCell, GridSpec } from '../pdf/grid.js';
import { scaleWidths } from '../pdf/grid.js';
import type { Align } from '../pdf/typesetter.js';
import type { TableLayout } from './templates/types.js';

/** A template style by name, at this step's size. */
export type Styler<K extends string> = (key: K) => TextStyle;

export const styler =
  <K extends string>(
    styles: Readonly<Record<K, TextStyle>>,
    step: FitStep,
    min: number,
  ): Styler<K> =>
  (key) =>
    styleAt(styles[key], step, min);

/** A template gap (pt) at this step's spacing. */
export const gapAt =
  (step: FitStep) =>
  (gap: number): number =>
    gap * step.spacing;

/** A cell holding one text (null = blank) in one style. */
export const textCell = (
  row: number,
  col: number,
  text: string | null,
  style: TextStyle,
  extra: Partial<GridCell> = {},
): GridCell => ({ row, col, paragraphs: [{ text, style }], ...extra });

/** A ruled table `width` pt wide, padding and row height at this step's spacing. */
export function tableGrid(
  layout: TableLayout,
  width: number,
  step: FitStep,
  rowCount: number,
  cells: readonly GridCell[],
): GridSpec {
  return {
    colWidths: scaleWidths(layout.widths, width),
    rowCount,
    cells,
    padX: layout.padX,
    padY: layout.padY * step.spacing,
    minRowHeight: layout.minRowHeight * step.spacing,
    lineWidth: layout.lineWidth,
  };
}

/** Text across the whole printable width. */
export const fullWidth = (page: Page, align: Align, after: number) => ({
  x: page.left,
  width: page.width,
  align,
  after,
});
