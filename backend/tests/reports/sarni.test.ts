// सारणी-"क" (सदस्य जिला परिषद) and सारणी-"ख" (सदस्य पंचायत समिति): the officer's summary tables of
// elected members. They are signed and sent on, so what matters most is that every name and party
// equals the ward's declaration — the newest version — and that a ward still being counted stays
// visibly empty instead of guessing. Plus the classification mapping, the two header lines of
// सारणी-"ख", the permission matrix and the audit row.
import ExcelJS from 'exceljs';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classificationOf } from '../../src/services/sarni.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { PASSWORD } from '../counting/helpers.js';
import { buildReportWorld } from './world.js';
import type { ReportWorld } from './world.js';

let pool: Pool;
let migrator: Pool;
let world: ReportWorld;

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  world = await buildReportWorld(pool, migrator);
}, 120_000);

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

const ZP_URL = '/api/sarni/zp.xlsx';
const psUrl = (psId: number) => `/api/sarni/ps.xlsx?ps=${String(psId)}`;

// One login per user for the whole file: the app keeps the real login rate limit.
const agents = new Map<string, ReturnType<typeof request.agent>>();
async function agentFor(user: string) {
  const cached = agents.get(user);
  if (cached !== undefined) return cached;
  const agent = request.agent(world.app);
  const csrf = await agent.get('/api/auth/csrf');
  const token = (csrf.body as { csrfToken: string }).csrfToken;
  const res = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username: user, password: PASSWORD });
  expect(res.status).toBe(200);
  agents.set(user, agent);
  return agent;
}

async function sheet(user: string, url: string): Promise<ExcelJS.Worksheet> {
  const agent = await agentFor(user);
  const res = await agent
    .get(url)
    .buffer()
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (ws === undefined) throw new Error('no worksheet');
  return ws;
}

function text(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v: unknown = ws.getCell(row, col).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
const numAt = (ws: ExcelJS.Worksheet, row: number, col: number): number | null => {
  const v = ws.getCell(row, col).value;
  return typeof v === 'number' ? v : null;
};

/** The row of the table's dark header band ("क्र.सं." in column 1). */
function headerRowOf(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= ws.rowCount; r++) if (text(ws, r, 1).startsWith('क्र.सं.')) return r;
  throw new Error('header row not found');
}

interface Row {
  serial: number | null;
  wardNo: number | null;
  classification: string;
  member: string;
  party: string;
}

/** The data rows: everything between the numbered row and the signature block. */
function rowsOf(ws: ExcelJS.Worksheet): Row[] {
  const start = headerRowOf(ws) + 2;
  const out: Row[] = [];
  for (let r = start; r <= ws.rowCount; r++) {
    const serial = numAt(ws, r, 1);
    if (serial === null) break;
    out.push({
      serial,
      wardNo: numAt(ws, r, 2),
      classification: text(ws, r, 3),
      member: text(ws, r, 4),
      party: text(ws, r, 5),
    });
  }
  return out;
}

