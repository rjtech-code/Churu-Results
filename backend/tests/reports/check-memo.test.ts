// "अंतिम परिणाम हेतु चेक मीमो" (.xlsx): the officer's final-result check memo.
//
// The memo exists to CHECK the result, so its numbers must be the DM ward detail's numbers, cell by
// cell — that is what most of this file proves. Plus the template's shape (heading block, header
// row, the column-letter row, PB VOTES, कुल योग), the "A" booth label, a ZP ward that spans two
// Panchayat Samitis, a partly counted ward (empty rows, never zeros), the permission matrix and the
// audit row.
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wardDetail } from '../../src/modules/reports/ward-detail.js';
import { createUser, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

const USERS = { dm: 'cm_dm', zp: 'cm_zp', ro1: 'cm_ro1', ro2: 'cm_ro2', sa: 'cm_sa' };

let pool: Pool;
let migrator: Pool;
let app: Express;
let w: World;

interface Ward {
  id: number;
  no: number;
  candidates: number[];
  nota: number;
  booths: number[];
}
interface World {
  ps1: number;
  ps2: number;
  ps: Ward;
  /** ZP ward 7: booths in BOTH Panchayat Samitis (8 real ZP wards are like this). */
  zp: Ward;
  /** ZP ward 8: every booth in ps1 alone (31 real ZP wards are like this). */
  zpOwn: Ward;
  many: Ward;
  empty: Ward;
}

const url = (wardId: number) => `/api/ward-forms/${String(wardId)}/check-memo.xlsx`;

async function sheetOf(body: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (ws === undefined) throw new Error('no worksheet');
  return ws;
}

/** The value of a cell as plain text ('' when empty); a formula cell gives its formula. */
function text(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v: unknown = ws.getCell(row, col).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && 'formula' in v) {
    const f: unknown = v.formula;
    return typeof f === 'string' ? `=${f}` : '';
  }
  return '';
}
const num = (ws: ExcelJS.Worksheet, row: number, col: number): number | null => {
  const v = ws.getCell(row, col).value;
  return typeof v === 'number' ? v : null;
};
/** The row whose column B holds this text (0 when there is none). */
function rowWith(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) if (text(ws, r, 2) === label) return r;
  return 0;
}

async function download(user: string, wardId: number): Promise<Buffer> {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const token = (csrf.body as { csrfToken: string }).csrfToken;
  const login = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: user, password: PASSWORD });
  expect(login.status).toBe(200);
  const res = await agent
    .get(url(wardId))
    .buffer()
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

async function statusForPath(user: string, path: string): Promise<number> {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const token = (csrf.body as { csrfToken: string }).csrfToken;
  await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: user, password: PASSWORD });
  return (await agent.get(path)).status;
}

async function statusFor(user: string, wardId: number): Promise<number> {
  return statusForPath(user, url(wardId));
}

