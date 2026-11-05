import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dmWriteAllowed } from '../../src/middleware/auth.js';
import { RO_BULK_COLUMNS } from '../../src/services/master-data/ro-bulk.js';
import { createUser, login } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  dataAuditCount,
  masterSnapshot,
  xlsxBase64,
} from './helpers.js';
import type { AdminWorld, ApiClient, Value } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;
/** Two PS without any RO account (the world's ps1, ps2 and the ZP seat are taken). */
let ps3: number;
let ps4: number;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildAdminWorld(pool);
  const ps = async (en: string, hi: string) => {
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) SELECT district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [en, hi, w.ps1],
    );
    return r.insertId;
  };
  ps3 = await ps('SARDARSHAHAR PANCHAYAT SAMITI', 'पंचायत समिति सरदारशहर');
  ps4 = await ps('TARANAGAR PANCHAYAT SAMITI', 'पंचायत समिति तारानगर');
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

const HEADERS = [...RO_BULK_COLUMNS];

interface CheckBody {
  ok: boolean;
  errors: { message: string }[];
  rows: { rowNumber: number; status: string; seat: string | null; reasons: string[] }[];
  totals: { total: number; create: number; exists: number; errors: number };
  expectedSeats: string[];
}
interface SavedBody {
  totals: CheckBody['totals'];
  created: {
    seatLabel: string;
    fullName: string;
    phone: string;
    username: string;
    password: string;
  }[];
  credentialsFile: { fileName: string; fileBase64: string };
}

const file = async (rows: readonly (readonly Value[])[]) => ({
  fileName: 'ro.xlsx',
  fileBase64: await xlsxBase64(HEADERS, rows),
});
const check = async (rows: readonly (readonly Value[])[]) => {
  const res = await dm.post('/api/admin/users/bulk/check', await file(rows));
  expect(res.status).toBe(200);
  return res.body as CheckBody;
};
const save = async (
  rows: readonly (readonly Value[])[],
  extra: { allowErrors?: boolean; expectedSeats?: string[]; password?: string } = {},
) => {
  const preview = await check(rows);
  return dm.post('/api/admin/users/bulk/save', {
    ...(await file(rows)),
    password: extra.password ?? PASSWORD,
    allowErrors: extra.allowErrors ?? false,
    expectedSeats: extra.expectedSeats ?? preview.expectedSeats,
  });
};

const getBinary = (agent: ApiClient['agent'], path: string) =>
  agent
    .get(path)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });

/** Every sheet's cells as text (row by row), plus the workbook for format checks. */
async function readXlsx(data: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const text = (sheet: ExcelJS.Worksheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c) => cells.push(c.text));
      rows.push(cells);
    });
    return rows;
  };
  return { wb, sheets: wb.worksheets.map((s) => ({ name: s.name, rows: text(s) })) };
}

const roCount = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM users WHERE role IN ('PS_RO', 'ZP_RO')",
  );
  return Number(rows[0]?.n);
};
const auditText = async () => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM audit_log');
  return JSON.stringify(rows);
};

const GOOD: Value[][] = [
  ['PS', 'Sardarshahar', 'रमेश कुमार', '98290 11111'],
  ['ps', 'तारानगर', 'सीमा देवी', '+91 9829022222'],
];

