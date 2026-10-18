// A ruled table of cells on a fixed column grid, with row and column spans: measured first (row
// heights from the wrapped text), then drawn. No DB, no form knowledge.
import type { TextStyle } from './fonts.js';
import type { Align, Box, Typesetter } from './typesetter.js';

/** A piece of cell text in one style; a null text prints nothing (a blank). */
export interface Paragraph {
  text: string | null;
  style: TextStyle;
}

export interface GridCell {
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  /** Stacked top to bottom; none (or only blanks) = an empty cell, still ruled. */
  paragraphs: readonly Paragraph[];
  align?: Align;
}

export interface GridSpec {
  colWidths: readonly number[];
  rowCount: number;
  cells: readonly GridCell[];
  padX: number;
  padY: number;
  /** Every row is at least this tall (blank rows for hand filling). */
  minRowHeight: number;
  lineWidth: number;
}

const span = (n: number | undefined) => n ?? 1;

function cellWidth(spec: GridSpec, cell: GridCell): number {
  return spec.colWidths
    .slice(cell.col, cell.col + span(cell.colSpan))
    .reduce((sum, w) => sum + w, 0);
}

interface SetParagraph {
  lines: string[];
  style: TextStyle;
  height: number;
}

function setCell(ts: Typesetter, spec: GridSpec, cell: GridCell): SetParagraph[] {
  const width = cellWidth(spec, cell) - 2 * spec.padX;
  return cell.paragraphs.flatMap((p) => {
    if (p.text === null) return [];
    const lines = ts.wrap(p.text, width, p.style);
    return [{ lines, style: p.style, height: ts.blockHeight(lines.length, p.style) }];
  });
}

const setHeight = (set: readonly SetParagraph[]): number =>
  set.reduce((sum, p) => sum + p.height, 0);

/** Relative widths scaled to `total` pt. */
export function scaleWidths(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  return weights.map((w) => (w / sum) * total);
}

/**
 * Row heights: each row fits its single-row cells; a cell spanning rows that still needs more room
 * makes the last of its rows taller.
 */
export function measureGrid(ts: Typesetter, spec: GridSpec): number[] {
  const heights = Array.from({ length: spec.rowCount }, () => spec.minRowHeight);
  const bySpan = [...spec.cells].sort((a, b) => span(a.rowSpan) - span(b.rowSpan));
  for (const cell of bySpan) {
    const needed = setHeight(setCell(ts, spec, cell)) + 2 * spec.padY;
    const last = cell.row + span(cell.rowSpan) - 1;
    const have = heights.slice(cell.row, last + 1).reduce((sum, h) => sum + h, 0);
    if (needed > have) heights[last] = (heights[last] ?? 0) + needed - have;
  }
  return heights;
}

export const gridHeight = (rowHeights: readonly number[]): number =>
  rowHeights.reduce((sum, h) => sum + h, 0);

const offsets = (sizes: readonly number[], start: number): number[] =>
  sizes.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? start) + s], [start]);

/** Draws the cells (rule + text) with the measured row heights; (x, y) is the top-left corner. */
export function drawGrid(
  ts: Typesetter,
  spec: GridSpec,
  x: number,
  y: number,
  rowHeights: readonly number[],
): void {
  const xs = offsets(spec.colWidths, x);
  const ys = offsets(rowHeights, y);
  ts.doc.lineWidth(spec.lineWidth);
  for (const cell of spec.cells) {
    const left = xs[cell.col] ?? x;
    const top = ys[cell.row] ?? y;
    const width = (xs[cell.col + span(cell.colSpan)] ?? left) - left;
    const height = (ys[cell.row + span(cell.rowSpan)] ?? top) - top;
    ts.doc.rect(left, top, width, height).stroke();
    drawCellText(ts, spec, cell, { x: left, y: top, width, height });
  }
}

function drawCellText(ts: Typesetter, spec: GridSpec, cell: GridCell, rect: Box): void {
  const set = setCell(ts, spec, cell);
  const inner = rect.height - 2 * spec.padY;
  // Text is centred vertically in its cell, as on the printed form.
  let y = rect.y + spec.padY + (inner - setHeight(set)) / 2;
  for (const p of set) {
    const box = { x: rect.x + spec.padX, y, width: rect.width - 2 * spec.padX };
    ts.drawBlock(p.lines, box, p.style, cell.align ?? 'center');
    y += p.height;
  }
}
