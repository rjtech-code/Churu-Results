import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/modules/reports/csv.js';
import { readReportData } from '../../src/modules/reports/reports.data.js';
import { buildReport, isCloseContest } from '../../src/services/reports.js';
import type { ReportSummary } from '../../src/services/reports.js';
import { buildApp, csrfToken, login } from '../auth/helpers.js';
import { PASSWORD } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';
import { HYPERLINK, buildReportWorld } from './world.js';
import type { ReportWorld } from './world.js';

let pool: Pool;
let migrator: Pool;
let world: ReportWorld;

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  world = await buildReportWorld(pool, migrator);
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

async function as(username: string) {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}
async function summary(): Promise<ReportSummary> {
  const res = await (await as(world.users.dm)).get('/api/reports/summary');
  expect(res.status).toBe(200);
  return res.body as ReportSummary;
}
const id = (key: string) => world.w[key]?.id ?? 0;
const wardIds = (list: { ward: { id: number } }[]) => list.map((x) => x.ward.id);

describe('access: DM only', () => {
  const paths = () => [
    '/api/reports/summary',
    `/api/reports/wards/${id('close100')}`,
    '/api/reports/export.csv?section=progress',
  ];

  it('PS_RO and ZP_RO get 403; logged out 401; the DM 200', async () => {
    for (const u of [world.users.ro1, world.users.zp]) {
      const agent = await as(u);
      for (const p of paths()) expect((await agent.get(p)).status, `${u} ${p}`).toBe(403);
    }
    const anon = request(buildApp(pool));
    for (const p of paths()) expect((await anon.get(p)).status, p).toBe(401);
    const dm = await as(world.users.dm);
    for (const p of paths()) expect((await dm.get(p)).status, p).toBe(200);
  });

  it('the DM still cannot write (global guard), even on /api/reports', async () => {
    const dm = await as(world.users.dm);
    const token = await csrfToken(dm);
    expect((await dm.post('/api/reports/summary').set('X-CSRF-Token', token).send({})).status).toBe(
      403,
    );
    expect(
      (await dm.post('/api/counting/entries').set('X-CSRF-Token', token).send({})).status,
    ).toBe(403);
  });
});

