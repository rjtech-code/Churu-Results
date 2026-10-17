// ZP ST Format (State Election Commission returns): the download is the official template with only
// data filled in. A small ZP district built through the real counting/declare API:
//   ZP 1 declared (SC women seat, spans both PS, rejected postal 2)   ZP 2 declared (party XYZ -> IND)
//   ZP 3 unopposed                                                    ZP 4 counted, NOT declared
//   ZP 5 declared, winner without any details                         ZP 6 no candidates
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ZP_SHEETS,
  ZP_ST_FILE_NAME,
  writeZpStFormat,
} from '../../src/modules/reports/st-format.xlsx.js';
import type { StFormatZp, StWinnerRow } from '../../src/services/st-format-zp.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

const TEMPLATE = new URL('../../../docs/st-formats/ZP_ST_FORMAT.xlsx', import.meta.url);
const USERS = { dm: 'st_dm', zp: 'st_zp', ro: 'st_ro1' };

let pool: Pool;
let migrator: Pool;

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  await buildZpWorld(pool);
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

interface Details {
  dob?: string;
  age?: number;
  education?: string;
  mobile?: string;
  category?: string;
}

async function buildZpWorld(db: Pool): Promise<void> {
  const { ps1, ps2 } = await seedTwoPs(db);
  const party = (short: string) =>
    insert(
      db,
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      [`दल ${short}`, `Party ${short}`, short, 'चिह्न'],
    );
  const BJP = await party('BJP');
  const INC = await party('INC');
  const XYZ = await party('XYZ'); // not a column of the format: counted as IND
  const ward = (
    type: 'PS' | 'ZP',
    ps: number | null,
    no: number,
    reservation: string | null = null,
  ) =>
    insert(
      db,
      `INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no, reservation_category)
       SELECT ?, district_id, ?, ?, ? FROM panchayat_samiti WHERE id = ?`,
      [type, ps, no, reservation, ps1],
    );
  const psWard: Record<number, number> = {
    [ps1]: await ward('PS', ps1, 1),
    [ps2]: await ward('PS', ps2, 1),
  };
  const boothNo: Record<number, number> = { [ps1]: 0, [ps2]: 0 };
  const booth = (ps: number, zpWard: number, voters: number | null) =>
    insert(
      db,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ps, (boothNo[ps] = (boothNo[ps] ?? 0) + 1), 'बूथ', psWard[ps] ?? 0, zpWard, voters],
    );
  const cand = (
    w: number,
    pos: number,
    name: string,
    gender: 'M' | 'F',
    partyId: number | null,
    d: Details = {},
  ) =>
    insert(
      db,
      `INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, party_id, is_nota,
                              dob, age_stated, education, mobile, candidate_category)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        w,
        pos,
        name,
        gender,
        partyId,
        d.dob ?? null,
        d.age ?? null,
        d.education ?? null,
        d.mobile ?? null,
        d.category ?? null,
      ],
    );
  const nota = (w: number, pos: number) =>
    insert(
      db,
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, party_id, is_nota) VALUES (?, ?, 'नोटा', NULL, NULL, 1)",
      [w, pos],
    );
  const lock = (w: number) =>
    db.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE id = ?",
      [w],
    );

  const zp1 = await ward('ZP', null, 1, 'अनुसूचित जाति (महिला)');
  const zp2 = await ward('ZP', null, 2, 'सामान्य');
  const zp3 = await ward('ZP', null, 3, 'सामान्य महिला');
  const zp4 = await ward('ZP', null, 4, 'सामान्य');
  const zp5 = await ward('ZP', null, 5, 'अन्य पिछड़ा वर्ग');
  await ward('ZP', null, 6);

  const b1a = await booth(ps1, zp1, 1000);
  const b1b = await booth(ps2, zp1, 800);
  const b2 = await booth(ps1, zp2, null);
  await booth(ps2, zp3, 500);
  const b4 = await booth(ps1, zp4, 2000);
  const b5 = await booth(ps2, zp5, 900);

  const z1 = [
    await cand(zp1, 1, 'सीता', 'F', BJP, {
      dob: '1985-03-10',
      education: 'GRADUATE',
      mobile: '9876500001',
    }),
    await cand(zp1, 2, 'रामलाल', 'M', INC, { mobile: '9876500002' }),
    await nota(zp1, 3),
  ];
  const z2 = [
    await cand(zp2, 1, 'मोहन', 'M', XYZ, {
      age: 45,
      education: 'SECONDARY',
      mobile: '9876500003',
      category: 'OBC',
    }),
    await cand(zp2, 2, 'गोपाल', 'M', BJP),
    await nota(zp2, 3),
  ];
  await cand(zp3, 1, 'कमला', 'F', BJP, { age: 30, education: 'PRIMARY', category: 'GEN' });
  await db.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [zp3]);
  const z4 = [
    await cand(zp4, 1, 'अघोषित-उम्मीदवार-एक', 'M', BJP),
    await cand(zp4, 2, 'अघोषित-उम्मीदवार-दो', 'F', INC),
    await nota(zp4, 3),
  ];
  const z5 = [
    await cand(zp5, 1, 'हरि', 'M', INC),
    await cand(zp5, 2, 'श्याम', 'M', BJP),
    await nota(zp5, 3),
  ];
  for (const w of [zp1, zp2, zp3, zp4, zp5]) await lock(w);

  for (const u of [
    { username: USERS.dm, role: 'DM' as const },
    { username: USERS.zp, role: 'ZP_RO' as const },
    { username: USERS.ro, role: 'PS_RO' as const, psId: ps1 },
  ]) {
    await createUser(db, { ...u, password: PASSWORD });
  }

  const zp = await declareClient(countingApp(db), USERS.zp);
  const ok = (res: { status: number; body: unknown }, what: string) => {
    if (res.status !== 200 && res.status !== 201)
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { result?: { leader: { candidateId: number }; totalValidVotes: number } };
  };
  const votes = (ids: number[], v: number[]) =>
    ids.map((candidateId, i) => ({ candidateId, votes: v[i] ?? 0 }));
  const entry = async (wardId: number, boothId: number, ids: number[], v: number[]) =>
    ok(
      await zp.post('/entries', {
        wardId,
        boothId,
        ballotFor: 'ZP',
        roundNo: 1,
        sheetTotal: v.reduce((s, x) => s + x, 0),
        votes: votes(ids, v),
      }),
      `entry ${wardId}`,
    );
  const postal = async (wardId: number, ids: number[], v: number[], rejectedCount?: number) =>
    ok(
      await zp.post(`/wards/${wardId}/postal`, {
        sheetTotal: v.reduce((s, x) => s + x, 0),
        votes: votes(ids, v),
        ...(rejectedCount === undefined ? {} : { rejectedCount }),
      }),
      `postal ${wardId}`,
    );
  const declare = async (c: DeclareClient, wardId: number) => {
    const p = ok(await c.dpost(`/wards/${wardId}/preview`, {}), 'preview').result;
    if (!p) throw new Error('no preview');
    ok(
      await c.dpost(`/wards/${wardId}`, {
        password: PASSWORD,
        confirmWinnerCandidateId: p.leader.candidateId,
        confirmTotalValidVotes: p.totalValidVotes,
      }),
      `declare ${wardId}`,
    );
  };

  await entry(zp1, b1a, z1, [300, 200, 10]);
  await entry(zp1, b1b, z1, [100, 50, 5]);
  await postal(zp1, z1, [5, 3, 1], 2);
  await declare(zp, zp1);
  await entry(zp2, b2, z2, [400, 350, 20]);
  await postal(zp2, z2, [0, 0, 0]); // no rejected count recorded
  await declare(zp, zp2);
  await entry(zp4, b4, z4, [999, 1, 0]); // counted, never declared
  await entry(zp5, b5, z5, [200, 100, 0]);
  await postal(zp5, z5, [1, 0, 0], 0);
  await declare(zp, zp5);
}

async function as(username: string) {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}

async function download(username: string): Promise<{ wb: ExcelJS.Workbook; disposition: string }> {
  const res = await (
    await as(username)
  )
    .get('/api/st-format/zp.xlsx')
    .buffer(true)
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
  return { wb, disposition: String(res.headers['content-disposition']) };
}

async function readBook(data: Buffer | URL): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((data instanceof URL ? await readFile(data) : data) as unknown as ArrayBuffer);
  return wb;
}

const sheet = (wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet => {
  const s = wb.getWorksheet(name);
  if (!s) throw new Error(`no sheet ${name}`);
  return s;
};

/** The cell's text (rich text joined, numbers as digits; '' when empty). */
const text = (c: ExcelJS.Cell): string => c.text;
const value = (s: ExcelJS.Worksheet, ref: string) => s.getCell(ref).value as string | number | null;
const num = (s: ExcelJS.Worksheet, ref: string) => Number(value(s, ref) ?? 0);

/** Last heading row of each sheet (rows 1..n are the template's headings). */
const HEAD_ROWS: Record<string, number> = {
  [ZP_SHEETS.f14]: 7,
  [ZP_SHEETS.f15]: 7,
  [ZP_SHEETS.f16]: 7,
  [ZP_SHEETS.f16a]: 7,
  [ZP_SHEETS.f17]: 8,
  [ZP_SHEETS.f17a]: 9,
  [ZP_SHEETS.f18]: 8,
  [ZP_SHEETS.f19]: 6,
  [ZP_SHEETS.f19a]: 6,
};

/** Template rows below `after` moved down by `by` (rows added for more members). */
function expectSameLayout(
  out: ExcelJS.Workbook,
  tpl: ExcelJS.Workbook,
  shifts: Record<string, [number, number]>,
) {
  for (const t of tpl.worksheets) {
    const o = sheet(out, t.name);
    const [after, by] = shifts[t.name] ?? [Number.MAX_SAFE_INTEGER, 0];
    const move = (r: number) => (r > after ? r + by : r);
    const moveRef = (ref: string) => ref.replace(/(\d+)/g, (m) => String(move(Number(m))));
    const head = HEAD_ROWS[t.name] ?? 0;
    expect(head, t.name).toBeGreaterThan(0);
    // Headings and the footnotes below the data rows: same text.
    t.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (c, colNo) => {
        if (r <= head || r > after) {
          expect(text(o.getCell(move(r), colNo)), `${t.name} ${c.address}`).toBe(text(c));
        }
      });
    });
    expect([...o.model.merges].sort(), `${t.name} merges`).toEqual(
      t.model.merges.map(moveRef).sort(),
    );
    expect(
      o.columns.map((c) => c.width),
      `${t.name} widths`,
    ).toEqual(t.columns.map((c) => c.width));
  }
}

const fakeWinner = (n: number): StWinnerRow => ({
  wardNo: n,
  unopposed: false,
  constituencyCategory: 'UR',
  name: `सदस्य ${String(n)}`,
  dobOrAge: 40,
  party: 'BJP',
  gender: 'M',
  category: 'GEN',
  age: 40,
  education: 'GRADUATE',
  literacy: 'Graduate',
  mobile: null,
  electorate: 1000,
  polled: 900,
  rejected: 0,
  nota: 10,
  valid: 890,
  winnerVotes: 500,
  rival: { name: 'प्रतिद्वंद्वी', party: 'INC', mobile: null, votes: 390 },
  margin: 110,
});

describe('ZP ST Format download', () => {
  it('(1) sheet names and order are exactly the template (spaces included); file name; audited', async () => {
    const tpl = await readBook(TEMPLATE);
    const { wb, disposition } = await download(USERS.dm);
    expect(wb.worksheets.map((s) => s.name)).toEqual(tpl.worksheets.map((s) => s.name));
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'ST.F14 (A)',
      'ST.F15',
      'ST.F16',
      'ST.F16 (A)',
      'ST.F17',
      'ST.F17(A) ',
      'ST. F18',
      'ST.F19',
      'ST.F19(A)',
    ]);
    expect(disposition).toBe(`attachment; filename="${ZP_ST_FILE_NAME}"`);
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect((audit[0]?.new_value as { section: string }).section).toBe('st-format-zp');
  });

  it('(2) every sheet keeps the template headings, footnotes, merged ranges and widths (also with 39 rows)', async () => {
    const tpl = await readBook(TEMPLATE);
    // The district world: 4 members fit the template rows (F15 has 6, F18 has 4).
    expectSameLayout((await download(USERS.zp)).wb, tpl, {});
    // 39 members: rows are added above the footnotes; F15 data rows 8-13, F18 9-12.
    const winners = Array.from({ length: 39 }, (_, i) => fakeWinner(i + 1));
    const zeros = { GEN: 0, SC: 0, ST: 0, OBC: 0 };
    const party = <T>(v: T) => ({
      AAP: v,
      BSP: v,
      BJP: v,
      'CPI(M)': v,
      INC: v,
      NPP: v,
      RLP: v,
      BAP: v,
      IND: v,
    });
    const model: StFormatZp = {
      totalWards: 39,
      winners,
      f14: {
        postal: 0,
        evm: 0,
        totalValid: 0,
        votes: { ...party(0), NOTA: 0 },
        percent: { ...party(null), NOTA: null },
      },
      f16: { M: zeros, F: zeros, TG: 0 },
      f16a: { reserved: zeros, reservedTotal: 0, elected: zeros, electedTotal: 0 },
      f17: party({ ...zeros, TOTAL: 0 }),
      f17a: party({ M: 0, F: 0, TG: 0, TOTAL: 0 }),
      f19: {
        buckets: [0, 0, 0, 0, 0].map(() => ({ M: 0, F: 0 })),
        total: { M: 0, F: 0, TG: 0 },
        grand: 0,
      },
      f19a: {
        levels: Object.fromEntries(
          [
            'ILLITERATE',
            'LITERATE',
            'PRIMARY',
            'UPPER_PRIMARY',
            'SECONDARY',
            'SR_SECONDARY',
            'GRADUATE',
            'POST_GRADUATE',
            'PROFESSIONAL',
          ].map((e) => [e, { M: 0, F: 0 }]),
        ) as StFormatZp['f19a']['levels'],
        total: { M: 0, F: 0, TG: 0 },
        grand: 0,
      },
      warnings: {
        totalWards: 39,
        declaredWards: 39,
        includedWards: 39,
        unopposedWards: [],
        excludedWards: [],
        missing: { age: [], education: [], mobile: [], category: [] },
        partiesAsInd: [],
        reservationUnknown: [],
        rejectedUnknown: [],
        electorateUnknown: [],
        excludedByWard: [],
        missingByWard: [],
        otherByWard: [],
      },
    };
    const big = await readBook(await writeZpStFormat(model, await readFile(TEMPLATE)));
    expectSameLayout(big, tpl, { [ZP_SHEETS.f15]: [13, 33], [ZP_SHEETS.f18]: [12, 35] });
    const f15 = sheet(big, ZP_SHEETS.f15);
    const f18 = sheet(big, ZP_SHEETS.f18);
    expect([value(f15, 'A46'), value(f15, 'C46'), value(f15, 'E46')]).toEqual([39, 39, 'सदस्य 39']);
    expect([value(f18, 'A47'), value(f18, 'C47'), value(f18, 'V47')]).toEqual([39, 39, 110]);
  });

  it('(3) totals agree across sheets: F14 = F18 (valid + NOTA); F17 = F15 rows = F16 = F19 (age known)', async () => {
    const { wb } = await download(USERS.dm);
    const f14 = sheet(wb, ZP_SHEETS.f14);
    const f15 = sheet(wb, ZP_SHEETS.f15);
    const f16 = sheet(wb, ZP_SHEETS.f16);
    const f17 = sheet(wb, ZP_SHEETS.f17);
    const f18 = sheet(wb, ZP_SHEETS.f18);
    const f19 = sheet(wb, ZP_SHEETS.f19);

    // F15: members of wards 1, 2, 3 (unopposed), 5; ward 4 is not declared.
    const rows15 = [8, 9, 10, 11].map((r) =>
      ['C', 'D', 'E', 'F', 'G', 'H', 'I'].map((c) => value(f15, `${c}${String(r)}`)),
    );
    expect(rows15).toEqual([
      [1, 'SC (W)', 'सीता', '10/03/1985', 'BJP', 'F', 'SC'], // category from the SC seat
      [2, 'UR', 'मोहन', 45, 'IND', 'M', 'OBC'], // XYZ -> IND; own category
      [3, 'UR (W)', 'कमला', 30, 'BJP', 'F', 'GEN'],
      [5, 'OBC', 'हरि', null, 'INC', 'M', 'OBC'], // no details: DOB/AGE empty
    ]);
    expect(value(f15, 'C12')).toBeNull();

    // F14 (A): BJP 405+350+100, INC 253+201, IND 400, NOTA 16+20; postal 9+0+1.
    const f14Row = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].map((c) =>
      value(f14, `${c}8`),
    );
    expect(f14Row).toEqual([6, 10, 1735, 1745, 0, 0, 855, 0, 454, 0, 0, 0, 400, 36]);
    expect(value(f14, 'S8')).toBe(49); // 855 / 1745 = 48.997% -> 49 (2 decimals)
    expect(value(f14, 'Z8')).toBe(2.06);
    expect(['C', 'F', 'I', 'P'].map((c) => value(f14, `${c}10`))).toEqual([6, 1745, 855, 36]);

    // F18: ward 1 polled 674 + 2 rejected; ward 2 rejected unknown -> polled/rejected empty;
    // unopposed ward 3: no vote columns at all.
    const f18Row = (r: number) =>
      ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'M', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'].map((c) =>
        value(f18, `${c}${String(r)}`),
      );
    expect(f18Row(9)).toEqual([
      1,
      'SC (W)',
      1800,
      676,
      2,
      16,
      658,
      405,
      'Graduate',
      '9876500001',
      'रामलाल',
      'INC',
      '9876500002',
      253,
      152,
    ]);
    expect(f18Row(10)).toEqual([
      2,
      'UR',
      null,
      null,
      null,
      20,
      750,
      400,
      'Secondary',
      '9876500003',
      'गोपाल',
      'BJP',
      null,
      350,
      50,
    ]);
    expect(f18Row(11)).toEqual([
      3,
      'UR (W)',
      500,
      null,
      null,
      null,
      null,
      null,
      'Primary',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(f18Row(12)).toEqual([
      5,
      'OBC',
      900,
      301,
      0,
      0,
      301,
      201,
      null,
      null,
      'श्याम',
      'BJP',
      null,
      100,
      101,
    ]);

    let validPlusNota = 0;
    for (const r of [9, 10, 11, 12])
      validPlusNota += num(f18, `I${String(r)}`) + num(f18, `H${String(r)}`);
    expect(num(f14, 'F8')).toBe(validPlusNota);

    const f15Rows = rows15.length;
    let f17Total = 0;
    for (const c of ['H', 'M', 'R', 'W', 'AB', 'AG', 'AL', 'AQ', 'AV'])
      f17Total += num(f17, `${c}9`);
    let f16Total = 0;
    for (const c of ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) f16Total += num(f16, `${c}8`);
    const withAge = rows15.filter((r) => r[3] !== null).length;
    expect(f17Total).toBe(f15Rows);
    expect(f16Total).toBe(f15Rows);
    expect(num(f19, 'Q7')).toBe(withAge);
    expect(withAge).toBe(3);
    // F19: 41 (F, 36-50), 45 (M, 36-50), 30 (F, 26-35).
    expect(['F', 'G', 'H', 'I', 'N', 'O', 'P'].map((c) => num(f19, `${c}7`))).toEqual([
      0, 1, 1, 1, 1, 2, 0,
    ]);
    // F17 TOTAL row = the data row.
    expect(num(f17, 'M11')).toBe(num(f17, 'M9'));
  });

  it('(4) an undeclared ward is in no sheet; PS_RO gets 403, the ZP_RO 200', async () => {
    const { wb } = await download(USERS.zp);
    for (const s of wb.worksheets) {
      s.eachRow((row) => {
        row.eachCell((c) => {
          expect(text(c), `${s.name} ${c.address}`).not.toContain('अघोषित');
        });
      });
    }
    // The template's data rows only (F15 8-13, F18 9-12; the footnotes follow).
    for (const [name, first, last] of [
      [ZP_SHEETS.f15, 8, 13],
      [ZP_SHEETS.f18, 9, 12],
    ] as const) {
      const s = sheet(wb, name);
      const wardNos = Array.from({ length: last - first + 1 }, (_, i) =>
        value(s, `C${String(first + i)}`),
      ).filter((v) => v !== null);
      expect(wardNos, name).toEqual([1, 2, 3, 5]);
    }
    // Its 999 + 1 votes are not in any total.
    expect(value(sheet(wb, ZP_SHEETS.f14), 'F8')).toBe(1745);

    const summary = await (await as(USERS.zp)).get('/api/st-format/zp/summary');
    expect(summary.status).toBe(200);
    const w = (summary.body as { warnings: Record<string, unknown> }).warnings;
    expect([
      w.declaredWards,
      w.includedWards,
      w.unopposedWards,
      w.partiesAsInd,
      w.rejectedUnknown,
    ]).toEqual([4, 4, [3], ['XYZ'], [2]]);
    // Once per ward, for the panel's table: ward 3 has no mobile; ward 5's winner has no details
    // (its category comes from the OBC seat).
    expect(w.missingByWard).toEqual([
      { ps: null, wardNo: 3, missing: ['MOBILE'] },
      { ps: null, wardNo: 5, missing: ['AGE', 'EDUCATION', 'MOBILE'] },
    ]);

    const ro = await as(USERS.ro);
    for (const p of ['/api/st-format/zp.xlsx', '/api/st-format/zp/summary']) {
      expect((await ro.get(p)).status, p).toBe(403);
    }
  });
});
