// Booth-wise प्रारूप–14 भाग–II as Excel: the .xlsx carries the SAME numbers and the SAME wording as
// the PDF (including the officer's title by ward kind), for a plain booth and an "A" booth (12A).
// Same permissions, same audit, same file name with .xlsx. The PDF route must stay untouched.
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBoothSheet } from '../../src/modules/reports/ward-forms.data.js';
import { mapBoothPart2 } from '../../src/services/ward-forms/map-part2.js';
import { renderPart2Xlsx } from '../../src/services/ward-forms/render-part2.xlsx.js';
import {
  PART2,
  part2SignatureTitle,
} from '../../src/services/ward-forms/templates/part2.template.js';
import { createUser } from '../auth/helpers.js';
import {
  PASSWORD,
  buildWorld,
  clientFor,
  countingApp,
  psW1Sheet,
  zW1Sheet,
} from '../counting/helpers.js';
import type { Client, World } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { agentFor, getForm } from './world.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let pool: Pool;
let migrator: Pool;
let w: World;
let app: Express;
let ro1: Client;
const entry: Record<string, number> = {};

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  w = await buildWorld(pool);
  // b2 becomes booth "12A" of PS 1, so the Excel is checked on an "A" booth too.
  await pool.execute(
    "UPDATE booth SET booth_no = 12, booth_suffix = 'A', name_hindi = ? WHERE id = ?",
    ['राजकीय प्राथमिक विद्यालय साण्डन', w.b2],
  );
  await pool.execute(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('election_date', '2026-11-20')\n       ON DUPLICATE KEY UPDATE setting_value = '2026-11-20'",
  );
  await createUser(pool, { username: 'sa_xl9', role: 'SUPER_ADMIN', password: PASSWORD });
  app = countingApp(pool);
  ro1 = await clientFor(app, 'ro_ps1_x1');
  const made = async (c: Client, body: object) => {
    const res = await c.post('/entries', body);
    if (res.status !== 201) throw new Error(`entry: ${res.status} ${JSON.stringify(res.body)}`);
    return (res.body as { entry: { id: number } }).entry.id;
  };
  entry.psB2 = await made(ro1, psW1Sheet(w, w.b2, 300, 200, 10));
  entry.zpB2 = await made(ro1, zW1Sheet(w, w.b2, 100, 50, 5));
  entry.psB1 = await made(ro1, psW1Sheet(w, w.b1, 1, 2, 3));
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

const url = (booth: number, ballot: 'PS' | 'ZP', ext: 'pdf' | 'xlsx') =>
  `/api/ward-forms/booths/${String(booth)}/${ballot}/prarup14.${ext}`;

/** Every cell of the sheet as text, row by row (empty cells dropped). */
async function cells(data: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (ws === undefined) throw new Error('no worksheet');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const texts: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v: unknown = cell.value;
      if (v === null || v === undefined) return;
      if (typeof v === 'number') texts.push(String(v));
      else if (typeof v === 'string') texts.push(v);
    });
    if (texts.length > 0) rows.push(texts);
  });
  return rows;
}

const flat = (rows: string[][]): string[] => rows.flat();

/** The row that starts with this exact first cell. */
const rowStarting = (rows: string[][], first: string): string[] | undefined =>
  rows.find((r) => r[0] === first);

/** The last cell of that row: the votes column. A merged label repeats, the number never does. */
const valueOf = (rows: string[][], first: string): string | undefined => {
  const row = rowStarting(rows, first);
  return row?.[row.length - 1];
};

async function sheetOf(booth: number, ballot: 'PS' | 'ZP') {
  const { head, sheet } = await readBoothSheet(pool, booth, ballot);
  return mapBoothPart2(head, sheet, PART2);
}