async function build(db: Pool): Promise<World> {
  const { ps1, ps2 } = await seedTwoPs(db);
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    insert(
      db,
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const booth = (ps: number, no: number, suffix: string, psWard: number, zpWard: number) =>
    insert(
      db,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, booth_suffix, name_hindi, ps_ward_id, zp_ward_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ps, no, suffix, `बूथ ${String(no)}${suffix}`, psWard, zpWard],
    );
  const cand = (wardId: number, pos: number, name: string, nota = false) =>
    insert(
      db,
      'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, ?, ?, ?, ?)',
      [wardId, pos, name, nota ? null : 'M', nota ? 1 : 0],
    );
  const lock = (wardId: number) =>
    db.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE id = ?",
      [wardId],
    );

  // The ZP ward spans BOTH Panchayat Samitis (8 real ZP wards do), and booth numbers repeat.
  const zpId = await ward('ZP', null, 7);
  const psId = await ward('PS', ps1, 5);
  const manyId = await ward('PS', ps1, 6);
  const emptyId = await ward('PS', ps2, 9);
  const zpOtherId = await ward('ZP', null, 8); // the ZP ward of the other wards' booths

  // PS ward 5: booths 12, 12A, 13 (the suffix booth must print as "12A").
  const psBooths = [
    await booth(ps1, 12, '', psId, zpOtherId),
    await booth(ps1, 12, 'A', psId, zpOtherId),
    await booth(ps1, 13, '', psId, zpOtherId),
  ];
  // ZP ward 7: booth 4 of CHURU and booth 4 of RAJGARH — the same number in two Panchayat Samitis.
  const zpPsWard1 = await ward('PS', ps1, 20);
  const zpPsWard2 = await ward('PS', ps2, 20);
  const zpBooths = [
    await booth(ps1, 4, '', zpPsWard1, zpId),
    await booth(ps2, 4, '', zpPsWard2, zpId),
  ];
  const manyBooths = [await booth(ps1, 30, '', manyId, zpOtherId)];

  const mk = async (id: number, no: number, names: string[], booths: number[]): Promise<Ward> => {
    const candidates: number[] = [];
    for (const [i, name] of names.entries()) candidates.push(await cand(id, i + 1, name));
    const nota = await cand(id, names.length + 1, 'नोटा', true);
    await lock(id);
    return { id, no, candidates, nota, booths };
  };
  const ps = await mk(psId, 5, ['अमर सिंह', 'भरत कुमार'], psBooths);
  const zp = await mk(zpId, 7, ['सरला देवी', 'प्रकाश चंद्र'], zpBooths);
  const many = await mk(
    manyId,
    6,
    Array.from({ length: 12 }, (_, i) => `उम्मीदवार संख्या ${String(i + 1)} लंबा नाम`),
    manyBooths,
  );
  // ZP ward 8 holds the PS wards' booths, and all of them are ps1's: the case where a PS RO's own
  // Panchayat Samiti happens to cover the whole ZP ward.
  const zpOwn = await mk(zpOtherId, 8, ['क देवी', 'ख लाल'], [...psBooths, ...manyBooths]);
  const empty: Ward = { id: emptyId, no: 9, candidates: [], nota: 0, booths: [] };
  // Official order: the postal sheet of a ZP ward is entered by ONE assigned Panchayat Samiti's RO.
  await db.execute('INSERT INTO zp_ward_postal_assignment (zp_ward_id, ps_id) VALUES (?, ?)', [
    zpId,
    ps1,
  ]);

  for (const u of [
    { username: USERS.ro1, role: 'PS_RO' as const, psId: ps1 },
    { username: USERS.ro2, role: 'PS_RO' as const, psId: ps2 },
  ]) {
    await createUser(db, { ...u, password: PASSWORD });
  }
  await createUser(db, { username: USERS.zp, role: 'ZP_RO', password: PASSWORD });
  await createUser(db, { username: USERS.dm, role: 'DM', password: PASSWORD });
  await createUser(db, { username: USERS.sa, role: 'SUPER_ADMIN', password: PASSWORD });
  return { ps1, ps2, ps, zp, zpOwn, many, empty };
}

/** Enters one booth sheet through the real counting API (so the numbers are real). */
async function enter(
  client: DeclareClient,
  ward: Ward,
  boothId: number,
  votes: number[],
  nota: number,
  ballotFor: 'PS' | 'ZP' = 'PS',
): Promise<void> {
  const rows = [
    ...ward.candidates.map((id, i) => ({ candidateId: id, votes: votes[i] ?? 0 })),
    { candidateId: ward.nota, votes: nota },
  ];
  const total = rows.reduce((s, r) => s + r.votes, 0);
  const res = await client.post('/entries', {
    wardId: ward.id,
    boothId,
    ballotFor,
    sheetTotal: total,
    votes: rows,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`entry: ${String(res.status)} ${JSON.stringify(res.body)}`);
  }
}

