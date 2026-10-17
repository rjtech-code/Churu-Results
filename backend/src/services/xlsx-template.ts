// Fills an official Excel template IN PLACE: the .xlsx (a zip of XML parts) is opened, only the
// cells we write and the rows we insert change, and every other part (styles, column widths, print
// setup, external links, footnotes, sheet order and names) is written back byte for byte.
// ExcelJS is not used here because a load + save of these templates loses column widths, print
// settings and external links, and does not move merged cells when rows are inserted.
import JSZip from 'jszip';

export type CellValue = string | number | null;

const xmlEscape = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const xmlUnescape = (s: string): string =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** "AB" -> 28 */
export function colNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 28 -> "AB" */
export function colName(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m?.[1] || !m[2]) throw new Error(`not a cell reference: ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

/** Shifts every row number >= `from` in a reference ("A15:I15", "$A$1:$V$17", "B9:B17") by `by`. */
function shiftRef(ref: string, from: number, by: number): string {
  return ref.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_m, col: string, row: string) => {
    const r = Number(row);
    return `${col}${String(r >= from ? r + by : r)}`;
  });
}

/** Shifts the `attr="..."` value of every `<tag ...>` in `xml`. */
function shiftAttr(xml: string, tag: string, attr: string, from: number, by: number): string {
  const re = new RegExp(`(<${tag}\\b[^>]*?\\s${attr}=")([^"]*)(")`, 'g');
  return xml.replace(
    re,
    (_m, a: string, ref: string, b: string) => a + shiftRef(ref, from, by) + b,
  );
}

interface Cell {
  col: string;
  /** Attributes other than r (style s, type t, …), as written. */
  attrs: string;
  /** The inner XML (<v>, <is>, <f>), or null for an empty cell `<c …/>`. */
  inner: string | null;
}

interface Row {
  num: number;
  /** Attributes other than r, as written. */
  attrs: string;
  cells: Cell[];
}

const attrsWithout = (attrs: string, name: string): string =>
  attrs.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), '');

function parseRows(sheetData: string): Row[] {
  const rows: Row[] = [];
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  for (const m of sheetData.matchAll(rowRe)) {
    const attrs = m[1] ?? '';
    const num = Number(/\sr="(\d+)"/.exec(attrs)?.[1]);
    if (!Number.isSafeInteger(num)) throw new Error('template row without a row number');
    const cells: Cell[] = [];
    const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    for (const c of (m[3] ?? '').matchAll(cellRe)) {
      const cAttrs = c[1] ?? '';
      const ref = /\sr="([A-Z]+\d+)"/.exec(cAttrs)?.[1];
      if (ref === undefined)
        throw new Error(`template cell without a reference in row ${String(num)}`);
      cells.push({ col: splitRef(ref).col, attrs: attrsWithout(cAttrs, 'r'), inner: c[3] ?? null });
    }
    rows.push({ num, attrs: attrsWithout(attrs, 'r'), cells });
  }
  return rows;
}

function rowXml(r: Row): string {
  const cells = r.cells
    .map((c) => {
      const ref = `${c.col}${String(r.num)}`;
      return c.inner === null
        ? `<c r="${ref}"${c.attrs}/>`
        : `<c r="${ref}"${c.attrs}>${c.inner}</c>`;
    })
    .join('');
  return cells === ''
    ? `<row r="${String(r.num)}"${r.attrs}/>`
    : `<row r="${String(r.num)}"${r.attrs}>${cells}</row>`;
}

export class TemplateSheet {
  private rows: Row[];
  private before: string;
  private after: string;
  /** Rows inserted so far, as (first new row, count), applied to the workbook's defined names. */
  readonly inserts: { from: number; by: number }[] = [];

  constructor(
    readonly name: string,
    readonly index: number,
    readonly path: string,
    xml: string,
    private readonly sharedStrings: readonly string[],
  ) {
    const start = xml.indexOf('<sheetData');
    const end = xml.indexOf('</sheetData>');
    if (start < 0 || end < 0) throw new Error(`sheet ${name}: no sheetData`);
    const open = xml.indexOf('>', start) + 1;
    this.before = xml.slice(0, open);
    this.after = xml.slice(end);
    this.rows = parseRows(xml.slice(open, end));
  }

  private row(num: number): Row {
    const r = this.rows.find((x) => x.num === num);
    if (!r) throw new Error(`sheet ${this.name}: row ${String(num)} is not in the template`);
    return r;
  }

  /** The text of a template cell (shared or inline string, or a number), trimmed; '' when empty. */
  text(ref: string): string {
    const { col, row } = splitRef(ref);
    const c = this.rows.find((x) => x.num === row)?.cells.find((x) => x.col === col);
    if (!c?.inner) return '';
    if (/\st="s"/.test(c.attrs)) {
      const i = Number(/<v>(\d+)<\/v>/.exec(c.inner)?.[1]);
      return (this.sharedStrings[i] ?? '').trim();
    }
    const texts = [...c.inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? '');
    if (texts.length > 0) return xmlUnescape(texts.join('')).trim();
    return xmlUnescape(/<v>([\s\S]*?)<\/v>/.exec(c.inner)?.[1] ?? '').trim();
  }