describe('the Excel carries the same numbers as the PDF form data', () => {
  it('PS ward, booth 12A: header, candidates in ballot order, NOTA, total — all from mapBoothPart2', async () => {
    const d = await sheetOf(w.b2, 'PS');
    const rows = await cells(await renderPart2Xlsx(d, PART2));
    const texts = flat(rows);

    // The same header values the PDF prints.
    expect(texts).toContain(d.bodyName); // 'पंचायत समिति चूरू'
    expect(texts).toContain(d.wardNo); // '01'
    expect(texts).toContain(d.booth); // '12A – राजकीय प्राथमिक विद्यालय साण्डन'
    expect(texts).toContain(d.date); // '20.11.2026'
    expect(texts).toContain(d.place); // 'चूरू'

    // Candidates, in ballot order, with their votes as numbers.
    expect(d.rows).toEqual([
      { serial: '1', name: 'ए', votes: '300' },
      { serial: '2', name: 'बी', votes: '200' },
    ]);
    for (const r of d.rows) {
      expect(rowStarting(rows, r.serial)).toEqual([r.serial, r.name, r.votes]);
    }
    // NOTA and the total.
    expect(rowStarting(rows, d.notaSerial)).toEqual([d.notaSerial, PART2.text.nota, d.nota]);
    // The total row's label is merged across the first two columns, so it reads twice.
    expect(valueOf(rows, PART2.text.total)).toBe(d.total);
    expect(d.total).toBe('510');
  });

  it('ZP ward booth: the Zila Parishad name and that ballot’s own numbers', async () => {
    const d = await sheetOf(w.b2, 'ZP');
    const rows = await cells(await renderPart2Xlsx(d, PART2));
    expect(d.bodyName).toBe('चूरू');
    expect(flat(rows)).toContain('चूरू');
    expect(rowStarting(rows, '1')?.[2]).toBe('100');
    expect(rowStarting(rows, '2')?.[2]).toBe('50');
    expect(rowStarting(rows, d.notaSerial)?.[2]).toBe('5');
    expect(valueOf(rows, PART2.text.total)).toBe('155');
  });

  it('votes are written as numbers, so the sheet adds up', async () => {
    const d = await sheetOf(w.b2, 'PS');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderPart2Xlsx(d, PART2)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const numbers: number[] = [];
    ws?.eachRow((row) => {
      const v: unknown = row.getCell(3).value;
      if (typeof v === 'number') numbers.push(v);
    });
    expect(numbers).toContain(300);
    expect(numbers).toContain(200);
    expect(numbers).toContain(10);
    expect(numbers).toContain(510);
    expect(300 + 200 + 10).toBe(510);
  });
});

