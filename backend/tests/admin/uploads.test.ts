import { deflateRawSync } from 'node:zlib';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NOTA_NAME_HINDI } from '../../src/services/master-data/candidates.js';
import { assertXlsxStructure, decodeXlsxUpload } from '../../src/services/master-data/upload.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  CANDIDATE_HEADERS,
  PARTY_HEADERS,
  PASSWORD,
  PS1_NAME,
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
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

interface CheckBody {
  ok: boolean;
  errors: { rows: number[]; message: string }[];
  warnings: { rows: number[]; message: string }[];
  preview: unknown;
}

const partyFile = (rows: Value[][]) => xlsxBase64(PARTY_HEADERS, rows);
const candidateFile = (rows: Value[][]) => xlsxBase64(CANDIDATE_HEADERS, rows);

/** psW5 (ps1 ward 5): two candidates; ZP ward 2: one candidate (unopposed). */
const goodCandidates = (): Value[][] => [
  [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य'],
  [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', 'सामान्य'],
  [null, 'ZP', 2, 1, 'गीता', 'P2', 'F', 'महिला'],
];

async function ballotOf(wardId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT ballot_position AS pos, name_hindi AS name, party_id, gender, is_nota AS nota FROM candidate WHERE ward_id = ? ORDER BY ballot_position',
    [wardId],
  );
  return rows;
}

describe('DM party upload', () => {
  it('check writes nothing and shows a preview', async () => {
    const before = await masterSnapshot(pool);
    const audits = await dataAuditCount(pool);
    const file = await partyFile([
      ['पार्टी तीन', 'Party Three', 'P3', 'Kite'],
      ['पार्टी एक', 'Party One', 'P1', 'Lamp'],
    ]);
    const res = await dm.post('/api/admin/parties/check', { fileName: 'p.xlsx', fileBase64: file });
    expect(res.status).toBe(200);
    const body = res.body as CheckBody & {
      preview: { toInsert: { shortName: string }[]; unchanged: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.preview.toInsert.map((p) => p.shortName)).toEqual(['P3']);
    expect(body.preview.unchanged).toEqual(['P1']);
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await dataAuditCount(pool)).toBe(audits);
  });

  it('errors come back in Hindi with row numbers', async () => {
    const file = await partyFile([
      ['पार्टी तीन', 'Party Three', 'P3', 'Kite'],
      ['पार्टी चार', 'Party Four', 'p3', 'Sun'],
      ['पार्टी पाँच', 'Party Five', null, 'Moon'],
    ]);
    const res = await dm.post('/api/admin/parties/check', { fileName: 'p.xlsx', fileBase64: file });
    const body = res.body as CheckBody;
    expect(body.ok).toBe(false);
    expect(body.preview).toBeNull();
    const messages = body.errors.map((e) => e.message);
    expect(messages).toContain(
      'पंक्ति 4: "छोटा नाम" खाली है — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
    );
    expect(messages).toContain(
      'पंक्तियाँ 2, 3: छोटा नाम "P3" एक से अधिक बार है — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
    );
  });

  it('save: wrong password -> REAUTH_FAILED and nothing written', async () => {
    const before = await masterSnapshot(pool);
    const file = await partyFile([['पार्टी तीन', 'Party Three', 'P3', 'Kite']]);
    const res = await dm.post('/api/admin/parties/save', {
      fileName: 'p.xlsx',
      fileBase64: file,
      password: 'wrong-password',
    });
    expect([res.status, res.body]).toEqual([401, { error: 'REAUTH_FAILED' }]);
    // Only the failed-login counter moved (the lockout rule); no party, no data audit.
    const after = JSON.parse(await masterSnapshot(pool)) as unknown[];
    const was = JSON.parse(before) as unknown[];
    expect(after.slice(0, 4)).toEqual(was.slice(0, 4));
    expect((await auditOf(pool, 'IMPORT_PARTIES')).length).toBe(0);
    expect((await auditOf(pool, 'REAUTH_FAILED')).length).toBe(1);
  });

  it('save with an error writes nothing; a good save inserts and is audited without secrets', async () => {
    const before = await masterSnapshot(pool);
    const bad = await partyFile([['पार्टी एक', 'Other Name', 'P9', 'Kite']]); // Hindi name taken by P1
    const refused = await dm.post('/api/admin/parties/save', {
      fileName: 'p.xlsx',
      fileBase64: bad,
      password: PASSWORD,
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: string }).error).toBe('CHECK_FAILED');
    expect(await masterSnapshot(pool)).toBe(before);

    const good = await partyFile([['पार्टी तीन', 'Party Three', 'P3', 'Kite']]);
    const res = await dm.post('/api/admin/parties/save', {
      fileName: 'C:\\Users\\dm\\parties.xlsx',
      fileBase64: good,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const [audit] = await auditOf(pool, 'IMPORT_PARTIES');
    expect(audit?.user_id).toBe(w.users.dm);
    expect(audit?.new_value).toMatchObject({ via: 'web', file: 'parties.xlsx', inserted: ['P3'] });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('add one party: same rules (a duplicate short name is refused)', async () => {
    const dup = await dm.post('/api/admin/parties/add', {
      nameHindi: 'नई पार्टी',
      nameEnglish: 'New Party',
      shortName: 'p1',
      symbol: 'Star',
      password: PASSWORD,
    });
    expect(dup.status).toBe(400);
    expect(JSON.stringify(dup.body)).toContain('पार्टी \\"p1\\" पहले से सूची में है');
    const ok = await dm.post('/api/admin/parties/add', {
      nameHindi: 'नई पार्टी',
      nameEnglish: 'New Party',
      shortName: 'NP',
      symbol: 'Star',
      password: PASSWORD,
    });
    expect([ok.status, ok.body]).toEqual([201, { shortName: 'NP' }]);
    expect((await auditOf(pool, 'PARTY_ADDED')).length).toBe(1);
  });
});

describe('DM candidate upload', () => {
  it('check: preview with NOTA and unopposed, writes nothing', async () => {
    const before = await masterSnapshot(pool);
    const audits = await dataAuditCount(pool);
    const res = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile(goodCandidates()),
    });
    const body = res.body as CheckBody & {
      preview: {
        totals: { wards: number; candidates: number; unopposed: number; replaced: number };
        wards: { wardId: number; unopposed: boolean; candidates: { position: number }[] }[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.preview.totals).toEqual({ wards: 2, candidates: 3, unopposed: 1, replaced: 0 });
    expect(body.preview.wards.find((x) => x.wardId === w.zW2)?.unopposed).toBe(true);
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await dataAuditCount(pool)).toBe(audits);
  });

  it('rule errors: duplicate ballot number, gaps, a party twice — in Hindi', async () => {
    const res = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile([
        [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null],
        [PS1_NAME, 'PS', 5, 1, 'श्याम', 'P1', 'M', null],
        [null, 'ZP', 2, 1, 'गीता', null, 'F', null],
        [null, 'ZP', 2, 3, 'मीना', null, 'F', null],
      ]),
    });
    const messages = (res.body as CheckBody).errors.map((e) => e.message);
    expect(messages).toContain(
      'पंक्तियाँ 2, 3: पंचायत समिति चूरू वार्ड 5 में बैलेट नंबर 1 दो बार है — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
    );
    expect(messages).toContain(
      'पंक्तियाँ 2, 3: पंचायत समिति चूरू वार्ड 5 में पार्टी "P1" के एक से अधिक उम्मीदवार हैं — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
    );
    expect(messages).toContain(
      'पंक्तियाँ 4, 5: ज़िला परिषद वार्ड 2 में बैलेट नंबर 1 से 2 तक बिना छूटे होने चाहिए; अभी हैं: 1, 3 — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
    );
  });

  it('save with errors writes nothing', async () => {
    const before = await masterSnapshot(pool);
    const rows = goodCandidates();
    rows.push([PS1_NAME, 'PS', 4, 1, 'नया', null, 'M', null]); // psW4 is fine
    rows.push([PS1_NAME, 'PS', 1, 1, 'बदलाव', null, 'M', null]); // psW1 is LOCKED
    const res = await dm.post('/api/admin/candidates/save', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile(rows),
      password: PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('की सूची लॉक है');
    expect(await masterSnapshot(pool)).toBe(before);
    expect((await auditOf(pool, 'IMPORT_CANDIDATES')).length).toBe(0);
  });

  it('save: NOTA added at N+1, unopposed without NOTA, wards marked ready, audited', async () => {
    const res = await dm.post('/api/admin/candidates/save', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile(goodCandidates()),
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(await ballotOf(w.psW5)).toEqual([
      { pos: 1, name: 'राम', party_id: w.p1, gender: 'M', nota: 0 },
      { pos: 2, name: 'सीता', party_id: null, gender: 'F', nota: 0 },
      { pos: 3, name: NOTA_NAME_HINDI, party_id: null, gender: null, nota: 1 },
    ]);
    expect(await ballotOf(w.zW2)).toEqual([
      { pos: 1, name: 'गीता', party_id: w.p2, gender: 'F', nota: 0 },
    ]);
    const [wards] = await pool.execute<RowDataPacket[]>(
      'SELECT id, is_unopposed, reservation_category, candidates_ready_by FROM ward WHERE id IN (?, ?) ORDER BY id',
      [w.psW5, w.zW2],
    );
    expect(wards).toEqual([
      {
        id: w.psW5,
        is_unopposed: 0,
        reservation_category: 'सामान्य',
        candidates_ready_by: w.users.dm,
      },
      {
        id: w.zW2,
        is_unopposed: 1,
        reservation_category: 'महिला',
        candidates_ready_by: w.users.dm,
      },
    ]);
    const [audit] = await auditOf(pool, 'IMPORT_CANDIDATES');
    expect(audit?.new_value).toMatchObject({ via: 'web', wards_loaded: 2, candidates: 3 });
  });

  it('a ward with a counting entry is refused even if unlocked', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    // psW1 is locked; enter a booth, then (as a test-only shortcut) unlock it.
    const entry = await ro.post('/api/counting/entries', {
      wardId: w.psW1,
      boothId: w.b1,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 3,
      votes: [
        { candidateId: w.c.A, votes: 1 },
        { candidateId: w.c.B, votes: 1 },
        { candidateId: w.c.N1, votes: 1 },
      ],
    });
    expect(entry.status).toBe(201);
    await pool.execute(
      'UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL WHERE id = ?',
      [w.psW1],
    );
    const res = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile([[PS1_NAME, 'PS', 1, 1, 'बदलाव', null, 'M', null]]),
    });
    expect(JSON.stringify(res.body)).toContain('में मतगणना शुरू हो चुकी है');
  });

  it('a file without the columns, an empty file and an EXAMPLE row are explained', async () => {
    const noCols = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await xlsxBase64(['name'], [['x']]),
    });
    expect((noCols.body as CheckBody).errors[0]?.message).toContain('फ़ाइल में ये कॉलम नहीं हैं');
    const empty = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile([]),
    });
    expect((empty.body as CheckBody).errors[0]?.message).toContain('कोई भरी हुई पंक्ति नहीं');
    const example = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: await candidateFile([['EXAMPLE - X', 'PS', 1, 1, 'EXAMPLE', null, 'M', null]]),
    });
    expect((example.body as CheckBody).errors[0]?.message).toContain('EXAMPLE (नमूना) पंक्ति');
  });
});