describe('sections, against the hand-built district', () => {
  let s: ReportSummary;
  beforeAll(async () => {
    s = await summary();
  });

  it('scopes: all PS together, each PS, ZP', () => {
    expect(s.scopes.map((x) => x.key)).toEqual([
      'ALL_PS',
      `PS:${world.ps1}`,
      `PS:${world.ps2}`,
      'ZP',
    ]);
    expect(s.scopes[0]?.label).toBe('सभी पंचायत समितियाँ');
    expect(s.scopes.at(-1)?.label).toBe('ज़िला परिषद');
  });

  it('progress per scope', () => {
    expect(s.sections[`PS:${world.ps1}`]?.progress).toEqual({
      wardsTotal: 10,
      declared: 7, // close100, close1pct, notClose, lottery (tie-resolved), corrected, notaHigh, mismatch
      unopposed: 1,
      counting: 0,
      notStarted: 1, // zpBooth
      noCandidates: 0,
      unavailable: 1, // broken
      boothsEntered: 7,
      boothsTotal: 10, // one booth per ward (the unopposed ward's too)
      postalEntered: 7,
      postalTotal: 9, // the unopposed ward needs no postal entry
    });
  });

  it('women winners: declared, lottery and unopposed women; a woman who only leads is not counted', () => {
    const all = s.sections.ALL_PS;
    expect(all?.women.total).toBe(3);
    expect(wardIds(all?.women.list ?? []).sort()).toEqual(
      [id('close100'), id('lottery'), id('unopposed')].sort(),
    );
    expect(all?.women.list.find((r) => r.ward.id === id('unopposed'))).toMatchObject({
      name: 'गीता',
      status: 'UNOPPOSED',
    });
    expect(all?.women.list.find((r) => r.ward.id === id('lottery'))).toMatchObject({
      name: 'कमला',
      status: 'TIE_RESOLVED',
      party: { shortName: null, nameHindi: 'निर्दलीय' },
    });
    // equal counts: by Hindi party name (दूसरा < निर्दलीय < पहला)
    expect(all?.women.byParty).toEqual([
      { party: { shortName: 'P2', nameHindi: 'दूसरा दल' }, count: 1 },
      { party: { shortName: null, nameHindi: 'निर्दलीय' }, count: 1 },
      { party: { shortName: 'P1', nameHindi: 'पहला दल' }, count: 1 },
    ]);
    expect(s.sections[`PS:${world.ps2}`]?.women.total).toBe(0); // रेखा leads, has not won
    expect(s.sections.ZP?.women.list.map((r) => r.name)).toEqual(['सरला']);
  });

  it('party seats: won (declared + lottery + unopposed) and leading', () => {
    const ps1 = s.sections[`PS:${world.ps1}`]?.partySeats ?? [];
    const row = (short: string | null) => ps1.find((r) => r.party.shortName === short);
    // P1 won: close100, close1pct, notClose, mismatch (declared winner दिनेश); P2: unopposed, corrected v2 (विनोद), notaHigh (सुरेश)
    expect(row('P1')).toMatchObject({ won: 4, leading: 0 });
    expect(row('P2')).toMatchObject({ won: 3, leading: 0 });
    expect(row(null)).toMatchObject({ won: 1 }); // the lottery winner is independent
    expect(s.sections[`PS:${world.ps2}`]?.partySeats).toEqual([
      { party: { shortName: 'P1', nameHindi: 'पहला दल' }, won: 0, leading: 1, total: 1 },
    ]);
  });

  it('close contests: <= 100 votes or <= 1% of valid votes, declared only, sorted by margin', () => {
    const close = s.sections.ALL_PS?.close ?? [];
    expect(close.map((c) => [c.ward.id, c.margin])).toEqual([
      [id('close100'), 100],
      [id('close1pct'), 101],
    ]);
    expect(close[1]).toMatchObject({
      marginPercent: 1,
      totalValidVotes: 10100,
      winner: 'मोहन',
      runnerUp: 'सोहन',
    });
    expect(close[0]?.runnerUp).toBe(HYPERLINK);
    expect(wardIds(close)).not.toContain(id('notClose')); // 101 of 10,000 is over 1%
    expect(wardIds(close)).not.toContain(id('lottery')); // tie-resolved: its own section
    expect(isCloseContest(100, 1_000_000)).toBe(true);
    expect(isCloseContest(101, 10_100)).toBe(true);
    expect(isCloseContest(101, 10_099)).toBe(false);
  });

  it('lottery ties with who conducted it and the note', () => {
    expect(s.sections.ALL_PS?.lottery).toEqual([
      expect.objectContaining({
        winner: 'कमला',
        tiedVotes: 150,
        conductedBy: 'रिटर्निंग अधिकारी',
        note: 'दोनों के सामने पर्ची निकाली गई',
        declaredBy: `Full ${world.users.ro1}`,
      }),
    ]);
  });

  it('corrections: old and new winner, reason, who', () => {
    expect(s.sections.ALL_PS?.corrections).toEqual([
      expect.objectContaining({
        version: 2,
        oldWinner: 'अमित',
        newWinner: 'विनोद',
        reason: 'पुनर्गणना में मत बदले',
        declaredBy: `Full ${world.users.ro1}`,
      }),
    ]);
  });

  it('NOTA: totals and the wards where NOTA was highest', () => {
    const nota = s.sections[`PS:${world.ps1}`]?.nota;
    expect(nota?.highest.map((h) => [h.ward.id, h.notaVotes, h.topCandidateVotes])).toEqual([
      [id('notaHigh'), 400, 250],
    ]);
    // close100 10 + close1pct 1 + notClose 1 + lottery 3 + corrected 5 + notaHigh 400 + mismatch 5
    expect(nota?.notaVotes).toBe(425);
  });

  it('reservation per category; hidden (null) where no ward has one', () => {
    expect(s.sections.ALL_PS?.reservation).toEqual([
      { category: 'महिला', wards: 1, decided: 1, womenWinners: 1 },
      { category: 'सामान्य', wards: 2, decided: 2, womenWinners: 0 },
    ]);
    expect(s.sections.ZP?.reservation).toBeNull();
  });

  it('turnout: only fully counted wards whose booths all have voter counts', () => {
    expect(s.sections.ALL_PS?.turnout).toMatchObject({
      validVotes: 910,
      registeredVoters: 2000,
      percent: 45.5,
      wardsIncluded: 1,
    });
    expect(s.sections.ZP?.turnout).toMatchObject({ percent: null, wardsIncluded: 0 });
  });

  it('alarms: declaration mismatch, UNAVAILABLE, NOTA-highest declared (district-wide)', () => {
    const kinds = s.alarms.map((a) => [a.kind, a.ward?.id ?? null]);
    expect(kinds).toContainEqual(['DECLARATION_MISMATCH', id('mismatch')]);
    expect(kinds).toContainEqual(['UNAVAILABLE', id('broken')]);
    expect(kinds).toContainEqual(['NOTA_HIGHEST_DECLARED', id('notaHigh')]);
    expect(kinds.filter(([k]) => k === 'VOTER_CHECK_DISABLED')).toEqual([]); // no startup audit row
    expect(s.alarms.find((a) => a.kind === 'UNAVAILABLE')?.scope).toBe(`PS:${world.ps1}`);
  });
});