async function postal(
  client: DeclareClient,
  ward: Ward,
  votes: number[],
  nota: number,
  rejected?: number,
): Promise<void> {
  const rows = [
    ...ward.candidates.map((id, i) => ({ candidateId: id, votes: votes[i] ?? 0 })),
    { candidateId: ward.nota, votes: nota },
  ];
  const total = rows.reduce((s, r) => s + r.votes, 0);
  const res = await client.post(`/wards/${String(ward.id)}/postal`, {
    sheetTotal: total,
    votes: rows,
    ...(rejected === undefined ? {} : { rejectedCount: rejected }),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`postal: ${String(res.status)} ${JSON.stringify(res.body)}`);
  }
}

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  w = await build(pool);
  // This file logs in again for every permission check, and the login limit is counted per
  // USERNAME (counting day: the venue shares one IP), so it is raised for the test app.
  app = countingApp(pool, {
    loginRateLimit: {
      perUser: { limit: 10_000, windowMs: 60_000 },
      perIp: { limit: 10_000, windowMs: 60_000 },
    },
  });
  const ro1 = await declareClient(app, USERS.ro1);
  const ro2 = await declareClient(app, USERS.ro2);
  // PS ward 5: two of three booths entered (the third stays empty), postal with a rejected count.
  await enter(ro1, w.ps, w.ps.booths[0] ?? 0, [120, 90], 5);
  await enter(ro1, w.ps, w.ps.booths[1] ?? 0, [60, 40], 2);
  await postal(ro1, w.ps, [7, 3], 1, 2);
  // ZP ward 7: one booth per Panchayat Samiti, each entered by that PS's own RO.
  await enter(ro1, w.zp, w.zp.booths[0] ?? 0, [200, 150], 10, 'ZP');
  await enter(ro2, w.zp, w.zp.booths[1] ?? 0, [100, 180], 4, 'ZP');
  await postal(ro1, w.zp, [5, 6], 0);
  // ZP ward 8 (all booths ps1's): two of its four booths entered, no postal sheet.
  await enter(ro1, w.zpOwn, w.zpOwn.booths[0] ?? 0, [11, 22], 3, 'ZP');
  await enter(ro1, w.zpOwn, w.zpOwn.booths[1] ?? 0, [33, 44], 1, 'ZP');
  // The many-candidate ward: one booth entered.
  await enter(
    ro1,
    w.many,
    w.many.booths[0] ?? 0,
    Array.from({ length: 12 }, (_, i) => i + 1),
    3,
  );
}, 60_000);

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('the officer template', () => {
  it('PS ward: heading block, the Panchayat Samiti line and "ps ward no."', async () => {
    const ws = await sheetOf(await download(USERS.dm, w.ps.id));
    expect(text(ws, 1, 1)).toBe('कार्यालय रिटर्निंग अधिकारी, चूरू');
    expect(text(ws, 3, 1)).toBe('पंचायत समिति आम चुनाव, 2026');
    expect(text(ws, 4, 1)).toContain('पंचायत समिति — ');
    expect(text(ws, 5, 1)).toBe('अंतिम परिणाम हेतु चेक मीमो');
    const header = 6;
    expect(text(ws, header, 1)).toBe('ps ward no.');
    expect(text(ws, header, 2)).toBe('polling booth number');
    expect(text(ws, header, 3)).toBe('अमर सिंह');
    expect(text(ws, header, 4)).toBe('भरत कुमार');
    expect(text(ws, header, 5)).toBe('NOTA');
    expect(text(ws, header, 6)).toBe('TOTAL');
    expect(text(ws, header, 7)).toBe('REJECTED PB');
    expect(text(ws, header, 8)).toContain('(G+H)');
    // the column-letter row the officers read along
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => text(ws, header + 1, c))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
    ]);
  });

  it('ZP ward: the Zila Parishad heading and "zp ward no."', async () => {
    const ws = await sheetOf(await download(USERS.dm, w.zp.id));
    expect(text(ws, 3, 1)).toBe('जिला परिषद् आम चुनाव, 2026');
    expect(text(ws, 4, 1)).toBe('अंतिम परिणाम हेतु चेक मीमो');
    expect(text(ws, 5, 1)).toBe('zp ward no.');
  });

  it('the ward number stands on the first booth row only, and an "A" booth prints as 12A', async () => {
    const ws = await sheetOf(await download(USERS.dm, w.ps.id));
    const first = rowWith(ws, '12');
    expect(first).toBeGreaterThan(0);
    expect(num(ws, first, 1)).toBe(5); // ward no. once
    expect(text(ws, first + 1, 1)).toBe('');
    expect(text(ws, first + 1, 2)).toBe('12A');
    expect(text(ws, first + 2, 2)).toBe('13');
  });

  it('many candidates: the letter row and the (G+H) formula follow the columns', async () => {
    const ws = await sheetOf(await download(USERS.dm, w.many.id));
    const header = 6;
    // 12 candidates + NOTA + TOTAL + REJECTED PB + (G+H) after the two first columns = 18 columns.
    expect(text(ws, header, 18)).toContain('(G+H)');
    expect(text(ws, header + 1, 18)).toBe('R');
    const row = rowWith(ws, '30');
    expect(text(ws, row, 18)).toBe('=P' + String(row) + '+Q' + String(row));
  });
});

