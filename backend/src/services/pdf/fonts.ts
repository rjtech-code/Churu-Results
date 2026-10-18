// The PDF fonts: the bundled Noto Sans Devanagari (src/assets/fonts, OFL; same files as the
// frontend's) for Hindi, and the PDF's built-in Latin fonts (nothing to embed) for the rest.
import { readFile } from 'node:fs/promises';
import type { Script } from './text-runs.js';

// From src/services/pdf and from dist/services/pdf alike: <backend>/src/assets/fonts/…
const FONT_DIR = new URL('../../../src/assets/fonts/', import.meta.url);
const DEVA_FILES = {
  regular: 'NotoSansDevanagari-Regular.ttf',
  bold: 'NotoSansDevanagari-Bold.ttf',
} as const;

export type LatinFamily = 'sans' | 'serif';

export interface TextStyle {
  size: number;
  bold?: boolean;
  /** Latin text only (Devanagari has no italic). */
  italic?: boolean;
}

const LATIN: Readonly<Record<LatinFamily, readonly [string, string, string, string]>> = {
  // regular, bold, italic, bold italic
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
};
const DEVA_NAME = { regular: 'deva', bold: 'deva-bold' } as const;

/**
 * Line box in em. Noto Sans Devanagari: ascent 0.896, descent 0.408, but stacked conjuncts and
 * matras reach 1.348 / 0.558 (usWin), so lines are never set tighter than this.
 */
export const LINE_HEIGHT_EM = 1.4;
/** Baseline below the top of the line box, in em. */
export const BASELINE_EM = 0.98;

export function fontName(script: Script, style: TextStyle, latin: LatinFamily): string {
  if (script === 'deva') return style.bold === true ? DEVA_NAME.bold : DEVA_NAME.regular;
  const index = (style.bold === true ? 1 : 0) + (style.italic === true ? 2 : 0);
  return LATIN[latin][index] ?? LATIN[latin][0];
}

export interface DevaFonts {
  regular: Buffer;
  bold: Buffer;
}

let cached: Promise<DevaFonts> | null = null;

/** Read once per process. */
export function loadDevaFonts(): Promise<DevaFonts> {
  cached ??= Promise.all([
    readFile(new URL(DEVA_FILES.regular, FONT_DIR)),
    readFile(new URL(DEVA_FILES.bold, FONT_DIR)),
  ]).then(([regular, bold]) => ({ regular, bold }));
  return cached;
}

export function registerDevaFonts(doc: PDFKit.PDFDocument, fonts: DevaFonts): void {
  doc.registerFont(DEVA_NAME.regular, fonts.regular);
  doc.registerFont(DEVA_NAME.bold, fonts.bold);
}