describe('voter-check alarm', () => {
  it('only when the startup audit row exists AND the running server has the check off', async () => {
    const raw = await readReportData(pool);
    expect(raw.voterCheckDisabledAt).toBeNull();
    await insert(
      pool,
      "INSERT INTO audit_log (user_id, action, entity, entity_id, new_value) VALUES (NULL, 'CONFIG_VOTER_CHECK_DISABLED', 'config', NULL, '{}')",
      [],
    );
    const withRow = await readReportData(pool);
    expect(withRow.voterCheckDisabledAt).not.toBeNull();
    const off = buildReport(withRow, { voterCheckOff: true, now: new Date() });
    expect(off.alarms.filter((a) => a.kind === 'VOTER_CHECK_DISABLED')).toHaveLength(1);
    const on = buildReport(withRow, { voterCheckOff: false, now: new Date() });
    expect(on.alarms.filter((a) => a.kind === 'VOTER_CHECK_DISABLED')).toEqual([]);
    // through the API with a server running REQUIRE_VOTER_COUNTS=false
    const agent = request.agent(buildApp(pool, { requireVoterCounts: false }));
    await login(agent, world.users.dm, PASSWORD);
    const body = (await agent.get('/api/reports/summary')).body as ReportSummary;
    expect(body.alarms.map((a) => a.kind)).toContain('VOTER_CHECK_DISABLED');
  });
});

