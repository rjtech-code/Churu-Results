// PS ST Format (Panchayat Samiti members): the download is the official template with only data
// filled in. Two PS built through the real counting/declare API:
//   CHURU PS:   ward 1 declared (SC women seat, rejected postal 2)   ward 2 unopposed
//               ward 3 counted, NOT declared                       ward 4 declared (XYZ -> IND)
//   RAJGARH PS: ward 1 declared (winner without details)           ward 2 no candidates
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PS_SHEETS,
  PS_ST_FILE_NAME,
  writePsStFormat,
} from '../../src/modules/reports/st-format-ps.xlsx.js';
import { winnerCounts } from '../../src/services/st-format-common.js';
import type { CollectedWard, StWinnerRow, VoteShare } from '../../src/services/st-format-common.js';
import type { StFormatPs } from '../../src/services/st-format-ps.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

const TEMPLATE = new URL('../../../docs/st-formats/PS_ST_FORMAT.xlsx', import.meta.url);
const USERS = { dm: 'stp_dm', zp: 'stp_zp', ro1: 'stp_ro1', ro2: 'stp_ro2' };
const PS1 = 'CHURU PANCHAYAT SAMITI';
const PS2 = 'RAJGARH PANCHAYAT SAMITI';

let pool: Pool;
let migrator: Pool;
let ids: { ps1: number; ps2: number };

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  ids = await buildPsWorld(pool);
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

