// Booth-wise प्रारूप–14 भाग–II: the officer's title by ward kind, the mapping of one live entry, and
// GET /api/ward-forms/booths/:boothId/:ballotFor/prarup14.pdf (permissions, errors, audit).
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBoothSheet } from '../../src/modules/reports/ward-forms.data.js';
import { mapBoothPart2 } from '../../src/services/ward-forms/map-part2.js';
import { renderPart2 } from '../../src/services/ward-forms/render-part2.js';
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
  v,
  zW1Sheet,
} from '../counting/helpers.js';
import type { Client, World } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { pageCount } from './source.js';
import { agentFor, getForm } from './world.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let app: Express;
let ro1: Client;
const entry: Record<string, number> = {};
const REASON = 'Typing mistake corrected after recheck';

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  w = await buildWorld(pool);
  await pool.execute("UPDATE booth SET booth_suffix = 'A', name_hindi = ? WHERE id = ?", [
    'राजकीय प्राथमिक विद्यालय साण्डन',
    w.b2,
  ]);
  await pool.execute(
    "UPDATE app_settings SET setting_value = '2026-11-20' WHERE setting_key = 'election_date'",
  );
  await pool.execute(
    "INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('election_date', '2026-11-20')",
  );
  await createUser(pool, { username: 'sa_x9', role: 'SUPER_ADMIN', password: PASSWORD });
  app = countingApp(pool);
  ro1 = await clientFor(app, 'ro_ps1_x1');
  const ro2 = await clientFor(app, 'ro_ps2_x2');
  const made = async (c: Client, body: object) => {
    const res = await c.post('/entries', body);
    if (res.status !== 201) throw new Error(`entry: ${res.status} ${JSON.stringify(res.body)}`);
    return (res.body as { entry: { id: number } }).entry.id;
  };
  entry.psB2 = await made(ro1, psW1Sheet(w, w.b2, 300, 200, 10));
  entry.zpB2 = await made(ro1, zW1Sheet(w, w.b2, 100, 50, 5));
  entry.zpB3 = await made(ro2, zW1Sheet(w, w.b3, 70, 20, 1));
  entry.psB1 = await made(ro1, psW1Sheet(w, w.b1, 1, 2, 3));
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

const url = (booth: number, ballot: 'PS' | 'ZP') =>
  `/api/ward-forms/booths/${String(booth)}/${ballot}/prarup14.pdf`;

describe('officer title (one function of the ward kind)', () => {
  it('PS ward: रिटर्निंग अधिकारी; ZP ward: सहायक रिटर्निंग अधिकारी (never both)', () => {
    expect(part2SignatureTitle('PS')).toBe('रिटर्निंग अधिकारी');
    expect(part2SignatureTitle('ZP')).toBe('सहायक रिटर्निंग अधिकारी');
    expect(PART2.text.signatureOf).toBe('के हस्ताक्षर');
    expect(PART2.text.seal).toBe('पदनाम एवं सील');
  });

  it('header wording by kind; ZP and PS share the rest of the form', () => {
    expect(PART2.text.bodyName).toEqual({ ZP: 'जिला परिषद का नाम–', PS: 'पंचायत समिति का नाम–' });
  });
});

describe('booth sheet data (the live entry, as saved)', () => {
  it('PS ward booth 1A: label + name, candidates in ballot order, NOTA, the sheet total, date, place', async () => {
    const { head, sheet } = await readBoothSheet(pool, w.b2, 'PS');
    const d = mapBoothPart2(head, sheet, PART2);
    expect(d).toEqual({
      kind: 'PS',
      bodyName: 'पंचायत समिति चूरू',
      wardNo: '01',
      booth: '2A – राजकीय प्राथमिक विद्यालय साण्डन',
      rows: [
        { serial: '1', name: 'ए', votes: '300' },
        { serial: '2', name: 'बी', votes: '200' },
      ],
      notaSerial: '3',
      nota: '10',
      total: '510',
      date: '20.11.2026',
      place: 'चूरू',
    });
  });

  it('ZP ward booth: the Zila Parishad name (the district)', async () => {
    const { head, sheet } = await readBoothSheet(pool, w.b2, 'ZP');
    const d = mapBoothPart2(head, sheet, PART2);
    expect([d.kind, d.bodyName, d.wardNo, d.total, d.nota]).toEqual([
      'ZP',
      'चूरू',
      '01',
      '155',
      '5',
    ]);
    expect(d.rows.map((r) => r.votes)).toEqual(['100', '50']);
  });

  it('no election date set: दिनांक blank, never made up', async () => {
    await pool.execute(
      "UPDATE app_settings SET setting_value = '' WHERE setting_key = 'election_date'",
    );
    try {
      const { head, sheet } = await readBoothSheet(pool, w.b2, 'PS');
      expect(mapBoothPart2(head, sheet, PART2).date).toBeNull();
    } finally {
      await pool.execute(
        "UPDATE app_settings SET setting_value = '2026-11-20' WHERE setting_key = 'election_date'",
      );
    }
  });

  it('renders on one A4 page', async () => {
    const { head, sheet } = await readBoothSheet(pool, w.b2, 'ZP');
    expect(pageCount(await renderPart2(mapBoothPart2(head, sheet, PART2), PART2))).toBe(1);
  });
});