describe('the Excel carries the same wording as the PDF (one template)', () => {
  it('every printed line of the template is on the sheet', async () => {
    const texts = flat(await cells(await renderPart2Xlsx(await sheetOf(w.b2, 'PS'), PART2)));
    const t = PART2.text;
    for (const line of [
      t.form,
      t.rules,
      t.title,
      t.part,
      t.details,
      t.bodyName.PS,
      t.wardNo,
      t.booth,
      t.candidates,
      t.headers[0],
      t.headers[1],
      t.headers[2],
      t.nota,
      t.total,
      t.verification,
      t.discrepancy,
      t.date,
      t.place,
      t.supervisor,
      t.agents,
      t.agentHeaders[0],
      t.agentHeaders[1],
      t.agentHeaders[2],
      t.seal,
    ]) {
      expect(texts, line).toContain(line);
    }
    expect(texts.some((x) => x.includes(t.tallyQuestion))).toBe(true);
    expect(texts.some((x) => x.includes(t.tallyAnswer))).toBe(true);
    // The agents' table is blank but fully numbered, as on the PDF.
    for (let i = 1; i <= t.agentRows; i++) expect(texts).toContain(String(i));
  });

  it('officer title by WARD kind: रिटर्निंग अधिकारी for PS, सहायक रिटर्निंग अधिकारी for ZP, never both', async () => {
    const ps = flat(await cells(await renderPart2Xlsx(await sheetOf(w.b2, 'PS'), PART2)));
    const zp = flat(await cells(await renderPart2Xlsx(await sheetOf(w.b2, 'ZP'), PART2)));
    const line = (kind: 'PS' | 'ZP') => `${part2SignatureTitle(kind)} ${PART2.text.signatureOf}`;
    expect(ps).toContain(line('PS'));
    expect(ps).not.toContain(line('ZP'));
    expect(zp).toContain(line('ZP'));
    expect(zp).not.toContain(line('PS'));
    expect(line('PS')).toBe('रिटर्निंग अधिकारी के हस्ताक्षर');
    expect(line('ZP')).toBe('सहायक रिटर्निंग अधिकारी के हस्ताक्षर');
  });

  it('Hindi is stored as real Devanagari text (not escaped or mangled)', async () => {
    const texts = flat(await cells(await renderPart2Xlsx(await sheetOf(w.b2, 'PS'), PART2)));
    expect(texts).toContain('प्रारूप–14');
    expect(texts).toContain('ए'); // the candidate's Hindi name, as saved
    expect(texts).toContain('12A – राजकीय प्राथमिक विद्यालय साण्डन');
    for (const text of texts) expect(text).not.toMatch(/&#|\\u0/);
  });
});

describe('download: permissions, file name, audit — the same as the PDF', () => {
  const as = (u: string) => agentFor(app, u);

  it('PS_RO own PS both ballots; ZP_RO only ZP; DM any; Super Admin 403; logged out 401', async () => {
    const a = await as('ro_ps1_x1');
    for (const ballot of ['PS', 'ZP'] as const) {
      const res = await getForm(a, url(w.b2, ballot, 'xlsx'));
      expect(res.status, ballot).toBe(200);
      expect(res.headers['content-type']).toBe(XLSX);
    }
    const other = await as('ro_ps2_x2');
    expect((await getForm(other, url(w.b2, 'PS', 'xlsx'))).status).toBe(403);
    const zp = await as('zp_ro_x3');
    expect((await getForm(zp, url(w.b2, 'ZP', 'xlsx'))).status).toBe(200);
    expect((await getForm(zp, url(w.b2, 'PS', 'xlsx'))).status).toBe(403);
    expect((await getForm(await as('dm_x4'), url(w.b2, 'PS', 'xlsx'))).status).toBe(200);
    expect((await getForm(await as('sa_xl9'), url(w.b2, 'PS', 'xlsx'))).status).toBe(403);
    expect((await getForm(request.agent(app), url(w.b2, 'PS', 'xlsx'))).status).toBe(401);
  });

  it('file name ends in .xlsx with the booth label; no-store; one REPORT_EXPORTED row saying xlsx', async () => {
    const res = await getForm(await as('ro_ps1_x1'), url(w.b2, 'PS', 'xlsx'));
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Prarup14_PS_1_Booth12A.xlsx"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.new_value).toEqual({
      section: 'booth-form-prarup14',
      format: 'xlsx',
      ward_id: w.psW1,
      booth_id: w.b2,
      ballot_for: 'PS',
      entry_id: entry.psB2,
    });
  });

  it('the downloaded file is the same workbook the renderer builds', async () => {
    const res = await getForm(await as('ro_ps1_x1'), url(w.b2, 'ZP', 'xlsx'));
    expect(res.status).toBe(200);
    const served = await cells(res.body as Buffer);
    const built = await cells(await renderPart2Xlsx(await sheetOf(w.b2, 'ZP'), PART2));
    expect(served).toEqual(built);
  });

  it('no entry: 404 NO_ENTRY; unknown booth 404; bad ballot 400', async () => {
    const a = await as('ro_ps1_x1');
    const none = await getForm(a, url(w.b4, 'PS', 'xlsx'));
    expect([none.status, none.body]).toEqual([404, { error: 'NO_ENTRY' }]);
    expect((await getForm(a, url(999999, 'PS', 'xlsx'))).status).toBe(404);
    expect((await getForm(a, '/api/ward-forms/booths/1/XX/prarup14.xlsx')).status).toBe(400);
  });
});

describe('the PDF button is untouched', () => {
  it('the PDF still downloads as application/pdf with its own name and audit row', async () => {
    const res = await getForm(await agentFor(app, 'ro_ps1_x1'), url(w.b2, 'PS', 'pdf'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Prarup14_PS_1_Booth12A.pdf"',
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.new_value).toMatchObject({ format: 'pdf', booth_id: w.b2 });
  });
});