/** What the database says the ward's elected member is, from its NEWEST declaration. */
async function declaredWinners(wardType: 'PS' | 'ZP', psId?: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.ward_no, c.name_hindi AS member, p.name_hindi AS party
       FROM ward w
       JOIN ward_declarations d ON d.ward_id = w.id
        AND d.version = (SELECT MAX(d2.version) FROM ward_declarations d2 WHERE d2.ward_id = w.id)
       JOIN candidate c ON c.id = d.winner_candidate_id
       LEFT JOIN party p ON p.id = c.party_id
      WHERE w.ward_type = ?${psId === undefined ? '' : ' AND w.panchayat_samiti_id = ?'}
      ORDER BY w.ward_no`,
    psId === undefined ? [wardType] : [wardType, psId],
  );
  return rows.map((r) => ({
    wardNo: Number(r.ward_no),
    member: String(r.member),
    party: r.party === null ? 'निर्दलीय' : String(r.party),
  }));
}

describe('the names and parties are the declarations', () => {
  it('सारणी-"ख": every declared PS ward matches its newest declaration', async () => {
    const ws = await sheet(world.users.dm, psUrl(world.ps1));
    const rows = rowsOf(ws);
    const winners = await declaredWinners('PS', world.ps1);
    expect(winners.length).toBeGreaterThan(3);
    for (const expected of winners) {
      const row = rows.find((r) => r.wardNo === expected.wardNo);
      if (row === undefined) throw new Error(`ward ${String(expected.wardNo)} missing`);
      expect(row.member, `ward ${String(expected.wardNo)}`).toBe(expected.member);
      expect(row.party, `ward ${String(expected.wardNo)}`).toBe(expected.party);
    }
  });

  it('सारणी-"क": the ZP ward matches its declaration', async () => {
    const ws = await sheet(world.users.dm, ZP_URL);
    const rows = rowsOf(ws);
    for (const expected of await declaredWinners('ZP')) {
      const row = rows.find((r) => r.wardNo === expected.wardNo);
      if (row === undefined) throw new Error(`ZP ward ${String(expected.wardNo)} missing`);
      expect(row.member).toBe(expected.member);
      expect(row.party).toBe(expected.party);
    }
  });

  it('a corrected ward uses the NEWEST version, not the first', async () => {
    // "corrected" was declared, then corrected to the other candidate (world.ts).
    const ward = world.w.corrected;
    if (ward === undefined) throw new Error('no corrected ward');
    const [versions] = await pool.execute<RowDataPacket[]>(
      `SELECT d.version, c.name_hindi AS name FROM ward_declarations d
         JOIN candidate c ON c.id = d.winner_candidate_id
        WHERE d.ward_id = ? ORDER BY d.version`,
      [ward.id],
    );
    expect(versions.length).toBeGreaterThan(1);
    const first = String(versions[0]?.name);
    const latest = String(versions[versions.length - 1]?.name);
    expect(latest).not.toBe(first);

    const [wardRow] = await pool.execute<RowDataPacket[]>('SELECT ward_no FROM ward WHERE id = ?', [
      ward.id,
    ]);
    const wardNo = Number(wardRow[0]?.ward_no);
    const rows = rowsOf(await sheet(world.users.dm, psUrl(world.ps1)));
    const row = rows.find((r) => r.wardNo === wardNo);
    expect(row?.member).toBe(latest);
  });

  it('an independent member is निर्दलीय', async () => {
    // "lottery" was won by कमला, an independent (world.ts).
    const rows = rowsOf(await sheet(world.users.dm, psUrl(world.ps1)));
    const row = rows.find((r) => r.member === 'कमला');
    expect(row?.party).toBe('निर्दलीय');
  });

  it('a ward still being counted keeps its row, with the member columns empty', async () => {
    const rows = rowsOf(await sheet(world.users.dm, psUrl(world.ps1)));
    const [open] = await pool.execute<RowDataPacket[]>(
      `SELECT w.ward_no FROM ward w
        WHERE w.ward_type = 'PS' AND w.panchayat_samiti_id = ? AND w.is_unopposed = 0
          AND NOT EXISTS (SELECT 1 FROM ward_declarations d WHERE d.ward_id = w.id)
        ORDER BY w.ward_no LIMIT 1`,
      [world.ps1],
    );
    const wardNo = Number(open[0]?.ward_no);
    expect(Number.isNaN(wardNo)).toBe(false);
    const row = rows.find((r) => r.wardNo === wardNo);
    if (row === undefined) throw new Error('the pending ward lost its row');
    expect(row.member).toBe('');
    expect(row.party).toBe('');
    expect(row.serial).not.toBeNull(); // still numbered, so the officer sees what is pending
  });

  it('every ward of the Panchayat Samiti is there, in ward order, numbered from 1', async () => {
    const rows = rowsOf(await sheet(world.users.dm, psUrl(world.ps1)));
    const [all] = await pool.execute<RowDataPacket[]>(
      "SELECT ward_no FROM ward WHERE ward_type = 'PS' AND panchayat_samiti_id = ? ORDER BY ward_no",
      [world.ps1],
    );
    expect(rows.map((r) => r.wardNo)).toEqual(all.map((w) => Number(w.ward_no)));
    expect(rows.map((r) => r.serial)).toEqual(all.map((_, i) => i + 1));
  });
});

describe('the classification column', () => {
  it('maps the real values of the district list to the short official forms', () => {
    expect(classificationOf('सामान्य')).toBe('सामान्य');
    expect(classificationOf('सामान्य महिला')).toBe('महिला');
    expect(classificationOf('अनुसूचित जाति')).toBe('अ.जा.');
    expect(classificationOf('अनुसूचित जाति महिला')).toBe('अ.जा. महिला');
    expect(classificationOf('अन्य पिछड़ा वर्ग')).toBe('अ.पि.व.');
    expect(classificationOf('अन्य पिछड़ा वर्ग महिला')).toBe('अ.पि.व. महिला');
    expect(classificationOf('अनुसूचित जनजाति')).toBe('अ.ज.जा.');
    expect(classificationOf('अनुसूचित जनजाति महिला')).toBe('अ.ज.जा. महिला');
  });

  it('leaves the cell empty for anything it cannot read, and never guesses', () => {
    expect(classificationOf(null)).toBeNull();
    expect(classificationOf('')).toBeNull();
    expect(classificationOf('कुछ और')).toBeNull();
    // Two categories at once is not one classification.
    expect(classificationOf('अनुसूचित जाति / सामान्य')).toBeNull();
  });

  it('a ward whose category does not map prints an empty cell and is reported', async () => {
    const ward = world.w.notClose;
    if (ward === undefined) throw new Error('no ward');
    await pool.execute("UPDATE ward SET reservation_category = 'कुछ और' WHERE id = ?", [ward.id]);
    try {
      const agent = await agentFor(world.users.dm);
      const summary = await agent.get(`/api/sarni/ps/summary?ps=${String(world.ps1)}`);
      expect(summary.status).toBe(200);
      expect((summary.body as { unmappedCategories: string[] }).unmappedCategories).toContain(
        'कुछ और',
      );
      const [wardRow] = await pool.execute<RowDataPacket[]>(
        'SELECT ward_no FROM ward WHERE id = ?',
        [ward.id],
      );
      const rows = rowsOf(await sheet(world.users.dm, psUrl(world.ps1)));
      const row = rows.find((r) => r.wardNo === Number(wardRow[0]?.ward_no));
      expect(row?.classification).toBe('');
    } finally {
      await pool.execute("UPDATE ward SET reservation_category = 'सामान्य' WHERE id = ?", [
        ward.id,
      ]);
    }
  });
});

describe('the sheet itself', () => {
  it('सारणी-"क" carries its two title lines and the five columns', async () => {
    const ws = await sheet(world.users.dm, ZP_URL);
    expect(text(ws, 1, 1)).toBe('सारणी- "क"');
    expect(text(ws, 2, 1)).toBe('सदस्य जिला परिषद');
    const header = headerRowOf(ws);
    expect(text(ws, header, 2)).toContain('निर्वाचन क्षेत्र');
    expect(text(ws, header, 3)).toContain('वर्गीकरण');
    expect(text(ws, header, 4)).toContain('निर्वाचित सदस्य');
    expect(text(ws, header, 5)).toContain('राजनैतिक दल');
    // the numbered row under the headers
    expect([1, 2, 3, 4, 5].map((c) => numAt(ws, header + 1, c))).toEqual([1, 2, 3, 4, 5]);
    // the signature block
    const all = Array.from({ length: ws.rowCount }, (_, i) => text(ws, i + 1, 3));
    expect(all).toContain('हस्ताक्षर रिटर्निंग अधिकारी');
    expect(all).toContain('मय नाम, पदनाम एवं मोहर सहित');
  });

  it('सारणी-"ख" fills जिला and the Panchayat Samiti from the system', async () => {
    const ws = await sheet(world.users.dm, psUrl(world.ps1));
    expect(text(ws, 1, 1)).toBe('सारणी- "ख"');
    expect(text(ws, 2, 1)).toContain('जिला');
    expect(text(ws, 2, 1)).toContain('चूरू');
    expect(text(ws, 3, 1)).toContain('सदस्य पंचायत समिति');
    const [ps] = await pool.execute<RowDataPacket[]>(
      'SELECT name_hindi FROM panchayat_samiti WHERE id = ?',
      [world.ps1],
    );
    expect(text(ws, 3, 1)).toContain(String(ps[0]?.name_hindi));
  });

  it('every column has a width, so long names wrap instead of being clipped', async () => {
    const ws = await sheet(world.users.dm, ZP_URL);
    const widths = [1, 2, 3, 4, 5].map((c) => ws.getColumn(c).width);
    expect(widths.every((w) => typeof w === 'number' && w >= 8)).toBe(true);
    const header = headerRowOf(ws);
    for (let c = 1; c <= 5; c++) {
      expect(ws.getCell(header, c).alignment.wrapText, `header ${String(c)}`).toBe(true);
    }
  });

  it('the file is named after the table and the Panchayat Samiti', async () => {
    const agent = await agentFor(world.users.dm);
    const zp = await agent.get(ZP_URL);
    expect(zp.headers['content-disposition']).toContain('Sarni_K_ZP.xlsx');
    const ps = await agent.get(psUrl(world.ps1));
    expect(ps.headers['content-disposition']).toMatch(/filename="Sarni_Kh_.+\.xlsx"/);
  });
});

describe('who may download them', () => {
  it('सारणी-"क": the DM and the ZP RO only', async () => {
    for (const [user, status] of [
      [world.users.dm, 200],
      [world.users.zp, 200],
      [world.users.ro1, 403],
    ] as const) {
      const agent = await agentFor(user);
      expect((await agent.get(ZP_URL)).status, user).toBe(status);
    }
    expect((await request(world.app).get(ZP_URL)).status).toBe(401);
  });

  it('सारणी-"ख": a PS RO only its own Panchayat Samiti; the DM names one', async () => {
    const ro1 = await agentFor(world.users.ro1);
    expect((await ro1.get(psUrl(world.ps1))).status).toBe(200);
    expect((await ro1.get(psUrl(world.ps2))).status).toBe(403);
    const zp = await agentFor(world.users.zp);
    expect((await zp.get(psUrl(world.ps1))).status).toBe(403);
    const dm = await agentFor(world.users.dm);
    expect((await dm.get('/api/sarni/ps.xlsx')).status).toBe(400); // which Panchayat Samiti?
    expect((await request(world.app).get(psUrl(world.ps1))).status).toBe(401);
  });
});

describe('the audit row', () => {
  it('every download is audited like the other exports', async () => {
    const before = await exports();
    await sheet(world.users.dm, ZP_URL);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect(await exports()).toBe(before + 1);
    const value = rows[0]?.new_value as { section?: string; format?: string } | null;
    expect(value?.section).toBe('sarni-k');
    expect(value?.format).toBe('xlsx');

    await sheet(world.users.dm, psUrl(world.ps1));
    const [psRows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    const psValue = psRows[0]?.new_value as { section?: string; ps_id?: number } | null;
    expect(psValue?.section).toBe('sarni-kh');
    expect(psValue?.ps_id).toBe(world.ps1);
  });
});

async function exports(): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REPORT_EXPORTED'",
  );
  return Number(rows[0]?.n ?? 0);
}