describe('RO bulk add: template', () => {
  it('has the columns, a note and an EXAMPLE row, dropdowns, and a hidden PS list', async () => {
    const res = await getBinary(dm.agent, '/api/admin/users/bulk-template.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const { wb, sheets } = await readXlsx(res.body as Buffer);
    expect(sheets[0]?.name).toBe('ro_list');
    expect(sheets[0]?.rows[0]).toEqual(HEADERS);
    expect(sheets[0]?.rows[1]?.[0]).toContain('EXAMPLE');
    expect(sheets[0]?.rows[2]?.join(' ')).toContain('EXAMPLE');
    const main = wb.getWorksheet('ro_list');
    expect(main?.getCell('A2').dataValidation.formulae).toEqual(['"PS,ZP"']);
    expect(main?.getCell('B2').dataValidation.formulae[0]).toMatch(/^lists!\$A\$2:\$A\$\d+$/);
    expect(main?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(main?.getRow(1).font.bold).toBe(true);
    const lists = wb.getWorksheet('lists');
    expect(lists?.state).toBe('hidden');
    expect(sheets[1]?.rows.flat()).toContain('SARDARSHAHAR PANCHAYAT SAMITI');
  });

  it('the template uploaded unchanged has only error rows (the note and EXAMPLE rows)', async () => {
    const res = await getBinary(dm.agent, '/api/admin/users/bulk-template.xlsx');
    const out = await dm.post('/api/admin/users/bulk/check', {
      fileName: 't.xlsx',
      fileBase64: (res.body as Buffer).toString('base64'),
    });
    const body = out.body as CheckBody;
    expect(body.totals).toEqual({ total: 2, create: 0, exists: 0, errors: 2 });
    expect(body.rows[0]?.reasons[0]).toContain('EXAMPLE');
  });
});

describe('RO bulk add: check (preview)', () => {
  it('sorts rows into new / existing / wrong with Hindi reasons and writes nothing', async () => {
    const before = await masterSnapshot(pool);
    const audits = await dataAuditCount(pool);
    const body = await check([
      ...GOOD,
      ['PS', 'CHURU PANCHAYAT SAMITI', 'पुराना पद', '9829033333'], // ps1 has an RO
      ['ZP', null, 'ज़िला RO', '9829044444'], // ZP has an RO
      ['PS', 'Jaipur', 'गलत पीएस', '9829055555'],
      ['PS', 'तारानगर', 'मोबाइल गलत', '12345'],
      ['ZP', 'Sardarshahar', 'ZP में PS', '9829066666'],
      ['XX', null, null, null],
    ]);
    expect(body.ok).toBe(true);
    expect(body.totals).toEqual({ total: 8, create: 2, exists: 2, errors: 4 });
    expect(body.expectedSeats).toEqual([`PS:${ps3}`, `PS:${ps4}`].sort());
    const byRow = new Map(body.rows.map((r) => [r.rowNumber, r]));
    expect(byRow.get(2)).toMatchObject({ status: 'NEW', seat: `PS:${ps3}`, reasons: [] });
    expect(byRow.get(3)).toMatchObject({ status: 'NEW', seat: `PS:${ps4}` });
    expect(byRow.get(4)?.status).toBe('EXISTS');
    expect(byRow.get(4)?.reasons[0]).toContain('पहले से मौजूद है, छोड़ा गया');
    expect(byRow.get(5)?.status).toBe('EXISTS');
    expect(byRow.get(6)?.reasons[0]).toContain('"Jaipur" का नाम सूची से मेल नहीं खाता');
    expect(byRow.get(7)?.reasons[0]).toContain('मोबाइल');
    expect(byRow.get(8)?.reasons[0]).toContain('पंचायत समिति" खाली छोड़ें');
    expect(byRow.get(9)?.reasons).toHaveLength(3); // election, name, mobile
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await dataAuditCount(pool)).toBe(audits);
  });

  it('a mobile number that already belongs to an RO is skipped, not an error', async () => {
    await pool.execute("UPDATE users SET phone = '9829011111' WHERE id = ?", [w.users.ro1]);
    const body = await check([GOOD[0] ?? []]);
    expect(body.rows[0]?.status).toBe('EXISTS');
    expect(body.rows[0]?.reasons[0]).toContain('यह मोबाइल नंबर पहले से किसी RO खाते में है');
  });

  it('the same seat or mobile twice in the file is an error on every such row', async () => {
    const body = await check([
      ['PS', 'Sardarshahar', 'एक', '9829011111'],
      ['PS', 'SARDARSHAHAR PANCHAYAT SAMITI', 'दो', '9829022222'],
      ['PS', 'तारानगर', 'तीन', '9829022222'],
    ]);
    expect(body.rows.map((r) => r.status)).toEqual(['ERROR', 'ERROR', 'ERROR']);
    expect(body.rows[0]?.reasons[0]).toContain('यह पद फ़ाइल में एक से अधिक बार है (पंक्ति 2, 3)');
    expect(body.rows[2]?.reasons.join()).toContain('यह मोबाइल नंबर फ़ाइल में एक से अधिक बार है');
  });

  it('a file that is not .xlsx, has no rows, or more than 200 rows is refused', async () => {
    const bad = await dm.post('/api/admin/users/bulk/check', {
      fileName: 'x.xlsx',
      fileBase64: Buffer.from('not a zip').toString('base64'),
    });
    expect([bad.status, (bad.body as { error: string }).error]).toEqual([400, 'NOT_XLSX']);
    expect((await check([])).ok).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => [
      'PS',
      'तारानगर',
      'नाम',
      String(9000000000 + i),
    ]);
    const body = await check(many);
    expect(body.ok).toBe(false);
    expect(body.errors[0]?.message).toContain('200 से अधिक पंक्तियाँ');
  });
});