describe('fixed number of queries and the 5 s cache', () => {
  /** A pool whose connections count execute/query calls. */
  function countingPool(base: Pool): { pool: Pool; count: () => number } {
    let n = 0;
    const wrap = (c: PoolConnection) =>
      new Proxy(c, {
        get(target, prop, receiver) {
          const v: unknown = Reflect.get(target, prop, receiver);
          if ((prop === 'execute' || prop === 'query') && typeof v === 'function') {
            return (...args: unknown[]) => {
              n++;
              return (v as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    const proxied = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'getConnection') return async () => wrap(await target.getConnection());
        const v: unknown = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    return { pool: proxied, count: () => n };
  }

  it('the summary read uses the same number of queries for 12 or 37 wards', async () => {
    const small = countingPool(pool);
    await readReportData(small.pool);
    const before = small.count();
    for (let i = 0; i < 25; i++) {
      const wId = await insert(
        pool,
        "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT 'PS', district_id, id, ? FROM panchayat_samiti WHERE id = ?",
        [100 + i, world.ps2],
      );
      await insert(
        pool,
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 1, 'क', 'M', 0)",
        [wId],
      );
      await insert(
        pool,
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 2, 'ख', 'M', 0)",
        [wId],
      );
    }
    const big = countingPool(pool);
    await readReportData(big.pool);
    expect(big.count()).toBe(before);
    expect(before).toBeLessThanOrEqual(20);
  });

  it('two summary requests within 5 s are built once', async () => {
    const c = countingPool(pool);
    const agent = request.agent(buildApp(c.pool));
    await login(agent, world.users.dm, PASSWORD);
    const afterLogin = c.count();
    await agent.get('/api/reports/summary');
    const first = c.count() - afterLogin;
    await agent.get('/api/reports/summary');
    const second = c.count() - afterLogin - first;
    expect(first).toBeGreaterThan(10);
    expect(second).toBeLessThan(first); // only the session/user reads, no rebuild
    expect(second).toBeLessThan(6);
  });
});

describe('CSV export', () => {
  it('UTF-8 BOM, Hindi intact, injection escaped, IST file name, one audit row', async () => {
    const dm = await as(world.users.dm);
    const [before] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REPORT_EXPORTED'",
    );
    const res = await dm
      .get('/api/reports/export.csv?section=close-contests&scope=ALL_PS')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="report-close-contests-\d{8}-\d{6}-IST\.csv"$/,
    );
    const bytes = res.body as Buffer;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toContain('"सीमा देवी"');
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(text).not.toMatch(/(^|,)"=HYPERLINK/m);
    const [after] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REPORT_EXPORTED'",
    );
    expect(Number(after[0]?.n) - Number(before[0]?.n)).toBe(1);
    const [row] = await pool.execute<RowDataPacket[]>(
      "SELECT a.new_value, a.ip, u.username FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.action = 'REPORT_EXPORTED' ORDER BY a.id DESC LIMIT 1",
    );
    expect(row[0]).toMatchObject({
      new_value: { section: 'close-contests', scope: 'ALL_PS' },
      username: world.users.dm,
    });
    expect(row[0]?.ip).toBeTruthy();
  });

  it('every section exports; a bad section or scope is 400', async () => {
    const dm = await as(world.users.dm);
    for (const section of [
      'alarms',
      'progress',
      'party-seats',
      'women',
      'reservation',
      'nota',
      'close-contests',
      'lottery',
      'corrections',
      'turnout',
    ]) {
      expect((await dm.get(`/api/reports/export.csv?section=${section}`)).status, section).toBe(
        200,
      );
    }
    expect((await dm.get('/api/reports/export.csv?section=passwords')).status).toBe(400);
    expect((await dm.get('/api/reports/export.csv?section=progress&scope=PS:999999')).status).toBe(
      400,
    );
    expect((await dm.get('/api/reports/export.csv?section=progress&x=1')).status).toBe(400);
  });

  it('csvCell escapes = + - @ (and tab/CR) text, keeps numbers', () => {
    expect(csvCell('=1+2')).toBe(`"'=1+2"`);
    expect(csvCell('+91')).toBe(`"'+91"`);
    expect(csvCell('-5')).toBe(`"'-5"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell('राम "जी"')).toBe('"राम ""जी"""');
    expect(csvCell(null)).toBe('""');
    expect(toCsv([['a'], ['b']]).startsWith('﻿"a"\r\n"b"')).toBe(true);
  });
});

describe('ward detail', () => {
  it('candidates (booth + postal = total from the engine), booths, versions with lottery / NOTA ack / reason, history', async () => {
    const dm = await as(world.users.dm);
    const get = async (key: string) =>
      (await dm.get(`/api/reports/wards/${id(key)}`)).body as {
        ward: { status: string; declarationMismatch: boolean; unavailable: boolean };
        candidates: {
          name: string;
          boothVotes: number;
          postalVotes: number;
          totalVotes: number;
          isWinner: boolean;
          gender: string | null;
        }[];
        booths: {
          entered: boolean;
          votes: { votes: number }[];
          edits: number;
          voids: number;
          enteredBy: string | null;
        }[];
        postal: { entered: boolean; edits: number; voids: number };
        declarations: {
          version: number;
          status: string;
          lottery: unknown;
          notaHighestAck: boolean;
          correctionReason: string | null;
          declaredBy: string;
        }[];
      };
    const c100 = await get('close100');
    expect(
      c100.candidates.map((c) => [c.name, c.boothVotes, c.postalVotes, c.totalVotes, c.isWinner]),
    ).toEqual([
      ['सीमा देवी', 500, 0, 500, true],
      [HYPERLINK, 400, 0, 400, false],
      ['नोटा', 10, 0, 10, false],
    ]);
    expect(c100.candidates[0]?.gender).toBe('F');
    expect(c100.booths[0]).toMatchObject({
      entered: true,
      edits: 1,
      voids: 0,
      enteredBy: `Full ${world.users.ro1}`,
    });
    expect(c100.booths[0]?.votes.map((v) => v.votes).sort((a, b) => a - b)).toEqual([10, 400, 500]);
    expect((await get('notClose')).booths[0]).toMatchObject({ voids: 1 });
    const lot = await get('lottery');
    expect(lot.declarations).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'TIE_RESOLVED',
        lottery: { conductedBy: 'रिटर्निंग अधिकारी', note: 'दोनों के सामने पर्ची निकाली गई' },
      }),
    ]);
    expect((await get('notaHigh')).declarations[0]?.notaHighestAck).toBe(true);
    const co = await get('corrected');
    expect(co.declarations.map((d) => [d.version, d.correctionReason])).toEqual([
      [1, null],
      [2, 'पुनर्गणना में मत बदले'],
    ]);
    expect((await get('mismatch')).ward.declarationMismatch).toBe(true);
    expect((await get('broken')).ward).toMatchObject({ unavailable: true, status: 'UNAVAILABLE' });
    expect((await dm.get('/api/reports/wards/99999999')).status).toBe(404);
    expect((await dm.get('/api/reports/wards/abc')).status).toBe(400);
  });
});
