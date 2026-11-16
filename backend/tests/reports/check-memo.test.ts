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
  zp: Ward;
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

async function statusFor(user: string, wardId: number): Promise<number> {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const token = (csrf.body as { csrfToken: string }).csrfToken;
  await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: user, password: PASSWORD });
  return (await agent.get(url(wardId))).status;
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
  const zpOther = await ward('ZP', null, 8); // the ZP ward of the other wards' booths

  // PS ward 5: booths 12, 12A, 13 (the suffix booth must print as "12A").
  const psBooths = [
    await booth(ps1, 12, '', psId, zpOther),
    await booth(ps1, 12, 'A', psId, zpOther),
    await booth(ps1, 13, '', psId, zpOther),
  ];
  // ZP ward 7: booth 4 of CHURU and booth 4 of RAJGARH — the same number in two Panchayat Samitis.
  const zpPsWard1 = await ward('PS', ps1, 20);
  const zpPsWard2 = await ward('PS', ps2, 20);
  const zpBooths = [
    await booth(ps1, 4, '', zpPsWard1, zpId),
    await booth(ps2, 4, '', zpPsWard2, zpId),
  ];
  const manyBooths = [await booth(ps1, 30, '', manyId, zpOther)];

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
  return { ps1, ps2, ps, zp, many, empty };
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
  app = countingApp(pool);
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
