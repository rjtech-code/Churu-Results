// A multi-page report document (the one-page form helpers in flow.ts never add a page): headings,
// lines of text and long tables that continue on new pages with their header row repeated, zebra
// rows, status chips (a light fill AND the text label, so black-and-white prints stay readable), and
// a footer on every page. Reuses the Typesetter (mixed Hindi / Latin text) and the bundled fonts.
// No DB, no report knowledge.
import PDFDocument from 'pdfkit';
import { finish } from './document.js';
import { loadDevaFonts, registerDevaFonts } from './fonts.js';
import type { TextStyle } from './fonts.js';
import { Typesetter } from './typesetter.js';
import type { Align } from './typesetter.js';

export type Tone = 'ok' | 'warn' | 'info' | 'muted' | 'bad';
export interface Chip {
  text: string;
  tone: Tone;
}
/** Plain text, or chips stacked one per line. */
export type CellContent = string | readonly Chip[];

export interface Column {
  header: string;
  /** Relative width. */
  weight: number;
  align?: Align;
}

export interface TableSpec {
  /** Drawn above the table, and again (with " (continued)") on every page it continues on. */
  title: string;
  columns: readonly Column[];
  rows: readonly (readonly CellContent[])[];
  /** Rows drawn bold with a light rule above (e.g. a total row). */
  boldRows?: ReadonlySet<number>;
}

export const COLORS = {
  ink: '#1c2533',
  muted: '#5b6472',
  header: '#1f2d45',
  headerText: '#ffffff',
  zebra: '#f2f4f7',
  rule: '#d3d8df',
} as const;

const TONES: Readonly<Record<Tone, { fill: string; text: string }>> = {
  ok: { fill: '#e2f0e5', text: '#1d5a2e' },
  warn: { fill: '#faefd3', text: '#6b4e00' },
  info: { fill: '#e0eaf6', text: '#123f7a' },
  muted: { fill: '#eceef1', text: '#3f4652' },
  bad: { fill: '#f8dede', text: '#8f1010' },
};

const MARGIN_X = 30;
const MARGIN_TOP = 28;
const FOOTER_ZONE = 30;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 3.5;
const TABLE_STYLE: TextStyle = { size: 8 };
const TABLE_BOLD: TextStyle = { size: 8, bold: true };
const SECTION_STYLE: TextStyle = { size: 11, bold: true };
const FOOTER_STYLE: TextStyle = { size: 7.5 };

export class PagedDocument {
  readonly ts: Typesetter;
  private y = MARGIN_TOP;

  private constructor(readonly doc: PDFKit.PDFDocument) {
    this.ts = new Typesetter(doc, 'sans');
  }