describe('RO bulk add: save', () => {
  it('creates the new accounts in one go; the credentials file has working passwords', async () => {
    const res = await save(GOOD);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as SavedBody;
    expect(body.totals.create).toBe(2);
    expect(body.created.map((c) => c.phone)).toEqual(['9829011111', '9829022222']);

    const { wb, sheets } = await readXlsx(Buffer.from(body.credentialsFile.fileBase64, 'base64'));
    const rows = sheets[0]?.rows ?? [];
    expect(rows[0]?.[0]).toContain('गोपनीय');
    expect(rows[1]).toEqual(['पद', 'RO का नाम', 'मोबाइल', 'यूज़रनेम', 'पासवर्ड']);
    expect(wb.worksheets[0]?.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
    for (const c of body.created) {
      expect(c.username).toMatch(/^ro_[a-z]{3}_[a-z2-9]{4}$/);
      expect(rows.slice(2)).toContainEqual([
        c.seatLabel,
        c.fullName,
        c.phone,
        c.username,
        c.password,
      ]);
      expect((await login(request.agent(app), c.username, c.password)).status).toBe(200);
    }

    const [users] = await pool.execute<RowDataPacket[]>(
      'SELECT role, panchayat_samiti_id, full_name, password_enc FROM users WHERE username IN (?, ?) ORDER BY panchayat_samiti_id',
      [body.created[0]?.username ?? '', body.created[1]?.username ?? ''],
    );
    expect(
      users.map((u): unknown[] => [u.role, Number(u.panchayat_samiti_id), u.full_name]),
    ).toEqual([
      ['PS_RO', ps3, 'रमेश कुमार'],
      ['PS_RO', ps4, 'सीमा देवी'],
    ]);
    expect(users.every((u) => Buffer.isBuffer(u.password_enc))).toBe(true);

    const [bulk] = await auditOf(pool, 'RO_BULK_CREATE');
    expect(bulk?.user_id).toBe(w.users.dm);
    expect(bulk?.new_value).toMatchObject({
      created: 2,
      skipped_existing: 0,
      error_rows_left_out: 0,
      usernames: body.created.map((c) => c.username),
    });
    const creates = (await auditOf(pool, 'USER_CREATE')).map(
      (r) => (r.new_value as { via: string }).via,
    );
    expect(creates).toEqual(['web-bulk', 'web-bulk']);
    const audit = await auditText();
    for (const c of body.created) expect(audit).not.toContain(c.password);
    expect(audit).not.toContain('9829011111');
  });

  it('existing seats are skipped, never overwritten', async () => {
    const [before] = await pool.execute<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [
      w.users.ro1,
    ]);
    const res = await save([...GOOD, ['PS', 'CHURU PANCHAYAT SAMITI', 'नया नाम', '9829033333']]);
    expect(res.status).toBe(201);
    expect((res.body as SavedBody).totals).toMatchObject({ create: 2, exists: 1 });
    const [after] = await pool.execute<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [
      w.users.ro1,
    ]);
    expect(after).toEqual(before);
  });

  it('error rows block the save by default; allowErrors saves only the good rows', async () => {
    const rows = [...GOOD, ['PS', 'Jaipur', 'गलत', '9829055555']];
    const before = await masterSnapshot(pool);
    const refused = await save(rows);
    expect([refused.status, (refused.body as { error: string }).error]).toEqual([
      400,
      'CHECK_FAILED',
    ]);
    expect(await masterSnapshot(pool)).toBe(before);

    const ok = await save(rows, { allowErrors: true });
    expect(ok.status).toBe(201);
    expect((ok.body as SavedBody).created).toHaveLength(2);
    expect((await auditOf(pool, 'RO_BULK_CREATE'))[0]?.new_value).toMatchObject({
      created: 2,
      error_rows_left_out: 1,
    });
  });

  it('a wrong DM password, a changed preview or nothing to create writes nothing', async () => {
    const count = await roCount();
    const wrong = await save(GOOD, { password: 'not-my-password' });
    expect([wrong.status, (wrong.body as { error: string }).error]).toEqual([401, 'REAUTH_FAILED']);
    expect(await roCount()).toBe(count);
    // From here on (the wrong try only counted against the DM's own login).
    const before = await masterSnapshot(pool);
    const stale = await save(GOOD, { expectedSeats: [`PS:${ps3}`] });
    expect([stale.status, (stale.body as { error: string }).error]).toEqual([409, 'PREVIEW_STALE']);
    const none = await save([['ZP', null, 'ज़िला RO', '9829044444']], { expectedSeats: ['ZP'] });
    expect(none.status).toBe(409);
    expect(await roCount()).toBe(count);
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await auditOf(pool, 'RO_BULK_CREATE')).toHaveLength(0);
  });
});