describe('download: permissions, errors, audit', () => {
  const as = (u: string) => agentFor(app, u);

  it('PS_RO: own PS booths, both ballots; another PS booth 403', async () => {
    const a = await as('ro_ps1_x1');
    for (const [booth, ballot] of [
      [w.b2, 'PS'],
      [w.b2, 'ZP'],
    ] as const) {
      const res = await getForm(a, url(booth, ballot));
      expect(res.status, `${String(booth)} ${ballot}`).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    }
    expect((await getForm(a, url(w.b3, 'ZP'))).status).toBe(403);
    const other = await as('ro_ps2_x2');
    expect((await getForm(other, url(w.b2, 'PS'))).status).toBe(403);
    expect((await getForm(other, url(w.b3, 'ZP'))).status).toBe(200);
  });

  it('ZP_RO: ZP ballots of any booth, never a PS ballot; DM: any; Super Admin 403; logged out 401', async () => {
    const zp = await as('zp_ro_x3');
    expect((await getForm(zp, url(w.b3, 'ZP'))).status).toBe(200);
    expect((await getForm(zp, url(w.b2, 'ZP'))).status).toBe(200);
    expect((await getForm(zp, url(w.b2, 'PS'))).status).toBe(403);
    const dm = await as('dm_x4');
    for (const [booth, ballot] of [
      [w.b2, 'PS'],
      [w.b2, 'ZP'],
      [w.b3, 'ZP'],
    ] as const)
      expect((await getForm(dm, url(booth, ballot))).status).toBe(200);
    expect((await getForm(await as('sa_x9'), url(w.b2, 'PS'))).status).toBe(403);
    expect((await getForm(request.agent(app), url(w.b2, 'PS'))).status).toBe(401);
  });

  it('file name, no-store, one REPORT_EXPORTED audit row', async () => {
    const res = await getForm(await as('ro_ps1_x1'), url(w.b2, 'PS'));
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Prarup14_PS_1_Booth2A.pdf"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.new_value).toEqual({
      section: 'booth-form-prarup14',
      format: 'pdf',
      ward_id: w.psW1,
      booth_id: w.b2,
      ballot_for: 'PS',
      entry_id: entry.psB2,
    });
  });

  it('no entry: 404 NO_ENTRY; unknown booth 404; bad params 400', async () => {
    const a = await as('ro_ps1_x1');
    const none = await getForm(a, url(w.b4, 'PS'));
    expect([none.status, none.body]).toEqual([404, { error: 'NO_ENTRY' }]);
    expect((await getForm(a, url(999999, 'PS'))).status).toBe(404);
    expect((await getForm(a, '/api/ward-forms/booths/1/XX/prarup14.pdf')).status).toBe(400);
  });

  it('after a correction the next download has the corrected votes; a voided entry is not downloadable', async () => {
    const edit = await ro1.put(`/entries/${String(entry.psB1)}`, {
      rowVersion: 1,
      sheetTotal: 16,
      votes: v([
        [w.c.A, 11],
        [w.c.B, 2],
        [w.c.N1, 3],
      ]),
      reason: REASON,
    });
    expect(edit.status).toBe(200);
    const after = await readBoothSheet(pool, w.b1, 'PS');
    expect(after.sheet.candidates.map((c) => c.votes)).toEqual([11, 2]);
    expect(after.sheet.sheetTotal).toBe(16);
    const voided = await ro1.post(`/entries/${String(entry.psB1)}/void`, {
      rowVersion: 2,
      reason: 'Entered on the wrong booth sheet',
    });
    expect(voided.status).toBe(200);
    const res = await getForm(await as('dm_x4'), url(w.b1, 'PS'));
    expect([res.status, res.body]).toEqual([404, { error: 'NO_ENTRY' }]);
  });
});