describe('the numbers are the DM ward detail, cell by cell', () => {
  it('PS ward: every booth row, the PB row and कुल योग', async () => {
    const detail = await wardDetail(pool, w.ps.id);
    const ws = await sheetOf(await download(USERS.dm, w.ps.id));
    const candidates = detail.candidates
      .filter((c) => !c.isNota)
      .sort((a, b) => a.ballotPosition - b.ballotPosition);
    const nota = detail.candidates.find((c) => c.isNota);

    for (const booth of detail.booths) {
      const row = rowWith(ws, booth.boothNo);
      expect(row, booth.boothNo).toBeGreaterThan(0);
      if (!booth.entered) {
        // A booth with no entry is EMPTY, never zero.
        for (let c = 3; c <= 8; c++)
          expect(text(ws, row, c), `empty booth ${booth.boothNo}`).toBe('');
        continue;
      }
      const by = new Map(booth.votes.map((v) => [v.candidateId, v.votes]));
      candidates.forEach((c, i) => {
        expect(num(ws, row, 3 + i), `${booth.boothNo} ${c.name}`).toBe(by.get(c.id) ?? 0);
      });
      expect(num(ws, row, 5)).toBe(by.get(nota?.id ?? 0) ?? 0);
      expect(num(ws, row, 6)).toBe(booth.sheetTotal);
    }

    const pb = rowWith(ws, 'PB VOTES');
    const postalBy = new Map(detail.postal.votes.map((v) => [v.candidateId, v.votes]));
    candidates.forEach((c, i) => {
      expect(num(ws, pb, 3 + i)).toBe(postalBy.get(c.id) ?? 0);
    });
    expect(num(ws, pb, 6)).toBe(detail.postal.sheetTotal);
    expect(num(ws, pb, 7)).toBe(detail.postal.rejectedCount);

    // कुल योग sums the booth rows and the PB row (a formula, so the officer can see what it adds).
    const total = rowWith(ws, 'कुल योग');
    expect(total).toBe(pb + 1);
    expect(text(ws, total, 3)).toMatch(/^=SUM\(/);
  });

  it('a candidate total in the memo equals the ward detail total', async () => {
    const detail = await wardDetail(pool, w.ps.id);
    const ws = await sheetOf(await download(USERS.dm, w.ps.id));
    const first = detail.candidates.find((c) => !c.isNota);
    if (first === undefined) throw new Error('no candidate');
    // Sum what the memo prints for that candidate (booths + PB) and compare with the report.
    let sum = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      if (text(ws, r, 2) === 'कुल योग') continue;
      sum += num(ws, r, 3) ?? 0;
    }
    expect(sum).toBe(first.totalVotes);
  });

  it('a partly counted ward still prints, with the un-entered booth empty', async () => {
    const detail = await wardDetail(pool, w.ps.id);
    expect(detail.booths.filter((b) => !b.entered)).toHaveLength(1);
    const ws = await sheetOf(await download(USERS.dm, w.ps.id));
    const row = rowWith(ws, '13');
    expect(text(ws, row, 3)).toBe('');
    expect(text(ws, row, 6)).toBe('');
  });

  it('a ward with no candidates and no booths still gives a sheet', async () => {
    const ws = await sheetOf(await download(USERS.dm, w.empty.id));
    expect(text(ws, 6, 1)).toBe('ps ward no.'); // heading, election line, PS line, title, header
    expect(rowWith(ws, 'PB VOTES')).toBeGreaterThan(0);
    expect(rowWith(ws, 'कुल योग')).toBeGreaterThan(0);
  });
});