describe('only a real .xlsx is read', () => {
  it('not base64 / not a zip / a zip without Excel parts -> NOT_XLSX', async () => {
    for (const fileBase64 of [
      '%%%not-base64%%%',
      Buffer.from('hello, this is plain text').toString('base64'),
      zipOf([{ name: 'readme.txt', data: Buffer.from('hi') }]).toString('base64'),
    ]) {
      const res = await dm.post('/api/admin/candidates/check', { fileName: 'c.xlsx', fileBase64 });
      expect([res.status, res.body]).toEqual([400, { error: 'NOT_XLSX' }]);
    }
  });

  it('more than 5 MB -> FILE_TOO_LARGE (body limit is per route; other routes keep 100 kb)', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1).toString('base64');
    const res = await dm.post('/api/admin/candidates/check', {
      fileName: 'c.xlsx',
      fileBase64: big,
    });
    expect(res.status).toBe(400);
    const small = await dm.post('/api/admin/parties/add', {
      nameHindi: 'x'.repeat(200 * 1024),
      nameEnglish: 'x',
      shortName: 'x',
      symbol: 'x',
      password: PASSWORD,
    });
    expect(small.status).toBe(413);
  });

  it('a zip bomb (huge declared uncompressed size) is refused before exceljs reads it', () => {
    const bomb = zipOf([
      { name: '[Content_Types].xml', data: Buffer.from('<x/>') },
      { name: 'xl/workbook.xml', data: Buffer.alloc(60 * 1024 * 1024, 0x20) },
    ]);
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect(() => {
      assertXlsxStructure(bomb);
    }).toThrow('NOT_XLSX');
    expect(() => decodeXlsxUpload(bomb.toString('base64'))).toThrow('NOT_XLSX');
  });
});

/** A minimal deflate ZIP writer for the tests (no CRC check is needed by our reader). */
function zipOf(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const compressed = deflateRawSync(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
