// A one-page pdfkit document with the fonts registered, and its bytes once drawn.
import PDFDocument from 'pdfkit';
import { loadDevaFonts, registerDevaFonts } from './fonts.js';
import type { LatinFamily } from './fonts.js';
import { Typesetter } from './typesetter.js';

export interface PageSpec {
  size: 'A4';
  layout: 'portrait' | 'landscape';
  /** Blank border on every side, in pt. */
  margin: number;
}

export interface Page {
  ts: Typesetter;
  /** The printable area inside the margins. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A document with exactly one page; nothing ever adds a second (no automatic text flow). */
export async function openPage(spec: PageSpec, latin: LatinFamily, title: string): Promise<Page> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: { Title: title, Producer: 'Churu Results' },
  });
  registerDevaFonts(doc, await loadDevaFonts());
  doc.addPage({ size: spec.size, layout: spec.layout, margin: 0 });
  return {
    ts: new Typesetter(doc, latin),
    left: spec.margin,
    top: spec.margin,
    width: doc.page.width - 2 * spec.margin,
    height: doc.page.height - 2 * spec.margin,
  };
}

/** Ends the document and returns its bytes. */
export function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    doc.end();
  });
}