describe('a ZP ward that spans two Panchayat Samitis', () => {
  it('names the Panchayat Samiti above its booths, so a repeated booth number is never ambiguous', async () => {
    const detail = await wardDetail(pool, w.zp.id);
    const names = [...new Set(detail.booths.map((b) => b.psName))];
    expect(names.length).toBe(2);
    const ws = await sheetOf(await download(USERS.dm, w.zp.id));
    for (const ps of names) {
      const row = rowWith(ws, '') && 0; // sub-headings live in column A (merged)
      expect(row).toBe(0);
      let found = 0;
      for (let r = 1; r <= ws.rowCount; r++) {
        if (text(ws, r, 1) === `पंचायत समिति — ${ps}`) found = r;
      }
      expect(found, ps).toBeGreaterThan(0);
    }
    // Both booths are numbered 4; each appears under its own Panchayat Samiti.
    let fours = 0;
    for (let r = 1; r <= ws.rowCount; r++) if (text(ws, r, 2) === '4') fours++;
    expect(fours).toBe(2);
  });
});

describe('who may download it', () => {
  it('the DM any ward; each RO only its own; everyone else 403', async () => {
    expect(await statusFor(USERS.dm, w.ps.id)).toBe(200);
    expect(await statusFor(USERS.dm, w.zp.id)).toBe(200);
    expect(await statusFor(USERS.ro1, w.ps.id)).toBe(200); // own PS ward
    expect(await statusFor(USERS.ro2, w.ps.id)).toBe(403); // another PS
    expect(await statusFor(USERS.zp, w.zp.id)).toBe(200); // ZP ward
    expect(await statusFor(USERS.zp, w.ps.id)).toBe(403); // never a PS ward
    expect(await statusFor(USERS.sa, w.ps.id)).toBe(403); // Super Admin never
    expect((await request(app).get(url(w.ps.id))).status).toBe(401);
  });

  it('every download is audited like the other exports', async () => {
    const before = await auditCount();
    await download(USERS.dm, w.zp.id);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT entity_id, new_value FROM audit_log
        WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1`,
    );
    expect(await auditCount()).toBe(before + 1);
    const row = rows[0];
    expect(Number(row?.entity_id)).toBe(w.zp.id);
    const value = row?.new_value as { section?: string; format?: string } | null;
    expect(value?.section).toBe('check-memo');
    expect(value?.format).toBe('xlsx');
  });
});

async function auditCount(): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REPORT_EXPORTED'",
  );
  return Number(rows[0]?.n ?? 0);
}

// --------------------------------------------------------------------------------------------
// A PS RO's जिला परिषद ward memo: their OWN booths, never the postal row, always with the notice.
// --------------------------------------------------------------------------------------------

/** Every cell of the sheet as text, so a test can prove a word is nowhere in it. */
function allText(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= ws.columnCount; c++) out.push(text(ws, r, c));
  }
  return out;
}

/** Every number the sheet holds, so a test can prove another PS's figures are not among them. */
function allNumbers(ws: ExcelJS.Worksheet): number[] {
  const out: number[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = num(ws, r, c);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

/** The notice rows are merged into column A. */
function rowWithA(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) if (text(ws, r, 1) === label) return r;
  return 0;
}

/** The booth rows: column B holds a booth number (not PB VOTES, कुल योग or a heading). */
function boothRowCount(ws: ExcelJS.Worksheet): number {
  let n = 0;
  for (let r = 1; r <= ws.rowCount; r++) if (/^\d+[A-Z]?$/.test(text(ws, r, 2))) n++;
  return n;
}

async function psNameOf(psId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_hindi FROM panchayat_samiti WHERE id = ?',
    [psId],
  );
  return String(rows[0]?.name_hindi ?? '');
}

const NOTICE_SOME_1 = 'ध्यान दें — यह आंशिक मीमो है। यह वार्ड का अंतिम परिणाम नहीं है।';
const NOTICE_ALL_1 = 'ध्यान दें — यह वार्ड का अंतिम परिणाम नहीं है।';
const UNDER_TOTAL =
  'यह योग केवल बूथ का है। वार्ड का पूरा योग और अंतिम परिणाम जिला परिषद रिटर्निंग अधिकारी के पास है।';

describe("a PS RO's जिला परिषद ward memo", () => {
  it("holds their own booths only — the other PS's row and figures are nowhere in the sheet", async () => {
    const ws = await sheetOf(await download(USERS.ro1, w.zp.id));
    // ZP ward 7 has two booths, both numbered 4: one in ps1, one in ps2. Only ps1's prints.
    expect(boothRowCount(ws)).toBe(1);
    const row = rowWith(ws, '4');
    expect(row).toBeGreaterThan(0);
    expect(num(ws, row, 3)).toBe(200); // ps1's own booth, as ro1 entered it
    expect(num(ws, row, 4)).toBe(150);
    // ps2's booth sheet was [100, 180] + 4 NOTA = 284. None of it may appear anywhere.
    const numbers = allNumbers(ws);
    for (const forbidden of [100, 180, 284]) expect(numbers).not.toContain(forbidden);
    // Nor its Panchayat Samiti, in any heading.
    expect(allText(ws)).not.toContain(`पंचायत समिति — ${await psNameOf(w.ps2)}`);
  });

  it('says so above the table: आंशिक मीमो, the Panchayat Samiti and how many booths of how many', async () => {
    const ws = await sheetOf(await download(USERS.ro1, w.zp.id));
    const first = rowWithA(ws, NOTICE_SOME_1);
    expect(first).toBeGreaterThan(0);
    expect(text(ws, first + 1, 1)).toBe(
      `इसमें केवल पंचायत समिति ${await psNameOf(w.ps1)} के बूथ हैं — वार्ड के कुल 2 बूथ में से 1। अन्य पंचायत समिति के बूथ और डाक मतपत्र इसमें शामिल नहीं हैं।`,
    );
    // Above the table: before the header row and the column-letter row.
    expect(first).toBeLessThan(rowWithA(ws, 'zp ward no.'));
  });

  it('has no PB row, and कुल योग is its own booths only, with the notice under it', async () => {
    const ws = await sheetOf(await download(USERS.ro1, w.zp.id));
    expect(rowWith(ws, 'PB VOTES')).toBe(0);
    expect(rowWith(ws, 'कुल योग')).toBe(0); // the bare label would read like the ward's result
    const total = rowWithA(ws, `कुल योग — केवल पंचायत समिति ${await psNameOf(w.ps1)} के 1 बूथ`);
    expect(total).toBeGreaterThan(0);
    // The sum adds up the printed booth row alone — the ward's postal row is not in the formula.
    const boothRow = rowWith(ws, '4');
    expect(text(ws, total, 3)).toBe(`=SUM(C${String(boothRow)})`);
    expect(text(ws, total, 6)).toBe(`=SUM(F${String(boothRow)})`); // TOTAL is still added up
    // REJECTED PB belongs to the PB row, which this sheet does not carry: never a 0 here.
    expect(text(ws, total, 7)).toBe('');
    expect(text(ws, total + 1, 1)).toBe(UNDER_TOTAL);
  });

  it('a ZP ward whose booths are all theirs: same shape, the सभी wording, still no PB row', async () => {
    const ws = await sheetOf(await download(USERS.ro1, w.zpOwn.id));
    const first = rowWithA(ws, NOTICE_ALL_1);
    expect(first).toBeGreaterThan(0);
    expect(text(ws, first + 1, 1)).toBe(
      `इसमें पंचायत समिति ${await psNameOf(w.ps1)} के सभी 4 बूथ हैं, परन्तु डाक मतपत्र शामिल नहीं हैं। वार्ड का पूरा योग और अंतिम परिणाम जिला परिषद रिटर्निंग अधिकारी के पास है।`,
    );
    expect(boothRowCount(ws)).toBe(4);
    expect(rowWith(ws, 'PB VOTES')).toBe(0);
    const total = rowWithA(ws, 'कुल योग — केवल बूथ (डाक मतपत्र शामिल नहीं)');
    expect(total).toBeGreaterThan(0);
    // 3 candidates here: C D E = candidates, F = NOTA, G = TOTAL, H = REJECTED PB.
    expect(text(ws, total, 7)).toContain('=SUM(');
    expect(text(ws, total, 8)).toBe('');
    expect(text(ws, total + 1, 1)).toBe(UNDER_TOTAL);
    // No "x में से y" count when every booth of the ward is there.
    expect(allText(ws).join('\n')).not.toContain('में से');
  });

  it('changing the ward id cannot move an officer to another Panchayat Samiti', async () => {
    // ro2 (ps2) asks for the very ward ro1 just downloaded: it gets ITS OWN booth, not ps1's.
    const ws = await sheetOf(await download(USERS.ro2, w.zp.id));
    expect(boothRowCount(ws)).toBe(1);
    const row = rowWith(ws, '4');
    expect(num(ws, row, 3)).toBe(100); // ps2's own figures
    expect(num(ws, row, 4)).toBe(180);
    for (const forbidden of [200, 150, 360]) expect(allNumbers(ws)).not.toContain(forbidden);
    expect(allText(ws)).toContain(
      `इसमें केवल पंचायत समिति ${await psNameOf(w.ps2)} के बूथ हैं — वार्ड के कुल 2 बूथ में से 1। अन्य पंचायत समिति के बूथ और डाक मतपत्र इसमें शामिल नहीं हैं।`,
    );
    // A ZP ward with none of its booths: nothing at all.
    expect(await statusFor(USERS.ro2, w.zpOwn.id)).toBe(403);
    // And there is no way to name a Panchayat Samiti in the request.
    expect(await statusForPath(USERS.ro2, `${url(w.zp.id)}?ps=${String(w.ps1)}`)).toBe(400);
  });

  it('is audited with the Panchayat Samiti it held and that it was the partial sheet', async () => {
    await download(USERS.ro1, w.zp.id);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1`,
    );
    const value = rows[0]?.new_value as {
      section?: string;
      ps_id?: number;
      partial?: boolean;
      booths?: number;
    } | null;
    expect(value?.section).toBe('check-memo');
    expect(value?.ps_id).toBe(w.ps1);
    expect(value?.partial).toBe(true);
    expect(value?.booths).toBe(1);
  });
});