describe('RO details download', () => {
  it('by default has no password column; audited', async () => {
    await pool.execute("UPDATE users SET phone = '9829011111' WHERE id = ?", [w.users.ro1]);
    const res = await getBinary(dm.agent, '/api/admin/users/export.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { wb, sheets } = await readXlsx(res.body as Buffer);
    const rows = sheets[0]?.rows ?? [];
    expect(rows[0]).toEqual(['पद', 'RO का नाम', 'मोबाइल', 'यूज़रनेम', 'स्थिति', 'अंतिम लॉगिन']);
    expect(wb.worksheets[0]?.getRow(1).font.bold).toBe(true);
    expect(
      rows
        .slice(1)
        .map((r) => r[3])
        .sort(),
    ).toEqual(['ro_ps1_x1', 'ro_ps2_x2', 'zp_ro_x3']);
    expect(rows.find((r) => r[3] === 'ro_ps1_x1')).toEqual([
      'पंचायत समिति चूरू',
      'Full ro_ps1_x1',
      '9829011111',
      'ro_ps1_x1',
      'चालू',
      '—',
    ]);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    expect(await auditOf(pool, 'RO_DETAILS_DOWNLOADED')).toHaveLength(1);
  });

  it('with passwords: needs the DM password, shows a warning, audited without passwords', async () => {
    const created = (await save(GOOD)).body as SavedBody;
    const wrong = await dm.post('/api/admin/users/export-with-passwords', { password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(await auditOf(pool, 'RO_PASSWORDS_EXPORTED')).toHaveLength(0);

    const res = await dm.post('/api/admin/users/export-with-passwords', { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = res.body as { fileName: string; fileBase64: string };
    expect(out.fileName).toMatch(/^ro-details-passwords-\d{8}-\d{6}\.xlsx$/);
    const rows = (await readXlsx(Buffer.from(out.fileBase64, 'base64'))).sheets[0]?.rows ?? [];
    expect(rows[0]?.[0]).toContain('गोपनीय');
    expect(rows[1]?.at(-1)).toBe('पासवर्ड');
    for (const c of created.created)
      expect(rows.find((r) => r[3] === c.username)?.at(-1)).toBe(c.password);
    // Test-world accounts were made without an encrypted copy.
    expect(rows.find((r) => r[3] === 'ro_ps1_x1')?.at(-1)).toBe('उपलब्ध नहीं');

    const [audit] = await auditOf(pool, 'RO_PASSWORDS_EXPORTED');
    expect(audit?.user_id).toBe(w.users.dm);
    expect(audit?.new_value).toMatchObject({ accounts: 5 });
    const all = await auditText();
    for (const c of created.created) expect(all).not.toContain(c.password);
  });

  it('a name starting with = + - @ is neutralized in the downloads', async () => {
    const saved = (await save([['PS', 'तारानगर', '=HYPERLINK("x")', '9829022222']]))
      .body as SavedBody;
    const creds = (await readXlsx(Buffer.from(saved.credentialsFile.fileBase64, 'base64')))
      .sheets[0];
    expect(creds?.rows[2]?.[1]).toBe(`'=HYPERLINK("x")`);
    const res = await getBinary(dm.agent, '/api/admin/users/export.xlsx');
    const rows = (await readXlsx(res.body as Buffer)).sheets[0]?.rows ?? [];
    expect(rows.find((r) => r[3] === saved.created[0]?.username)?.[1]).toBe(`'=HYPERLINK("x")`);
  });
});

describe('RO bulk add / download: DM only', () => {
  const endpoints = (): [string, string][] => [
    ['GET', '/api/admin/users/bulk-template.xlsx'],
    ['POST', '/api/admin/users/bulk/check'],
    ['POST', '/api/admin/users/bulk/save'],
    ['GET', '/api/admin/users/export.xlsx'],
    ['POST', '/api/admin/users/export-with-passwords'],
  ];

  it('PS_RO, ZP_RO and the Super Admin get 403 everywhere and nothing changes', async () => {
    await createUser(pool, { username: 'super_admin_t1', role: 'SUPER_ADMIN', password: PASSWORD });
    const before = await masterSnapshot(pool);
    for (const username of ['ro_ps1_x1', 'zp_ro_x3', 'super_admin_t1']) {
      const c = await apiClient(app, username);
      for (const [method, path] of endpoints()) {
        const res: Response =
          method === 'GET' ? await c.get(path) : await c.post(path, await file(GOOD));
        expect([username, path, res.status]).toEqual([username, path, 403]);
      }
    }
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await auditOf(pool, 'RO_DETAILS_DOWNLOADED')).toHaveLength(0);
  });

  it('the DM writes are on the allow-list; a write without the CSRF token is refused', async () => {
    expect(dmWriteAllowed('POST', '/api/admin/users/bulk/check')).toBe(true);
    expect(dmWriteAllowed('POST', '/api/admin/users/bulk/save')).toBe(true);
    expect(dmWriteAllowed('POST', '/api/admin/users/export-with-passwords')).toBe(true);
    expect(dmWriteAllowed('POST', '/api/admin/users/bulk/other')).toBe(false);
    const res = await dm.agent
      .post('/api/admin/users/export-with-passwords')
      .send({ password: PASSWORD });
    expect(res.status).toBe(403);
    expect(await auditOf(pool, 'RO_PASSWORDS_EXPORTED')).toHaveLength(0);
  });
});