async function buildPsWorld(db: Pool): Promise<{ ps1: number; ps2: number }> {
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
  const zpWard = await ward('ZP', null, 1); // every booth's ZP ward; no candidates
  const boothNo: Record<number, number> = { [ps1]: 0, [ps2]: 0 };
  const booth = (ps: number, psWard: number, voters: number | null) =>
    insert(
      db,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ps, (boothNo[ps] = (boothNo[ps] ?? 0) + 1), 'बूथ', psWard, zpWard, voters],
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

  const a1 = await ward('PS', ps1, 1, 'अनुसूचित जाति (महिला)');
  const a2 = await ward('PS', ps1, 2, 'सामान्य महिला');
  const a3 = await ward('PS', ps1, 3, 'सामान्य');
  const a4 = await ward('PS', ps1, 4, 'सामान्य');
  const b1 = await ward('PS', ps2, 1, 'अन्य पिछड़ा वर्ग');
  const b2 = await ward('PS', ps2, 2);

  const bA1 = await booth(ps1, a1, 1000);
  await booth(ps1, a2, 500);
  const bA3 = await booth(ps1, a3, 2000);
  const bA4 = await booth(ps1, a4, null);
  const bB1 = await booth(ps2, b1, 900);
  await booth(ps2, b2, 700);

  const c1 = [
    await cand(a1, 1, 'सीता', 'F', BJP, {
      dob: '1985-03-10',
      education: 'GRADUATE',
      mobile: '9876500001',
    }),
    await cand(a1, 2, 'रामलाल', 'M', INC, { mobile: '9876500002' }),
    await nota(a1, 3),
  ];
  await cand(a2, 1, 'कमला', 'F', BJP, { age: 30, education: 'PRIMARY', category: 'GEN' });
  await db.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [a2]);
  const c3 = [
    await cand(a3, 1, 'अघोषित-उम्मीदवार-एक', 'M', BJP),
    await cand(a3, 2, 'अघोषित-उम्मीदवार-दो', 'F', INC),
    await nota(a3, 3),
  ];
  const c4 = [
    await cand(a4, 1, 'मोहन', 'M', XYZ, {
      age: 45,
      education: 'SECONDARY',
      mobile: '9876500003',
      category: 'OBC',
    }),
    await cand(a4, 2, 'गोपाल', 'M', BJP),
    await nota(a4, 3),
  ];
  const d1 = [
    await cand(b1, 1, 'हरि', 'M', INC),
    await cand(b1, 2, 'श्याम', 'M', BJP),
    await nota(b1, 3),
  ];
  for (const w of [a1, a2, a3, a4, b1]) await lock(w);

  for (const u of [
    { username: USERS.dm, role: 'DM' as const },
    { username: USERS.zp, role: 'ZP_RO' as const },
    { username: USERS.ro1, role: 'PS_RO' as const, psId: ps1 },
    { username: USERS.ro2, role: 'PS_RO' as const, psId: ps2 },
  ]) {
    await createUser(db, { ...u, password: PASSWORD });
  }

  const app = countingApp(db);
  const ro1 = await declareClient(app, USERS.ro1);
  const ro2 = await declareClient(app, USERS.ro2);
  const ok = (res: { status: number; body: unknown }, what: string) => {
    if (res.status !== 200 && res.status !== 201)
      throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { result?: { leader: { candidateId: number }; totalValidVotes: number } };
  };
  const votes = (cs: number[], v: number[]) =>
    cs.map((candidateId, i) => ({ candidateId, votes: v[i] ?? 0 }));
  const entry = async (
    c: DeclareClient,
    wardId: number,
    boothId: number,
    cs: number[],
    v: number[],
  ) =>
    ok(
      await c.post('/entries', {
        wardId,
        boothId,
        ballotFor: 'PS',
        roundNo: 1,
        sheetTotal: v.reduce((s, x) => s + x, 0),
        votes: votes(cs, v),
      }),
      `entry ${wardId}`,
    );
  const postal = async (
    c: DeclareClient,
    wardId: number,
    cs: number[],
    v: number[],
    rejectedCount?: number,
  ) =>
    ok(
      await c.post(`/wards/${wardId}/postal`, {
        sheetTotal: v.reduce((s, x) => s + x, 0),
        votes: votes(cs, v),
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

  await entry(ro1, a1, bA1, c1, [300, 200, 10]);
  await postal(ro1, a1, c1, [5, 3, 1], 2);
  await declare(ro1, a1);
  await entry(ro1, a3, bA3, c3, [999, 1, 0]); // counted, never declared
  await entry(ro1, a4, bA4, c4, [400, 350, 20]);
  await postal(ro1, a4, c4, [0, 0, 0]); // no rejected count recorded
  await declare(ro1, a4);
  await entry(ro2, b1, bB1, d1, [200, 100, 0]);
  await postal(ro2, b1, d1, [1, 0, 0], 0);
  await declare(ro2, b1);
  return { ps1, ps2 };
}

async function as(username: string) {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}

async function download(
  username: string,
  query = '',
): Promise<{ wb: ExcelJS.Workbook; disposition: string }> {
  const res = await (
    await as(username)
  )
    .get(`/api/st-format/ps.xlsx${query}`)
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
const row = (s: ExcelJS.Worksheet, r: number, cols: string[]) =>
  cols.map((c) => value(s, `${c}${String(r)}`));

/** Last heading row of each sheet (rows 1..n are the template's headings). */
const HEAD_ROWS: Record<string, number> = {
  [PS_SHEETS.f14]: 8,
  [PS_SHEETS.f15]: 7,
  [PS_SHEETS.f16]: 8,
  [PS_SHEETS.f16a]: 8,
  [PS_SHEETS.f16b]: 7,
  [PS_SHEETS.f16c]: 7,
  [PS_SHEETS.f17]: 8,
  [PS_SHEETS.f17a]: 8,
  [PS_SHEETS.f18]: 8,
  [PS_SHEETS.f19]: 6,
  [PS_SHEETS.f19a]: 6,
};

/** Template rows below `after` moved down by `by` (rows added for more PS / members). */
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
    t.eachRow({ includeEmpty: false }, (r, n) => {
      r.eachCell({ includeEmpty: false }, (c, colNo) => {
        // Headings, and every label below the data rows (TOTAL, footnotes).
        if (n <= head || (n > after + 1 && text(c) !== '')) {
          expect(text(o.getCell(move(n), colNo)), `${t.name} ${c.address}`).toBe(text(c));
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

describe('PS ST Format download', () => {
  it('(1) sheet names and order are exactly the template; official file names; audited', async () => {
    const tpl = await readBook(TEMPLATE);
    const { wb, disposition } = await download(USERS.dm);
    expect(wb.worksheets.map((s) => s.name)).toEqual(tpl.worksheets.map((s) => s.name));
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'ST.F14 (A)',
      'ST.F.15',
      'ST.F.16 ',
      'ST.F16 (A)',
      'ST.F16 (B)',
      'ST.F16 (C) ',
      'ST.F17',
      'ST.F17A',
      'ST.F18',
      'ST.F19',
      'ST.F19 (A)',
    ]);
    expect(disposition).toBe(`attachment; filename="${PS_ST_FILE_NAME}"`);
    expect(PS_ST_FILE_NAME).toBe('ST_FORMAT_Panchyat_Samiti_Members_Election_2026.xlsx');
    const one = await download(USERS.dm, `?ps=${String(ids.ps2)}`);
    expect(one.disposition).toBe(
      'attachment; filename="ST_FORMAT_Panchyat_Samiti_Members_Election_2026_RAJGARH_PANCHAYAT_SAMITI.xlsx"',
    );
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1",
    );
    expect(audit[0]?.new_value).toMatchObject({ section: 'st-format-ps', ps_id: ids.ps2 });
  });

  it('(2) every sheet keeps the template headings, TOTAL labels, footnotes, merges and widths (also with 13 PS / 231 rows)', async () => {
    const tpl = await readBook(TEMPLATE);
    // Two PS and four members: they fit the template rows.
    expectSameLayout((await download(USERS.dm)).wb, tpl, {});
    // 13 PS and 231 members: rows are added inside each data block (after its second-to-last row).
    const share: VoteShare = {
      postal: 0,
      evm: 0,
      totalValid: 0,
      votes: {
        AAP: 0,
        BSP: 0,
        BJP: 0,
        'CPI(M)': 0,
        INC: 0,
        NPP: 0,
        RLP: 0,
        BAP: 0,
        IND: 0,
        NOTA: 0,
      },
      percent: {
        AAP: null,
        BSP: null,
        BJP: null,
        'CPI(M)': null,
        INC: null,
        NPP: null,
        RLP: null,
        BAP: null,
        IND: null,
        NOTA: null,
      },
    };
    const winner = (n: number): StWinnerRow & { psName: string } => ({
      psName: `PS ${String(Math.ceil(n / 18))}`,
      wardNo: n,
      unopposed: true,
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
      polled: null,
      rejected: null,
      nota: null,
      valid: null,
      winnerVotes: null,
      rival: null,
      margin: null,
    });
    const winners = Array.from({ length: 231 }, (_, i) => winner(i + 1));
    const collected: CollectedWard[] = winners.map((w, i) => ({
      wardId: i + 1,
      psId: 1,
      row: w,
      reservation: null,
      result: null,
    }));
    const counts = winnerCounts(collected);
    const model: StFormatPs = {
      psId: null,
      ps: Array.from({ length: 13 }, (_, i) => ({
        psId: i + 1,
        psName: `PS ${String(i + 1)}`,
        totalWards: 18,
        share,
        counts,
      })),
      district: { psCount: 13, totalWards: 231, counts },
      total: { totalWards: 231, counts },
      winners,
      warnings: {
        totalWards: 231,
        declaredWards: 231,
        includedWards: 231,
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
        psWithoutMembers: [],
      },
    };
    const big = await readBook(await writePsStFormat(model, await readFile(TEMPLATE)));
    expectSameLayout(big, tpl, {
      [PS_SHEETS.f14]: [14, 6],
      [PS_SHEETS.f15]: [10, 227],
      [PS_SHEETS.f16a]: [10, 10],
      [PS_SHEETS.f16c]: [9, 10],
      [PS_SHEETS.f17]: [9, 11],
      [PS_SHEETS.f17a]: [13, 7],
      [PS_SHEETS.f18]: [11, 227],
      [PS_SHEETS.f19]: [11, 7],
      [PS_SHEETS.f19a]: [8, 10],
    });
    expect(row(sheet(big, PS_SHEETS.f15), 238, ['A', 'D', 'F'])).toEqual([231, 231, 'सदस्य 231']);
    expect(row(sheet(big, PS_SHEETS.f18), 239, ['A', 'D', 'L'])).toEqual([231, 231, 40]);
    // TOTAL rows moved down with the PS rows, and hold values (no formulas).
    expect(row(sheet(big, PS_SHEETS.f16a), 22, ['A', 'D', 'H'])).toEqual(['TOTAL ', 231, 0]);
    expect(row(sheet(big, PS_SHEETS.f19), 20, ['A', 'D', 'R'])).toEqual(['Total', 231, 231]);
  });

  it('(3) totals agree across sheets: F14 = F18 (valid + NOTA) per PS; F17 = F15 rows = F.16 = F19 (age known)', async () => {
    const { wb } = await download(USERS.dm);
    const f14 = sheet(wb, PS_SHEETS.f14);
    const f15 = sheet(wb, PS_SHEETS.f15);
    const f16 = sheet(wb, PS_SHEETS.f16);
    const f17 = sheet(wb, PS_SHEETS.f17);
    const f18 = sheet(wb, PS_SHEETS.f18);
    const f19 = sheet(wb, PS_SHEETS.f19);

    // F.15: CHURU wards 1, 2 (unopposed), 4; RAJGARH ward 1. Ward 3 is not declared.
    const rows15 = [8, 9, 10, 11].map((r) => row(f15, r, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']));
    expect(rows15).toEqual([
      [PS1, 1, 'SC(W)', 'सीता', '10/03/1985', 'BJP', 'F', 'SC'], // category from the SC seat
      [PS1, 2, 'UR(W)', 'कमला', 30, 'BJP', 'F', 'GEN'],
      [PS1, 4, 'UR', 'मोहन', 45, 'IND', 'M', 'OBC'], // XYZ -> IND; own category
      [PS2, 1, 'OBC', 'हरि', null, 'INC', 'M', 'OBC'], // no details: DOB/AGE empty
    ]);

    // F14 (A): one row per PS. CHURU: BJP 305+350, INC 203, IND 400, NOTA 11+20.
    const cols14 = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];
    expect(row(f14, 9, cols14)).toEqual([
      PS1,
      4,
      9,
      1280,
      1289,
      0,
      0,
      655,
      0,
      203,
      0,
      0,
      0,
      400,
      31,
    ]);
    expect(row(f14, 10, cols14)).toEqual([PS2, 2, 1, 300, 301, 0, 0, 100, 0, 201, 0, 0, 0, 0, 0]);
    expect(value(f14, 'C11')).toBeNull(); // no TOTAL row in this template sheet

    // F18: ward 1 polled 519 + 2 rejected, valid = 521 - 2 - 11; ward 4 rejected unknown;
    // unopposed ward 2: no vote columns. AGE column: a number only.
    const cols18 = [
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'L',
      'N',
      'Q',
      'R',
      'S',
      'T',
      'U',
      'V',
      'W',
    ];
    expect(row(f18, 9, cols18)).toEqual([
      PS1,
      1,
      'SC(W)',
      1000,
      521,
      2,
      11,
      508,
      41,
      305,
      'Graduate',
      '9876500001',
      'रामलाल',
      'INC',
      '9876500002',
      203,
      102,
    ]);
    expect(row(f18, 10, cols18)).toEqual([
      PS1,
      2,
      'UR(W)',
      500,
      null,
      null,
      null,
      null,
      30,
      null,
      'Primary',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(row(f18, 11, cols18)).toEqual([
      PS1,
      4,
      'UR',
      null,
      null,
      null,
      20,
      750,
      45,
      400,
      'Secondary',
      '9876500003',
      'गोपाल',
      'BJP',
      null,
      350,
      50,
    ]);
    expect(row(f18, 12, cols18)).toEqual([
      PS2,
      1,
      'OBC',
      900,
      301,
      0,
      0,
      301,
      null,
      201,
      null,
      null,
      'श्याम',
      'BJP',
      null,
      100,
      101,
    ]);

    for (const [f14Row, ps] of [
      [9, PS1],
      [10, PS2],
    ] as const) {
      let validPlusNota = 0;
      for (const r of [9, 10, 11, 12]) {
        if (value(f18, `C${String(r)}`) === ps)
          validPlusNota += num(f18, `J${String(r)}`) + num(f18, `I${String(r)}`);
      }
      expect(num(f14, `G${String(f14Row)}`), ps).toBe(validPlusNota);
    }

    const members = rows15.length;
    let f17Total = 0;
    for (const c of ['I', 'N', 'S', 'X', 'AC', 'AH', 'AM', 'AR', 'AW'])
      f17Total += num(f17, `${c}11`);
    let f16Total = 0;
    for (const c of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) f16Total += num(f16, `${c}9`);
    const withAge = rows15.filter((r) => r[4] !== null).length;
    expect(f17Total).toBe(members);
    expect(f16Total).toBe(members);
    expect(num(f19, 'R13')).toBe(withAge);
    expect(withAge).toBe(3);
    // ST.F.16: both PS have a member; 6 PS wards; TOTAL row = the district row.
    expect(row(f16, 9, ['C', 'D', 'H', 'I', 'J'])).toEqual([2, 6, 2, 1, 1]);
    expect(row(f16, 12, ['C', 'D', 'H', 'I', 'J'])).toEqual([2, 6, 2, 1, 1]);
  });

  it('(4) undeclared ward in no sheet; PS_RO sees only their own PS; 403 for other PS, ZP_RO and the ZP file', async () => {
    const { wb } = await download(USERS.dm);
    for (const s of wb.worksheets) {
      s.eachRow((r) => {
        r.eachCell((c) => {
          expect(text(c), `${s.name} ${c.address}`).not.toContain('अघोषित');
        });
      });
    }
    expect(value(sheet(wb, PS_SHEETS.f14), 'G9')).toBe(1289); // its 999 + 1 votes are in no total

    // RAJGARH's RO: only RAJGARH, whatever the query says.
    const own = await download(USERS.ro2);
    const f14 = sheet(own.wb, PS_SHEETS.f14);
    expect(row(f14, 9, ['C', 'D', 'G'])).toEqual([PS2, 2, 301]);
    expect(value(f14, 'C10')).toBeNull();
    for (const s of own.wb.worksheets) {
      s.eachRow((r) => {
        r.eachCell((c) => {
          expect(text(c), `${s.name} ${c.address}`).not.toContain(PS1);
        });
      });
    }
    expect(row(sheet(own.wb, PS_SHEETS.f16), 9, ['C', 'D'])).toEqual([1, 2]);
    expect(own.disposition).toContain('_RAJGARH_PANCHAYAT_SAMITI.xlsx');
    expect((await download(USERS.ro2, `?ps=${String(ids.ps2)}`)).wb.worksheets).toHaveLength(11);

    const ro2 = await as(USERS.ro2);
    const other = `?ps=${String(ids.ps1)}`;
    for (const p of [
      `/api/st-format/ps.xlsx${other}`,
      `/api/st-format/ps/summary${other}`,
      '/api/st-format/zp.xlsx',
    ]) {
      expect((await ro2.get(p)).status, p).toBe(403);
    }
    const zp = await as(USERS.zp);
    for (const p of ['/api/st-format/ps.xlsx', '/api/st-format/ps/summary']) {
      expect((await zp.get(p)).status, p).toBe(403);
    }
    expect((await request(buildApp(pool)).get('/api/st-format/ps.xlsx')).status).toBe(401);

    // The DM, one PS: ST.F.16 counts that PS only.
    const dmOne = await download(USERS.dm, `?ps=${String(ids.ps1)}`);
    expect(row(sheet(dmOne.wb, PS_SHEETS.f16), 9, ['C', 'D'])).toEqual([1, 4]);

    const summary = await (await as(USERS.ro1)).get('/api/st-format/ps/summary');
    expect(summary.status).toBe(200);
    const w = (summary.body as { warnings: Record<string, unknown> }).warnings;
    expect([w.declaredWards, w.unopposedWards, w.partiesAsInd, w.rejectedUnknown]).toEqual([
      3,
      [`${PS1} - Ward 2`],
      ['XYZ'],
      [`${PS1} - Ward 4`],
    ]);
    // Once per ward, grouped by PS in the panel: only ward 2's winner lacks a mobile.
    expect(w.missingByWard).toEqual([{ ps: PS1, wardNo: 2, missing: ['MOBILE'] }]);
  });
});
