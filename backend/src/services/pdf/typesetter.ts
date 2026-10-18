// Measures, wraps and draws mixed Hindi / Latin text on a pdfkit page: each script run in its own
// font, all on one baseline. No DB, no form knowledge.
import { BASELINE_EM, LINE_HEIGHT_EM, fontName } from './fonts.js';
import type { LatinFamily, TextStyle } from './fonts.js';
import { splitRuns } from './text-runs.js';

export type Align = 'left' | 'center' | 'right';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Typesetter {
  constructor(
    readonly doc: PDFKit.PDFDocument,
    private readonly latin: LatinFamily,
  ) {}

  width(text: string, style: TextStyle): number {
    let total = 0;
    for (const run of splitRuns(text)) {
      this.doc.font(fontName(run.script, style, this.latin)).fontSize(style.size);
      total += this.doc.widthOfString(run.text);
    }
    return total;
  }

  lineHeight(style: TextStyle): number {
    return style.size * LINE_HEIGHT_EM;
  }

  /** Lines that fit `width` (greedy, at spaces; '\n' starts a new line). A longer word overflows. */
  wrap(text: string, width: number, style: TextStyle): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ').filter((w) => w !== '')) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (line !== '' && this.width(candidate, style) > width) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  blockHeight(lineCount: number, style: TextStyle): number {
    return lineCount * this.lineHeight(style);
  }

  /** One line; `top` is the top of its line box. */
  drawLine(
    text: string,
    x: number,
    top: number,
    width: number,
    align: Align,
    style: TextStyle,
  ): void {
    const free = width - this.width(text, style);
    let cursor = x + (align === 'center' ? free / 2 : align === 'right' ? free : 0);
    const baseline = top + style.size * BASELINE_EM;
    for (const run of splitRuns(text)) {
      this.doc.font(fontName(run.script, style, this.latin)).fontSize(style.size);
      this.doc.text(run.text, cursor, baseline, { lineBreak: false, baseline: 'alphabetic' });
      cursor += this.doc.widthOfString(run.text);
    }
  }

  /** Lines one under the other from the top of `box`, each aligned across its width. */
  drawBlock(
    lines: readonly string[],
    box: Omit<Box, 'height'>,
    style: TextStyle,
    align: Align,
  ): void {
    let top = box.y;
    for (const line of lines) {
      this.drawLine(line, box.x, top, box.width, align, style);
      top += this.lineHeight(style);
    }
  }
}