describe('the whole-ward sheet is unchanged', () => {
  it('the DM and the ZP RO still get every booth, the PB row and no notice', async () => {
    for (const user of [USERS.dm, USERS.zp]) {
      const ws = await sheetOf(await download(user, w.zp.id));
      expect(boothRowCount(ws), user).toBe(2); // both Panchayat Samitis
      expect(rowWith(ws, 'PB VOTES'), user).toBeGreaterThan(0);
      const total = rowWith(ws, 'कुल योग');
      expect(total, user).toBeGreaterThan(0);
      // Unchanged: the whole ward's sheet still adds REJECTED PB up (it has a PB row to add).
      expect(text(ws, total, 7), user).toContain('=SUM(');
      const sheet = allText(ws).join('\n');
      for (const word of ['आंशिक मीमो', 'केवल बूथ', 'शामिल नहीं', NOTICE_ALL_1]) {
        expect(sheet, `${user} / ${word}`).not.toContain(word);
      }
    }
  });

  it('the DM download is audited as the whole ward', async () => {
    await download(USERS.dm, w.zp.id);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1`,
    );
    const value = rows[0]?.new_value as { ps_id?: number | null; partial?: boolean } | null;
    expect(value?.ps_id).toBeNull();
    expect(value?.partial).toBe(false);
  });
});

describe('downloading a memo never changes the counting', () => {
  it('every entry, vote, postal sheet and declaration is byte-identical afterwards', async () => {
    const snapshot = async (): Promise<string> => {
      const q = async (sql: string): Promise<string> =>
        JSON.stringify((await pool.execute<RowDataPacket[]>(sql))[0]);
      return [
        await q('SELECT * FROM booth_entry ORDER BY id'),
        await q('SELECT * FROM booth_entry_vote ORDER BY id'),
        await q('SELECT * FROM postal_entry ORDER BY id'),
        await q('SELECT * FROM postal_entry_vote ORDER BY id'),
        await q('SELECT * FROM ward_declarations ORDER BY ward_id, version'),
        await q('SELECT id, is_locked, is_unopposed FROM ward ORDER BY id'),
      ].join('|');
    };
    const before = await snapshot();
    await download(USERS.ro1, w.zp.id);
    await download(USERS.ro1, w.zpOwn.id);
    await download(USERS.ro2, w.zp.id);
    await download(USERS.dm, w.zp.id);
    await download(USERS.zp, w.zp.id);
    expect(await snapshot()).toBe(before);
  });
});