  static async open(opts: { title: string; compress?: boolean }): Promise<PagedDocument> {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: opts.compress ?? true,
      info: { Title: opts.title, Producer: 'Churu Results' },
    });
    registerDevaFonts(doc, await loadDevaFonts());
    const paged = new PagedDocument(doc);
    paged.addPage();
    return paged;
  }

  get left(): number {
    return MARGIN_X;
  }
  get width(): number {
    return this.doc.page.width - 2 * MARGIN_X;
  }
  private get bottom(): number {
    return this.doc.page.height - FOOTER_ZONE;
  }

  private addPage(): void {
    this.doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
    this.y = MARGIN_TOP;
  }

  /** Starts a new page unless `height` still fits on this one. */
  private ensure(height: number): void {
    if (this.y + height > this.bottom) this.addPage();
  }

  /** Wrapped text across the page, then `after` pt of space. */
  text(text: string, style: TextStyle, opts: { color?: string; after?: number } = {}): void {
    const lines = this.ts.wrap(text, this.width, style);
    const height = this.ts.blockHeight(lines.length, style);
    this.ensure(height);
    this.doc.fillColor(opts.color ?? COLORS.ink);
    this.ts.drawBlock(lines, { x: this.left, y: this.y, width: this.width }, style, 'left');
    this.y += height + (opts.after ?? 0);
  }

  /** Starts a new page (unless this one is still empty). */
  pageBreak(): void {
    if (this.y > MARGIN_TOP) this.addPage();
  }

  space(height: number): void {
    this.y += height;
  }

  table(spec: TableSpec, after = 14): void {
    const total = spec.columns.reduce((s, c) => s + c.weight, 0);
    const widths = spec.columns.map((c) => (c.weight / total) * this.width);
    const header = this.measureRow(
      spec.columns.map((c) => c.header),
      widths,
      TABLE_BOLD,
    );
    const aligns = spec.columns.map((c) => c.align ?? 'left');
    const titleHeight = this.ts.lineHeight(SECTION_STYLE) + 4;
    const rows = spec.rows.map((cells, i) =>
      this.measureRow(cells, widths, spec.boldRows?.has(i) === true ? TABLE_BOLD : TABLE_STYLE),
    );

    const drawTop = (continued: boolean) => {
      this.doc.fillColor(COLORS.header);
      this.ts.drawLine(
        continued ? `${spec.title} (continued)` : spec.title,
        this.left,
        this.y,
        this.width,
        'left',
        SECTION_STYLE,
      );
      this.y += titleHeight;
      this.drawRow(header, widths, { fill: COLORS.header, color: COLORS.headerText, aligns });
    };

    // The title and header never sit alone at the bottom of a page: keep them with the first row.
    this.ensure(titleHeight + header.height + (rows[0]?.height ?? 0));
    drawTop(false);
    rows.forEach((row, i) => {
      if (this.y + row.height > this.bottom) {
        this.addPage();
        drawTop(true);
      }
      const bold = spec.boldRows?.has(i) === true;
      if (bold) {
        this.doc
          .lineWidth(0.8)
          .strokeColor(COLORS.header)
          .moveTo(this.left, this.y)
          .lineTo(this.left + this.width, this.y)
          .stroke();
      }
      this.drawRow(row, widths, {
        fill: i % 2 === 1 ? COLORS.zebra : null,
        color: COLORS.ink,
        aligns,
      });
    });
    this.y += after;
  }

  private measureRow(
    cells: readonly CellContent[],
    widths: readonly number[],
    style: TextStyle,
  ): MeasuredRow {
    const lineHeight = this.ts.lineHeight(style);
    const set = cells.map((cell, i): SetCell => {
      const inner = (widths[i] ?? 0) - 2 * CELL_PAD_X;
      if (typeof cell === 'string')
        return { kind: 'text', lines: this.ts.wrap(cell, inner, style) };
      return { kind: 'chips', chips: cell };
    });
    const lineCount = Math.max(
      1,
      ...set.map((c) => (c.kind === 'text' ? c.lines.length : c.chips.length)),
    );
    return { set, style, height: lineCount * lineHeight + 2 * CELL_PAD_Y };
  }

  private drawRow(
    row: MeasuredRow,
    widths: readonly number[],
    opts: { fill: string | null; color: string; aligns?: readonly Align[] },
  ): void {
    if (opts.fill !== null) {
      this.doc.rect(this.left, this.y, this.width, row.height).fill(opts.fill);
    }
    const lineHeight = this.ts.lineHeight(row.style);
    let x = this.left;
    row.set.forEach((cell, i) => {
      const w = widths[i] ?? 0;
      const align = opts.aligns?.[i] ?? 'left';
      const box = { x: x + CELL_PAD_X, y: this.y + CELL_PAD_Y, width: w - 2 * CELL_PAD_X };
      if (cell.kind === 'text') {
        this.doc.fillColor(opts.color);
        this.ts.drawBlock(cell.lines, box, row.style, align);
      } else {
        cell.chips.forEach((chip, n) => {
          const tone = TONES[chip.tone];
          const textWidth = this.ts.width(chip.text, row.style);
          const top = box.y + n * lineHeight;
          this.doc
            .roundedRect(box.x, top + 0.6, textWidth + 8, lineHeight - 1.2, 2.5)
            .fill(tone.fill);
          this.doc.fillColor(tone.text);
          this.ts.drawLine(chip.text, box.x + 4, top, textWidth, 'left', row.style);
        });
      }
      x += w;
    });
    this.doc
      .lineWidth(0.4)
      .strokeColor(COLORS.rule)
      .moveTo(this.left, this.y + row.height)
      .lineTo(this.left + this.width, this.y + row.height)
      .stroke();
    this.y += row.height;
  }

  /** Writes the footer (left and right text) on every page and returns the PDF bytes. */
  async finish(
    footer: (page: number, pages: number) => { left: string; right: string },
  ): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const top = this.doc.page.height - FOOTER_ZONE + 10;
      this.doc
        .lineWidth(0.4)
        .strokeColor(COLORS.rule)
        .moveTo(this.left, top - 4)
        .lineTo(this.left + this.width, top - 4)
        .stroke();
      const text = footer(i - range.start + 1, range.count);
      this.doc.fillColor(COLORS.muted);
      this.ts.drawLine(text.left, this.left, top, this.width, 'left', FOOTER_STYLE);
      this.ts.drawLine(text.right, this.left, top, this.width, 'right', FOOTER_STYLE);
    }
    return finish(this.doc);
  }
}

type SetCell = { kind: 'text'; lines: string[] } | { kind: 'chips'; chips: readonly Chip[] };
interface MeasuredRow {
  set: SetCell[];
  style: TextStyle;
  height: number;
}