  /**
   * Writes a value, keeping the cell's style. null leaves the cell EMPTY (information the system
   * does not have). Strings are written inline, so sharedStrings.xml never changes.
   */
  set(ref: string, value: CellValue): void {
    const { col, row } = splitRef(ref);
    const r = this.row(row);
    let c = r.cells.find((x) => x.col === col);
    if (!c) {
      c = { col, attrs: '', inner: null };
      r.cells.push(c);
      r.cells.sort((a, b) => colNumber(a.col) - colNumber(b.col));
    }
    const attrs = attrsWithout(c.attrs, 't');
    if (value === null) {
      c.attrs = attrs;
      c.inner = null;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`sheet ${this.name} ${ref}: not a number`);
      c.attrs = attrs;
      c.inner = `<v>${String(value)}</v>`;
    } else {
      c.attrs = `${attrs} t="inlineStr"`;
      c.inner = `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
    }
  }

  /**
   * Inserts `count` empty rows right after row `after`, each a copy of row `after` (height and cell
   * styles, values cleared), like Excel's "insert row". Rows, merged cells and other references
   * below move down; a range that spans the insertion point grows.
   */
  insertRowsAfter(after: number, count: number): void {
    if (count <= 0) return;
    const model = this.row(after);
    const from = after + 1;
    for (const r of this.rows) if (r.num >= from) r.num += count;
    const copies: Row[] = [];
    for (let i = 0; i < count; i++) {
      copies.push({
        num: from + i,
        attrs: model.attrs,
        cells: model.cells.map((c) => ({
          col: c.col,
          attrs: attrsWithout(c.attrs, 't'),
          inner: null,
        })),
      });
    }
    this.rows.splice(this.rows.indexOf(model) + 1, 0, ...copies);
    for (const [tag, attr] of [
      ['dimension', 'ref'],
      ['mergeCell', 'ref'],
      ['sortState', 'ref'],
      ['sortCondition', 'ref'],
      ['autoFilter', 'ref'],
      ['conditionalFormatting', 'sqref'],
      ['dataValidation', 'sqref'],
      ['hyperlink', 'ref'],
      ['selection', 'sqref'],
      ['selection', 'activeCell'],
    ] as const) {
      this.before = shiftAttr(this.before, tag, attr, from, count);
      this.after = shiftAttr(this.after, tag, attr, from, count);
    }
    this.inserts.push({ from, by: count });
  }

  /** Every merged range, as written (for tests). */
  merges(): string[] {
    return [...this.after.matchAll(/<mergeCell\b[^>]*\sref="([^"]+)"/g)].map((m) => m[1] ?? '');
  }

  toXml(): string {
    return this.before + this.rows.map(rowXml).join('') + this.after;
  }
}

export class TemplateBook {
  private constructor(
    private readonly zip: JSZip,
    private workbookXml: string,
    readonly sheets: readonly TemplateSheet[],
  ) {}

  static async load(data: Buffer | Uint8Array): Promise<TemplateBook> {
    const zip = await JSZip.loadAsync(data);
    const read = async (path: string): Promise<string> => {
      const f = zip.file(path);
      if (!f) throw new Error(`template part missing: ${path}`);
      return f.async('string');
    };
    const workbookXml = await read('xl/workbook.xml');
    const rels = await read('xl/_rels/workbook.xml.rels');
    const target = new Map(
      [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
        /\sId="([^"]+)"/.exec(m[0])?.[1] ?? '',
        /\sTarget="([^"]+)"/.exec(m[0])?.[1] ?? '',
      ]),
    );
    const sharedStrings = zip.file('xl/sharedStrings.xml')
      ? [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
          xmlUnescape(
            [...(si[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
              .map((t) => t[1] ?? '')
              .join(''),
          ),
        )
      : [];
    const sheets: TemplateSheet[] = [];
    const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]);
    for (const [index, tag] of sheetTags.entries()) {
      const name = xmlUnescape(/\sname="([^"]*)"/.exec(tag)?.[1] ?? '');
      const rid = /\sr:id="([^"]+)"/.exec(tag)?.[1] ?? '';
      const rel = target.get(rid);
      if (rel === undefined) throw new Error(`sheet ${name}: no relationship`);
      const path = rel.startsWith('/') ? rel.slice(1) : `xl/${rel}`;
      sheets.push(new TemplateSheet(name, index, path, await read(path), sharedStrings));
    }
    return new TemplateBook(zip, workbookXml, sheets);
  }

  sheet(name: string): TemplateSheet {
    const s = this.sheets.find((x) => x.name === name);
    if (!s) throw new Error(`template has no sheet "${name}"`);
    return s;
  }

  async toBuffer(): Promise<Buffer> {
    for (const s of this.sheets) {
      this.zip.file(s.path, s.toXml());
      // Sheet-local defined names (print area, filter range) follow inserted rows.
      for (const ins of s.inserts) {
        this.workbookXml = this.workbookXml.replace(
          new RegExp(
            `(<definedName\\b[^>]*\\slocalSheetId="${String(s.index)}"[^>]*>)([^<]*)(</definedName>)`,
            'g',
          ),
          (_m, a: string, ref: string, b: string) => {
            // "'ST. F18'!$A$1:$V$17": only the part after "!" (the sheet name may look like a cell).
            const bang = ref.lastIndexOf('!');
            if (bang < 0) return a + ref + b;
            return a + ref.slice(0, bang + 1) + shiftRef(ref.slice(bang + 1), ins.from, ins.by) + b;
          },
        );
      }
      s.inserts.length = 0;
    }
    this.zip.file('xl/workbook.xml', this.workbookXml);
    return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
