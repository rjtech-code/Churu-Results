// Counting Status Report: one small district built through the real counting / declare API.
//   PS1 (CHURU)  W1: 3 booths, 2 entered 45 min ago, no postal        -> In Progress + Stalled
//                W2: 1 booth + postal, declared                       -> Declared (winner shown)
//                W3: unopposed, 1 booth                               -> Declared + Unopposed
//   PS2 (RAJGARH) W1: 2 booths, both entered now (one is voided in a test) -> In Progress
//                W2: 1 booth, nothing entered                          -> Not Started
//   ZP1: booths b1, b2 (PS1) and b6 (PS2); b1, b2 entered by the ZP RO -> In Progress (spans 2 PS)
//   ZP2: every other booth, no candidates                             -> Not Started + No candidates
import { inflateSync } from 'node:zlib';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCountingStatus } from '../../src/modules/reports/counting-status.data.js';
import {
  STALLED_AFTER_MINUTES,
  buildCountingStatus,
  compactNumbers,
  displayPsName,
  countingDateText,
  electionDateText,
  istText,
  percentDown,
} from '../../src/services/counting-status.js';
import type { BoothRow, CountingStatusRaw, WardRow } from '../../src/services/counting-status.js';
import type { ScopedReport } from '../../src/services/counting-status.scope.js';
import { DEFAULT_SCREEN_LAYOUT } from '../../src/services/screen-layout.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

type View = ScopedReport;
interface WardView {
  ward: WardRow;
  booths: BoothRow[];
}

const CS = '/api/reports/counting-status';
const LEADER = 'Leadingname Zeta'; // leads an UNDECLARED ward: must never appear anywhere
const WINNER = 'Winnername Alpha'; // wins the declared ward: shown after declaration

let pool: Pool;
let migrator: Pool;
const users = { ro1: 'cs_ro1', ro2: 'cs_ro2', zp: 'cs_zp', dm: 'cs_dm', sa: 'cs_sa' };
const ids = {} as Record<
  'ps1' | 'ps2' | 'w1' | 'w2' | 'w3' | 'v1' | 'v2' | 'zp1' | 'zp2' | 'b7Entry' | 'b6Entry',
  number
>;
const cand: Record<string, Record<string, number>> = {};
let ro2: DeclareClient;

async function as(username: string) {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}
const ok = (res: { status: number; body: unknown }, what: string) => {
  if (res.status !== 200 && res.status !== 201)
    throw new Error(`${what}: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return res.body as Record<string, unknown>;
};

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  const { ps1, ps2 } = await seedTwoPs(pool);
  Object.assign(ids, { ps1, ps2 });
  const party = await insert(
    pool,
    'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
    ['पहला दल', 'Party One', 'P1', 'चिह्न'],
  );
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    insert(
      pool,
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  ids.zp1 = await ward('ZP', null, 1);
  ids.zp2 = await ward('ZP', null, 2);
  ids.w1 = await ward('PS', ps1, 1);
  ids.w2 = await ward('PS', ps1, 2);
  ids.w3 = await ward('PS', ps1, 3);
  ids.v1 = await ward('PS', ps2, 1);
  ids.v2 = await ward('PS', ps2, 2);

  const boothNo: Record<number, number> = { [ps1]: 0, [ps2]: 0 };
  const booth = (ps: number, psWard: number, zpWard: number) => {
    boothNo[ps] = (boothNo[ps] ?? 0) + 1;
    const no = boothNo[ps] ?? 0;
    return insert(
      pool,
      'INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, name_english, ps_ward_id, zp_ward_id) VALUES (?, ?, ?, ?, ?, ?)',
      [ps, no, `बूथ ${String(no)}`, `GOVT SCHOOL ${String(no)} (PART A)`, psWard, zpWard],
    );
  };
  const b1 = await booth(ps1, ids.w1, ids.zp1);
  const b2 = await booth(ps1, ids.w1, ids.zp1);
  await booth(ps1, ids.w1, ids.zp2); // b3: stays pending
  const b4 = await booth(ps1, ids.w2, ids.zp2);
  await booth(ps1, ids.w3, ids.zp2); // b5: the unopposed ward's booth
  const b6 = await booth(ps2, ids.v1, ids.zp1);
  const b7 = await booth(ps2, ids.v1, ids.zp2);
  await booth(ps2, ids.v2, ids.zp2); // b8

  const addCandidates = async (key: string, wardId: number, names: string[], nota = true) => {
    const byName: Record<string, number> = {};
    cand[key] = byName;
    let pos = 0;
    for (const name of names) {
      const id = await insert(
        pool,
        'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, ?, ?, ?, 0, ?)',
        [wardId, ++pos, name, 'M', pos === 1 ? party : null], // one candidate per party
      );
      byName[name] = id;
    }
    if (nota) {
      byName.NOTA = await insert(
        pool,
        'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, ?, ?, NULL, 1, NULL)',
        [wardId, ++pos, 'नोटा'],
      );
    }
  };
  await addCandidates('w1', ids.w1, [LEADER, 'दूसरा']);
  await addCandidates('w2', ids.w2, [WINNER, 'हारा']);
  await addCandidates('w3', ids.w3, ['निर्विरोध'], false);
  await addCandidates('v1', ids.v1, ['क', 'ख']);
  await addCandidates('v2', ids.v2, ['ग', 'घ']);
  await addCandidates('zp1', ids.zp1, ['ज़ेड एक', 'ज़ेड दो']);
  await pool.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [ids.w3]);
  await pool.execute(
    "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE id IN (?, ?, ?, ?, ?, ?)",
    [ids.w1, ids.w2, ids.w3, ids.v1, ids.v2, ids.zp1],
  );
  await migrator.execute(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('election_date', '2026-11-20')",
  );

  await createUser(pool, { username: users.ro1, role: 'PS_RO', psId: ps1, password: PASSWORD });
  await createUser(pool, { username: users.ro2, role: 'PS_RO', psId: ps2, password: PASSWORD });
  await createUser(pool, { username: users.zp, role: 'ZP_RO', password: PASSWORD });
  await createUser(pool, { username: users.dm, role: 'DM', password: PASSWORD });
  await createUser(pool, { username: users.sa, role: 'SUPER_ADMIN', password: PASSWORD });

  const app = countingApp(pool);
  const ro1 = await declareClient(app, users.ro1);
  ro2 = await declareClient(app, users.ro2);
  const rows = (key: string, votes: number[]) =>
    Object.values(cand[key] ?? {}).map((candidateId, i) => ({ candidateId, votes: votes[i] ?? 0 }));
  const enter = async (
    c: DeclareClient,
    key: string,
    wardId: number,
    boothId: number,
    ballotFor: 'PS' | 'ZP',
    votes: number[],
    roundNo = 1,
  ) => {
    const body = ok(
      await c.post('/entries', {
        wardId,
        boothId,
        ballotFor,
        roundNo,
        sheetTotal: votes.reduce((s, v) => s + v, 0),
        votes: rows(key, votes),
      }),
      `${key} entry`,
    );
    return (body.entry as { id: number }).id;
  };

  // PS1 W1: LEADER clearly ahead in 2 of 3 booths, then both entries moved 45 minutes back.
  const e1 = await enter(ro1, 'w1', ids.w1, b1, 'PS', [400, 100, 5], 1);
  const e2 = await enter(ro1, 'w1', ids.w1, b2, 'PS', [300, 100, 5], 2);
  await migrator.execute(
    'UPDATE booth_entry SET entered_at = NOW(3) - INTERVAL 45 MINUTE, updated_at = NULL WHERE id IN (?, ?)',
    [e1, e2],
  );
  // PS1 W2: entered, postal, declared.
  await enter(ro1, 'w2', ids.w2, b4, 'PS', [250, 150, 4]);
  ok(
    await ro1.post(`/wards/${String(ids.w2)}/postal`, {
      sheetTotal: 3,
      votes: rows('w2', [2, 1, 0]),
    }),
    'w2 postal',
  );
  const p = ok(await ro1.dpost(`/wards/${String(ids.w2)}/preview`, {}), 'w2 preview') as {
    result: { leader: { candidateId: number }; totalValidVotes: number };
  };
  ok(
    await ro1.dpost(`/wards/${String(ids.w2)}`, {
      password: PASSWORD,
      confirmWinnerCandidateId: p.result.leader.candidateId,
      confirmTotalValidVotes: p.result.totalValidVotes,
    }),
    'w2 declare',
  );
  // PS2 W1: both booths entered now.
  ids.b6Entry = await enter(ro2, 'v1', ids.v1, b6, 'PS', [50, 40, 1]);
  ids.b7Entry = await enter(ro2, 'v1', ids.v1, b7, 'PS', [20, 30, 2]);
  // ZP1: b1 and b2 by ps1's RO (one parchi carries both ballots); b6 (in PS2) pending.
  await enter(ro1, 'zp1', ids.zp1, b1, 'ZP', [210, 200, 3], 1);
  await enter(ro1, 'zp1', ids.zp1, b2, 'ZP', [110, 100, 1], 3);
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

async function view(): Promise<View> {
  const res = await (await as(users.dm)).get('/api/reports/counting-status');
  expect(res.status).toBe(200);
  return res.body as View;
}
/** One ward's report (scope WARD): the ward row and its booth rows. */
async function wardView(wardId: number): Promise<WardView> {
  const res = await (
    await as(users.dm)
  ).get(`/api/reports/counting-status?level=WARD&wardId=${String(wardId)}`);
  expect(res.status).toBe(200);
  const body = res.body as View;
  const [ward] = body.wards;
  if (ward === undefined || body.wards.length !== 1) throw new Error(`ward ${String(wardId)}`);
  return { ward, booths: body.booths };
}
const wardOf = (v: { wards: WardRow[] }, id: number): WardRow => {
  const w = v.wards.find((x) => x.wardId === id);
  if (w === undefined) throw new Error(`ward ${String(id)}`);
  return w;
};

// ---------------------------------------------------------------- export readers

/** RFC 4180 reader for our own output (every cell quoted). Checks the BOM and the CRLF ends. */
function parseCsv(text: string): string[][] {
  expect(text.startsWith('﻿')).toBe(true);
  const body = text.slice(1);
  expect(body.endsWith('\r\n')).toBe(true);
  return body
    .slice(0, -2)
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      const re = /"((?:[^"]|"")*)"(?:,|$)/gy;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        cells.push((m[1] ?? '').replace(/""/g, '"'));
        if (re.lastIndex >= line.length) break;
      }
      return cells;
    });
}
function csvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ''])));
}

/** The Latin text the PDF draws, one string per text operation, in drawing order. */
function pdfTexts(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue; // not a flate stream
    }
    // Only Latin runs: the Devanagari font's glyph ids are not text.
    for (const op of content.matchAll(/\/(F\d+) [\d.]+ Tf\s*\[([^\]]*)\] TJ/g)) {
      const hex = [...(op[2] ?? '').matchAll(/<([0-9a-f]*)>/g)].map((h) => h[1] ?? '').join('');
      // WinAnsi = Latin-1 except 0x80-0x9F; our text uses only 0x96 there (the en dash).
      out.push(Buffer.from(hex, 'hex').toString('latin1').replaceAll('\u0096', '–'));
    }
  }
  return out;
}
/** Index where `cells` appear as consecutive text operations, from `from`; -1 when absent. */
function findRun(texts: string[], cells: string[], from = 0): number {
  for (let i = from; i + cells.length <= texts.length; i++) {
    if (cells.every((c, k) => texts[i + k] === c)) return i;
  }
  return -1;
}
const n = (v: number | null) => (v === null ? '–' : v.toLocaleString('en-US'));

// ---------------------------------------------------------------- tests

describe('definitions, on the hand-built district', () => {
  let v: View;
  beforeAll(async () => {
    v = await view();
  });

  it('ward status, booths, round, postal, stalled', () => {
    const w1 = wardOf(v, ids.w1);
    expect(w1).toMatchObject({
      status: 'IN_PROGRESS',
      statusLabel: 'Counting In Progress',
      boothsDone: 2,
      boothsTotal: 3,
      boothsPending: 1,
      boothsPercent: 66.6,
      latestRound: 2,
      postalDone: false,
      stalled: true,
      winner: null,
      margin: null,
      pendingBooths: '3',
      psName: 'CHURU',
      psNameFull: 'CHURU PANCHAYAT SAMITI',
    });
    expect(wardOf(v, ids.w2)).toMatchObject({
      status: 'DECLARED',
      boothsDone: 1,
      boothsTotal: 1,
      postalDone: true,
      stalled: false,
      winner: { name: WINNER, party: 'P1' },
      margin: 101,
    });
    expect(wardOf(v, ids.w3)).toMatchObject({
      status: 'DECLARED',
      unopposed: true,
      boothsDone: null,
      boothsTotal: null,
      postalDone: null,
      winner: { name: 'निर्विरोध', party: 'P1' },
      margin: null,
    });
    expect(wardOf(v, ids.v1)).toMatchObject({
      status: 'IN_PROGRESS',
      boothsDone: 2,
      boothsTotal: 2,
      stalled: false,
    });
    expect(wardOf(v, ids.v2)).toMatchObject({ status: 'NOT_STARTED', noCandidates: false });
    expect(wardOf(v, ids.zp2)).toMatchObject({
      status: 'NOT_STARTED',
      noCandidates: true,
      boothsDone: 0,
      boothsTotal: 5,
    });
    expect(v.wards.every((w) => !w.checkData)).toBe(true);
    // The fixed counting day, never the poll date the DM sets (a separate setting and label).
    expect(v.countingDateText).toBe('Counting date: 20 Nov 2026');
    expect(v.electionDateText).toMatch(/^Poll date: /);
    expect(v.asOfText).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} (AM|PM) IST$/);
  });

  it('(c) ZP and PS wards count their own booths; a ZP ward spans two PS', async () => {
    const zp1 = wardOf(v, ids.zp1);
    // No single ZP round: each PS counts in its own rounds (see zpPsProgress).
    expect(zp1).toMatchObject({ boothsDone: 2, boothsTotal: 3, latestRound: null });
    expect(v.zpPsProgress.find((z) => z.wardId === ids.zp1)).toMatchObject({
      rows: [
        { psId: ids.ps1, psName: 'CHURU', boothsDone: 2, boothsTotal: 2, latestRound: 3 },
        { psId: ids.ps2, psName: 'RAJGARH', boothsDone: 0, boothsTotal: 1, latestRound: null },
      ],
      postal: { assignedPsId: null, label: 'Not assigned', entered: false },
    });
    expect(zp1.pendingBooths).toBe('RAJGARH: 1');
    const booths = (await wardView(ids.zp1)).booths;
    expect(booths.map((b) => [b.psName, b.boothNo, b.entered])).toEqual([
      ['CHURU', 1, 'YES'],
      ['CHURU', 2, 'YES'],
      ['RAJGARH', 1, 'NO'],
    ]);
    // The same physical booth b1 is entered for both ballots; b6 only for PS.
    expect(booths[0]).toMatchObject({
      enteredBy: `PS RO (CHURU) · ${users.ro1}`,
      totalVotes: 413,
    });
    const ps = (id: number) => v.psTable.find((p) => p.psId === id);
    expect(ps(ids.ps1)).toMatchObject({
      psBoothsDone: 3,
      psBoothsTotal: 4, // the unopposed ward's booth is not counted
      zpBoothsDone: 2,
      zpBoothsTotal: 5,
    });
    expect(ps(ids.ps2)).toMatchObject({
      psBoothsDone: 2,
      psBoothsTotal: 3,
      zpBoothsDone: 0,
      zpBoothsTotal: 3,
    });
    expect(v.summary.ZP).toMatchObject({ boothsDone: 2, boothsTotal: 8, postalTotal: 2 });
    expect(v.summary.PS).toMatchObject({
      wardsTotal: 5,
      notStarted: 1,
      inProgress: 2,
      ready: 0,
      declared: 2,
      unopposed: 1,
      stalled: 1,
      boothsDone: 5,
      boothsTotal: 7,
      boothsPending: 2,
      boothsPercent: 71.4,
      postalDone: 1,
      postalTotal: 4,
    });
  });

  it('(b) summary cards = sum of the PS rows = sum of the ward rows', () => {
    const sum = <T>(list: T[], pick: (x: T) => number | null) =>
      list.reduce((s, x) => s + (pick(x) ?? 0), 0);
    for (const kind of ['PS', 'ZP'] as const) {
      const s = v.summary[kind];
      const wards = v.wards.filter((w) => w.kind === kind);
      expect(s.wardsTotal).toBe(wards.length);
      expect(s.notStarted + s.inProgress + s.ready + s.declared).toBe(s.wardsTotal);
      expect(s.boothsDone).toBe(sum(wards, (w) => w.boothsDone));
      expect(s.boothsTotal).toBe(sum(wards, (w) => w.boothsTotal));
      expect(s.boothsPending).toBe(sum(wards, (w) => w.boothsPending));
      expect(s.stalled).toBe(wards.filter((w) => w.stalled).length);
    }
    expect(v.summary.PS.wardsTotal).toBe(sum(v.psTable, (p) => p.wardsTotal));
    expect(v.summary.PS.declared).toBe(sum(v.psTable, (p) => p.declared));
    expect(v.summary.PS.boothsDone).toBe(sum(v.psTable, (p) => p.psBoothsDone));
    expect(v.summary.PS.boothsTotal).toBe(sum(v.psTable, (p) => p.psBoothsTotal));
    expect(v.summary.ZP.boothsDone).toBe(sum(v.psTable, (p) => p.zpBoothsDone));
    expect(v.summary.ZP.boothsTotal).toBe(sum(v.psTable, (p) => p.zpBoothsTotal));
  });
});

describe('(a) the page, the CSVs and the PDF show the same numbers', () => {
  let v: View;
  let wardsCsv: Record<string, string>[];
  let boothsCsv: Record<string, string>[];
  let pdf: string[];
  const allBooths: BoothRow[] = [];

  beforeAll(async () => {
    const dm = await as(users.dm);
    v = await view();
    for (const w of v.wards) allBooths.push(...(await wardView(w.wardId)).booths);
    const wr = await dm.get('/api/reports/counting-status/wards.csv');
    const br = await dm.get('/api/reports/counting-status/booths.csv');
    const pr = await dm.get('/api/reports/counting-status.pdf').buffer(true);
    expect([wr.status, br.status, pr.status]).toEqual([200, 200, 200]);
    expect(wr.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(pr.headers['content-type']).toBe('application/pdf');
    expect(pr.headers['content-disposition']).toMatch(
      /^attachment; filename="counting-status-district-\d{8}-\d{6}-IST\.pdf"$/,
    );
    wardsCsv = csvObjects(wr.text);
    boothsCsv = csvObjects(br.text);
    pdf = pdfTexts(pr.body as Buffer);
  });

  it('ward-wise CSV = the page, row for row', () => {
    expect(wardsCsv.map((r) => Number(r.ward_no))).toEqual(v.wards.map((w) => w.wardNo));
    const str = (x: number | null) => (x === null ? '' : String(x));
    v.wards.forEach((w, i) => {
      const r = wardsCsv[i] ?? {};
      expect(r).toMatchObject({
        ward_type: w.kind,
        ps_name: w.psNameFull ?? '',
        status: w.statusLabel,
        unopposed: w.unopposed ? 'yes' : 'no',
        stalled: w.stalled ? 'yes' : 'no',
        booths_done: str(w.boothsDone),
        booths_total: str(w.boothsTotal),
        booths_pending: str(w.boothsPending),
        latest_round: str(w.latestRound),
        postal_done: w.postalDone === null ? 'n/a' : w.postalDone ? 'yes' : 'no',
        winner: w.winner?.name ?? '',
        margin: str(w.margin),
        report_time_ist: v.asOfText,
        counting_date: '2026-11-20',
      });
    });
    expect(Object.keys(wardsCsv[0] ?? {})).toContain('report_time_ist');
  });

  it('booth-wise CSV = the booth pages, and has every booth of every ward', () => {
    expect(boothsCsv).toHaveLength(allBooths.length);
    expect(boothsCsv).toHaveLength(8 + 8); // 8 booths x (PS ballot + ZP ballot)
    allBooths.forEach((b, i) => {
      expect(boothsCsv[i]).toMatchObject({
        ward_type: b.kind,
        booth_ps_name: b.psNameFull,
        booth_no: String(b.boothNo),
        booth_name: b.boothName,
        entered: { YES: 'yes', NO: 'no', NA: 'n/a' }[b.entered],
        round: b.round === null ? '' : String(b.round),
        entered_by: b.enteredBy ?? '',
        total_votes: b.totalVotes === null ? '' : String(b.totalVotes),
      });
    });
    // CSV booth totals = the summary.
    for (const kind of ['PS', 'ZP'] as const) {
      const rows = boothsCsv.filter((r) => r.ward_type === kind && r.entered !== 'n/a');
      expect(rows.filter((r) => r.entered === 'yes')).toHaveLength(v.summary[kind].boothsDone);
      expect(rows).toHaveLength(v.summary[kind].boothsTotal);
    }
  });

  it('the PDF draws the same summary, PS and ward rows', () => {
    for (const kind of ['PS', 'ZP'] as const) {
      const s = v.summary[kind];
      const label = kind === 'PS' ? 'Panchayat Samiti' : 'Zila Parishad';
      const row = [
        label,
        s.wardsTotal,
        s.notStarted,
        s.inProgress,
        s.ready,
        s.declared,
        s.unopposed,
        s.stalled,
        s.checkData,
        s.boothsDone,
        s.boothsTotal,
        s.boothsPending,
      ].map((x) => (typeof x === 'number' ? n(x) : x));
      expect(findRun(pdf, row), `summary ${kind}`).toBeGreaterThanOrEqual(0);
    }
    for (const p of v.psTable) {
      const row = [
        p.psName,
        n(p.wardsTotal),
        n(p.declared),
        n(p.psBoothsDone),
        n(p.psBoothsTotal),
        n(p.psBoothsPending),
      ];
      expect(findRun(pdf, row), p.psName).toBeGreaterThanOrEqual(0);
    }
    for (const w of v.wards) {
      const head = [...(w.kind === 'PS' ? [w.psName ?? ''] : []), String(w.wardNo), w.statusLabel];
      // Each kind's rows are searched from its own section title on.
      const section = pdf.indexOf(
        `Ward-wise Status – ${w.kind === 'PS' ? 'Panchayat Samiti' : 'Zila Parishad'}`,
      );
      expect(section).toBeGreaterThan(0);
      const at = findRun(pdf, head, section);
      expect(at, `ward ${w.kind} ${String(w.wardNo)}`).toBeGreaterThanOrEqual(0);
      const doneTotal = w.boothsTotal === null ? '–' : `${n(w.boothsDone)} / ${n(w.boothsTotal)}`;
      const postal = w.postalDone === null ? 'n/a' : w.postalDone ? 'Done' : 'Pending';
      // ZP ward tables have no Round column (each PS has its own rounds: "by Panchayat Samiti").
      const round = w.kind === 'PS' ? [n(w.latestRound)] : [];
      const tail = [doneTotal, n(w.boothsPending), ...round, postal];
      const tailAt = findRun(pdf, tail, at + head.length);
      expect(tailAt - (at + head.length), `ward ${String(w.wardNo)} tail`).toBeLessThanOrEqual(5);
      expect(tailAt).toBeGreaterThanOrEqual(0);
    }
    expect(pdf).toContain(
      `Churu District - Counting Status Report   ·   Scope: Whole District   ·   Report time: ${v.asOfText}`,
    );
    expect(pdf.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
    const text = pdf.join(' ');
    expect(text).toContain('Counting date: 20 Nov 2026');
    expect(text).toContain(v.electionDateText);
    expect(pdf).toContain(`${WINNER} (P1)`);
  });

  it('PDF pending booths: only wards in counting; the rest in one line', () => {
    const start = pdf.indexOf('Pending Booths – wards in counting');
    expect(start).toBeGreaterThan(0);
    const after = pdf.slice(start);
    expect(findRun(after, ['PS', 'CHURU', '1'])).toBeGreaterThanOrEqual(0);
    expect(findRun(after, ['ZP', '–', '1'])).toBeGreaterThanOrEqual(0);
    expect(after).toContain('RAJGARH: 1');
    expect(after).toContain('All booths entered; postal ballots pending'); // RAJGARH ward 1
    expect(findRun(after, ['PS', 'RAJGARH', '2'])).toBe(-1); // not started: not listed
    expect(after).toContain('2 wards not started (full list in the CSV)');
  });
});

describe('(d) no leading candidate before declaration', () => {
  const FORBIDDEN_KEYS = /^(leader|runnerUp|top3|candidates|votes|notaVotes|totalValidVotes|rank)$/;
  const keysOf = (x: unknown): string[] =>
    Array.isArray(x)
      ? x.flatMap(keysOf)
      : typeof x === 'object' && x !== null
        ? Object.entries(x).flatMap(([k, val]) => [k, ...keysOf(val)])
        : [];

  it('no response, CSV or PDF carries an undeclared ward’s candidates', async () => {
    const dm = await as(users.dm);
    const bodies: string[] = [];
    const main = await dm.get('/api/reports/counting-status');
    bodies.push(main.text);
    expect(keysOf(main.body).filter((k) => FORBIDDEN_KEYS.test(k))).toEqual([]);
    for (const w of (main.body as View).wards) {
      const res = await dm.get(
        `/api/reports/counting-status?level=WARD&wardId=${String(w.wardId)}`,
      );
      expect(keysOf(res.body).filter((k) => FORBIDDEN_KEYS.test(k))).toEqual([]);
      bodies.push(res.text);
      if (w.status !== 'DECLARED') expect(w.winner).toBeNull();
      if (w.status !== 'DECLARED') expect(w.margin).toBeNull();
    }
    bodies.push((await dm.get('/api/reports/counting-status/wards.csv')).text);
    bodies.push((await dm.get('/api/reports/counting-status/booths.csv')).text);
    const pdf = (await dm.get('/api/reports/counting-status.pdf').buffer(true)).body as Buffer;
    bodies.push(pdfTexts(pdf).join('\n'));
    for (const text of bodies) {
      expect(text).not.toContain(LEADER);
      expect(text).not.toContain('Leadingname');
      expect(text).not.toContain('दूसरा'); // W1's other candidate
      expect(text).not.toContain('ज़ेड'); // ZP1's candidates
    }
    // The declared ward's winner is shown (so the check above is not vacuous).
    expect(bodies[0]).toContain(WINNER);
  });
});

describe('(e) DM, and the ZP_RO scoped to Zila Parishad', () => {
  const paths = () => [
    '/api/reports/counting-status',
    `/api/reports/counting-status?level=WARD&wardId=${String(ids.w1)}`,
    '/api/reports/counting-status/options',
    `/api/reports/counting-status/options/wards/${String(ids.w1)}/booths`,
    '/api/reports/counting-status.pdf',
    '/api/reports/counting-status/wards.csv',
    '/api/reports/counting-status/booths.csv',
  ];

  it('PS_RO and SUPER_ADMIN get 403; logged out 401; the DM 200', async () => {
    for (const u of [users.ro1, users.sa]) {
      const agent = await as(u);
      for (const p of paths()) expect((await agent.get(p)).status, `${u} ${p}`).toBe(403);
    }
    const anon = request(buildApp(pool));
    for (const p of paths()) expect((await anon.get(p)).status, p).toBe(401);
    const dm = await as(users.dm);
    for (const p of paths()) expect((await dm.get(p)).status, p).toBe(200);
  });

  it('ZP_RO: ZP scopes 200 (default All ZP); district, PS level or a PS ward 403', async () => {
    const zp = await as(users.zp);
    const ok200 = [
      CS,
      `${CS}?level=ALL_ZP`,
      `${CS}?level=ALL_ZP&status=IN_PROGRESS`,
      `${CS}?level=WARD&wardId=${String(ids.zp1)}`,
      `${CS}/options`,
      `${CS}/options/wards/${String(ids.zp1)}/booths`,
      `${CS}.pdf`,
      `${CS}/wards.csv`,
      `${CS}/booths.csv?level=WARD&wardId=${String(ids.zp1)}`,
      `${CS}/zp-by-ps.csv`,
    ];
    for (const p of ok200) expect((await zp.get(p)).status, p).toBe(200);
    const refused = [
      `${CS}?level=DISTRICT`,
      `${CS}?level=ALL_PS`,
      `${CS}?level=PS&psId=${String(ids.ps1)}`,
      `${CS}?level=WARD&wardId=${String(ids.w1)}`,
      `${CS}.pdf?level=ALL_PS`,
      `${CS}/wards.csv?level=DISTRICT`,
      `${CS}/booths.csv?level=WARD&wardId=${String(ids.w1)}`,
    ];
    for (const p of refused) expect((await zp.get(p)).status, p).toBe(403);
    // A PS ward is no booth picker for the ZP_RO (only ZP wards are).
    expect((await zp.get(`${CS}/options/wards/${String(ids.w1)}/booths`)).status).toBe(404);
    // The other DM reports stay DM only.
    expect((await zp.get('/api/reports/summary')).status).toBe(403);
  });

  it('ZP_RO: no Panchayat Samiti ward data comes back through any parameter', async () => {
    const zp = await as(users.zp);
    const noPs = (body: unknown, what: string) => {
      const r = body as {
        wards: { kind: string }[];
        booths: { kind: string }[];
        psTable: unknown[];
        summary: { PS: { wardsTotal: number; boothsTotal: number } };
        kinds: string[];
      };
      expect(
        r.wards.every((w) => w.kind === 'ZP'),
        what,
      ).toBe(true);
      expect(
        r.booths.every((b) => b.kind === 'ZP'),
        what,
      ).toBe(true);
      expect(r.psTable, what).toEqual([]);
      expect(r.summary.PS, what).toMatchObject({ wardsTotal: 0, boothsTotal: 0 });
      expect(r.kinds, what).not.toContain('PS');
    };
    const all = await zp.get(CS);
    noPs(all.body, 'default');
    expect((all.body as { scope: { level: string } }).scope.level).toBe('ALL_ZP');
    noPs((await zp.get(`${CS}?level=WARD&wardId=${String(ids.zp1)}`)).body, 'ZP ward');
    // b1 carries a PS and a ZP ballot: the ZP_RO sees only the ZP one.
    const b1 = (await wardView(ids.w1)).booths[0];
    const booth = await zp.get(`${CS}?level=BOOTH&boothId=${String(b1?.boothId ?? 0)}`);
    noPs(booth.body, 'booth');
    expect((booth.body as { booths: unknown[] }).booths).toHaveLength(1);
    const options = (await zp.get(`${CS}/options`)).body as {
      ps: unknown[];
      wards: { kind: string }[];
    };
    expect(options.ps).toEqual([]);
    expect(options.wards.every((w) => w.kind === 'ZP')).toBe(true);
    const csv = (await zp.get(`${CS}/wards.csv`)).text;
    expect(csv.split('\n').some((l) => l.startsWith('"ZP",'))).toBe(true); // the check below can fail
    expect(
      csv
        .split('\n')
        .slice(1)
        .filter((l) => l.startsWith('"PS",')),
    ).toEqual([]);
    const boothCsv = (
      await zp.get(`${CS}/booths.csv?level=BOOTH&boothId=${String(b1?.boothId ?? 0)}`)
    ).text;
    expect(
      boothCsv
        .split('\n')
        .slice(1)
        .filter((l) => l.startsWith('"PS",')),
    ).toEqual([]);
  });

  it('bad input is refused: unknown query keys 400, unknown ward 404', async () => {
    const dm = await as(users.dm);
    expect((await dm.get('/api/reports/counting-status?x=1')).status).toBe(400);
    expect((await dm.get('/api/reports/counting-status.pdf?scope=ZP')).status).toBe(400);
    expect((await dm.get(`${CS}?level=WARD&wardId=abc`)).status).toBe(400);
    expect((await dm.get(`${CS}?level=WARD`)).status).toBe(400); // id missing
    expect((await dm.get(`${CS}?level=PS&psId=1&wardId=1`)).status).toBe(400); // id of another level
    expect((await dm.get(`${CS}?level=WARD&wardId=1&status=ALL`)).status).toBe(400);
    expect((await dm.get(`${CS}?level=COUNTRY`)).status).toBe(400);
    expect((await dm.get(`${CS}?status=WINNING`)).status).toBe(400);
    expect((await dm.get(`${CS}?level=WARD&wardId=999999`)).status).toBe(404);
    expect((await dm.get(`${CS}?level=PS&psId=999999`)).status).toBe(404);
    expect((await dm.get(`${CS}?level=BOOTH&boothId=999999`)).status).toBe(404);
    expect((await dm.get(`${CS}.pdf?level=BOOTH&boothId=999999`)).status).toBe(404);
    expect((await dm.get(`${CS}/wards.csv?level=PS&psId=0`)).status).toBe(400);
    expect((await dm.get(`${CS}/options/wards/${String(ids.zp1)}/booths`)).status).toBe(404); // a ZP ward
    expect((await dm.get(`${CS}/options/wards/999999/booths`)).status).toBe(404);
  });

  it('every download is audited (who, when, which format); viewing is not', async () => {
    const count = async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.format')) AS format, COUNT(*) AS n
           FROM audit_log a JOIN users u ON u.id = a.user_id
          WHERE a.action = 'REPORT_EXPORTED' AND u.username = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.section')) = 'counting-status'
          GROUP BY format`,
        [users.dm],
      );
      return Object.fromEntries(rows.map((r) => [String(r.format), Number(r.n)]));
    };
    const before = await count();
    const dm = await as(users.dm);
    await dm.get('/api/reports/counting-status');
    await dm.get('/api/reports/counting-status.pdf');
    await dm.get('/api/reports/counting-status/wards.csv');
    await dm.get('/api/reports/counting-status/booths.csv');
    await dm.get('/api/reports/counting-status/booths.csv');
    const after = await count();
    const diff = (f: string) => (after[f] ?? 0) - (before[f] ?? 0);
    expect([diff('pdf'), diff('csv-ward'), diff('csv-booth')]).toEqual([1, 1, 2]);
  });
});

describe('scopes: the DM picks what to see', () => {
  interface Scoped {
    json: View;
    wardsCsv: Record<string, string>[];
    boothsCsv: Record<string, string>[];
    pdf: string[];
  }
  /** The page JSON, both CSVs and the PDF text of one scope (same query string). */
  async function scoped(query: string): Promise<Scoped> {
    const dm = await as(users.dm);
    const j = await dm.get(`${CS}?${query}`);
    const w = await dm.get(`${CS}/wards.csv?${query}`);
    const b = await dm.get(`${CS}/booths.csv?${query}`);
    const p = await dm.get(`${CS}.pdf?${query}`).buffer(true);
    expect([j.status, w.status, b.status, p.status], query).toEqual([200, 200, 200, 200]);
    return {
      json: j.body as View,
      wardsCsv: csvObjects(w.text),
      boothsCsv: csvObjects(b.text),
      pdf: pdfTexts(p.body as Buffer),
    };
  }
  const entryText = { YES: 'Entered', NO: 'Pending', NA: 'n/a' } as const;
  /** (a) for any scope: CSV rows = JSON rows; the PDF draws the scope line and every ward row. */
  function sameEverywhere(s: Scoped, boothRows: BoothRow[]) {
    expect(s.wardsCsv.map((r) => [r.ward_type, r.ward_no, r.status, r.booths_done])).toEqual(
      s.json.wards.map((w) => [
        w.kind,
        String(w.wardNo),
        w.statusLabel,
        w.boothsDone === null ? '' : String(w.boothsDone),
      ]),
    );
    expect(
      s.boothsCsv.map((r) => [r.ward_type, r.booth_ps_name, r.booth_no, r.entered, r.total_votes]),
    ).toEqual(
      boothRows.map((b) => [
        b.kind,
        b.psNameFull,
        String(b.boothNo),
        { YES: 'yes', NO: 'no', NA: 'n/a' }[b.entered],
        b.totalVotes === null ? '' : String(b.totalVotes),
      ]),
    );
    expect(s.pdf).toContain(`Scope: ${s.json.scope.label}`);
    if (s.json.scope.level !== 'BOOTH') {
      for (const w of s.json.wards) {
        const head = [
          ...(w.kind === 'PS' ? [w.psName ?? ''] : []),
          String(w.wardNo),
          w.statusLabel,
        ];
        expect(findRun(s.pdf, head), `${w.kind} ward ${String(w.wardNo)}`).toBeGreaterThanOrEqual(
          0,
        );
      }
    }
  }

  let district: View;
  beforeAll(async () => {
    district = await view();
  });

  it('no scope = the whole district; the page JSON carries no 2,700 booth rows', () => {
    expect(district.scope).toMatchObject({
      level: 'DISTRICT',
      status: 'ALL',
      label: 'Whole District',
    });
    expect(district.kinds).toEqual(['PS', 'ZP']);
    expect(district.booths).toEqual([]);
  });

  it('(a)+(b) one PS: page = CSV = PDF, and its numbers = the district report’s PS row', async () => {
    const s = await scoped(`level=PS&psId=${String(ids.ps1)}`);
    const row = district.psTable.find((p) => p.psId === ids.ps1);
    expect(s.json.psTable).toEqual([row]);
    expect(s.json.scope.label).toBe('CHURU (Panchayat Samiti)');
    expect(s.json.kinds).toEqual(['PS']);
    expect(s.json.wards).toEqual(
      district.wards.filter((w) => w.kind === 'PS' && w.psId === ids.ps1),
    );
    // The PS summary = the district PS row (booths, wards, declared).
    expect(s.json.summary.PS).toMatchObject({
      wardsTotal: row?.wardsTotal,
      declared: row?.declared,
      boothsDone: row?.psBoothsDone,
      boothsTotal: row?.psBoothsTotal,
      boothsPending: row?.psBoothsPending,
      boothsPercent: row?.psBoothsPercent,
    });
    expect(row).toMatchObject({ zpBoothsDone: 2, zpBoothsTotal: 5 });
    const booths: BoothRow[] = [];
    for (const w of s.json.wards) booths.push(...(await wardView(w.wardId)).booths);
    sameEverywhere(s, booths);
    expect(
      findRun(s.pdf, [
        'CHURU',
        n(row?.wardsTotal ?? 0),
        n(row?.declared ?? 0),
        n(row?.psBoothsDone ?? 0),
        n(row?.psBoothsTotal ?? 0),
      ]),
    ).toBeGreaterThanOrEqual(0);
    expect(s.pdf).not.toContain('All Panchayat Samitis');
    expect(s.pdf.some((t) => t.includes('RAJGARH'))).toBe(false);
  });

  it('(c) one ward: a ZP ward shows all its booths across PS; page = CSV = PDF', async () => {
    const s = await scoped(`level=WARD&wardId=${String(ids.zp1)}`);
    expect(s.json.scope.label).toBe('Zila Parishad - Ward 1');
    expect(s.json.wards).toEqual([wardOf(district, ids.zp1)]);
    expect(s.json.summary.ZP).toMatchObject({ wardsTotal: 1, boothsDone: 2, boothsTotal: 3 });
    expect(s.json.booths.map((b) => [b.psName, b.boothNo, b.entered])).toEqual([
      ['CHURU', 1, 'YES'],
      ['CHURU', 2, 'YES'],
      ['RAJGARH', 1, 'NO'],
    ]);
    sameEverywhere(s, s.json.booths);
    for (const b of s.json.booths) {
      const at = findRun(s.pdf, [
        b.kind,
        String(b.wardNo),
        b.psName,
        String(b.boothNo),
        b.boothName,
        entryText[b.entered],
        n(b.round),
        b.enteredBy ?? '–',
      ]);
      expect(at, `booth ${b.psName} ${String(b.boothNo)}`).toBeGreaterThanOrEqual(0);
      expect(s.pdf.slice(at, at + 14)).toContain(n(b.totalVotes));
    }
  });

  it('(c) one booth: its PS ballot and its ZP ballot; page = CSV = PDF', async () => {
    const b1 = (await wardView(ids.w1)).booths[0];
    if (b1 === undefined) throw new Error('b1');
    const s = await scoped(`level=BOOTH&boothId=${String(b1.boothId)}`);
    expect(s.json.scope.label).toBe('CHURU - Booth 1');
    expect(s.json.kinds).toEqual([]);
    expect(
      s.json.booths.map((b) => [b.kind, b.wardId, b.entered, b.round, b.totalVotes, b.enteredBy]),
    ).toEqual([
      ['PS', ids.w1, 'YES', 1, 505, `PS RO (CHURU) · ${users.ro1}`],
      ['ZP', ids.zp1, 'YES', 1, 413, `PS RO (CHURU) · ${users.ro1}`],
    ]);
    // Each ballot row is exactly that booth's row of the district report.
    const all = [...(await wardView(ids.w1)).booths, ...(await wardView(ids.zp1)).booths];
    expect(s.json.booths).toEqual(all.filter((b) => b.boothId === b1.boothId));
    sameEverywhere(s, s.json.booths);
    expect(
      findRun(s.pdf, ['PS', '1', 'CHURU', '1', b1.boothName, 'Entered', '1']),
    ).toBeGreaterThanOrEqual(0);
  });

  it('status filter narrows the lists only; the summary stays the scope’s', async () => {
    const s = await scoped('status=STALLED');
    expect(s.json.wards.map((w) => w.wardId)).toEqual([ids.w1]);
    expect(s.json.summary).toEqual(district.summary);
    expect(s.json.scope.label).toBe('Whole District · Status: Stalled');
    sameEverywhere(s, (await wardView(ids.w1)).booths);
    const zp = await scoped('level=ALL_ZP&status=NOT_STARTED');
    expect(zp.json.wards.map((w) => w.wardId)).toEqual([ids.zp2]);
    expect(zp.json.psTable).toEqual([]);
    expect(zp.json.kinds).toEqual(['ZP']);
    const none = await scoped(`level=PS&psId=${String(ids.ps2)}&status=DECLARED`);
    expect(none.json.wards).toEqual([]);
    expect(none.wardsCsv).toEqual([]);
    expect(none.pdf).toContain('No ward matches this scope.');
  });

  it('dropdown options: every PS, every ward, the booths of a PS ward', async () => {
    const dm = await as(users.dm);
    const o = (await dm.get(`${CS}/options`)).body as {
      ps: { id: number; name: string }[];
      wards: { id: number; kind: string; psId: number | null; wardNo: number }[];
    };
    expect(o.ps).toEqual([
      { id: ids.ps1, name: 'CHURU' },
      { id: ids.ps2, name: 'RAJGARH' },
    ]);
    expect(o.wards).toHaveLength(district.wards.length);
    expect(o.wards.filter((w) => w.kind === 'ZP').map((w) => w.wardNo)).toEqual([1, 2]);
    const booths = (await dm.get(`${CS}/options/wards/${String(ids.w1)}/booths`)).body as {
      booths: { id: number; boothNo: number; name: string }[];
    };
    expect(booths.booths.map((b) => b.boothNo)).toEqual([1, 2, 3]);
    expect(booths.booths[0]?.name).toBe('GOVT SCHOOL 1 (PART A)');
  });

  it('the audit row records the scope of a download', async () => {
    const dm = await as(users.dm);
    await dm.get(`${CS}.pdf?level=PS&psId=${String(ids.ps2)}&status=NOT_STARTED`);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id DESC LIMIT 1`,
    );
    const v = rows[0]?.new_value as { format: string; scope: Record<string, unknown> };
    expect(v.format).toBe('pdf');
    expect(v.scope).toEqual({
      level: 'PS',
      psId: ids.ps2,
      wardId: null,
      boothId: null,
      status: 'NOT_STARTED',
      label: 'RAJGARH (Panchayat Samiti) · Status: Not Started',
    });
  });

  it('(f) no scope leaks an undeclared ward’s candidates', async () => {
    const b1 = (await wardView(ids.w1)).booths[0];
    const queries = [
      `level=PS&psId=${String(ids.ps1)}`,
      `level=WARD&wardId=${String(ids.w1)}`,
      `level=WARD&wardId=${String(ids.zp1)}`,
      `level=BOOTH&boothId=${String(b1?.boothId ?? 0)}`,
      'status=STALLED',
    ];
    for (const q of queries) {
      const s = await scoped(q);
      const all = [
        JSON.stringify(s.json),
        JSON.stringify(s.wardsCsv),
        JSON.stringify(s.boothsCsv),
        s.pdf.join('\n'),
      ];
      for (const text of all) {
        expect(text, q).not.toContain('Leadingname');
        expect(text, q).not.toContain('दूसरा');
        expect(text, q).not.toContain('ज़ेड');
      }
      for (const w of s.json.wards) if (w.status !== 'DECLARED') expect(w.winner).toBeNull();
    }
  });
});

describe('(f) edits and voids', () => {
  it('an edit keeps the count; a void makes the booth pending again', async () => {
    const before = wardOf(await view(), ids.v1);
    expect(before).toMatchObject({ boothsDone: 2, boothsTotal: 2, latestRound: 1 });

    const votes = Object.values(cand.v1 ?? {}).map((candidateId, i) => ({
      candidateId,
      votes: [50, 40, 1][i] ?? 0,
    }));
    ok(
      await ro2.put(`/entries/${String(ids.b6Entry)}`, {
        rowVersion: 1,
        roundNo: 4,
        sheetTotal: 91,
        votes,
        reason: 'राउंड संख्या गलत थी',
      }),
      'edit',
    );
    const edited = await wardView(ids.v1);
    expect(edited.ward).toMatchObject({ boothsDone: 2, boothsPending: 0, latestRound: 4 });
    expect(edited.booths[0]).toMatchObject({ entered: 'YES', round: 4, totalVotes: 91 });
    expect(edited.booths[0]?.lastEditedAtText).toMatch(/IST$/);

    ok(
      await ro2.post(`/entries/${String(ids.b7Entry)}/void`, {
        rowVersion: 1,
        reason: 'गलत बूथ चुना गया',
      }),
      'void',
    );
    const v = await view();
    expect(wardOf(v, ids.v1)).toMatchObject({
      boothsDone: 1,
      boothsPending: 1,
      pendingBooths: '2',
      status: 'IN_PROGRESS',
    });
    const after = await wardView(ids.v1);
    expect(after.booths[1]).toMatchObject({ entered: 'NO', round: null, totalVotes: null });
    expect(v.summary.PS.boothsDone).toBe(4);
    expect(v.psTable.find((p) => p.psId === ids.ps2)?.psBoothsDone).toBe(1);
  });
});

describe('pure helpers', () => {
  it('the 13 official PS names stay distinct after trimming " PANCHAYAT SAMITI"', () => {
    const names = [...DEFAULT_SCREEN_LAYOUT['1'], ...DEFAULT_SCREEN_LAYOUT['2']];
    expect(names).toHaveLength(13);
    const short = names.map(displayPsName);
    expect(new Set(short).size).toBe(13);
    expect(short.some((s) => /PANCHAYAT SAMITI/i.test(s))).toBe(false);
    expect(short).toContain('TARANAGAR EAST');
    expect(short).toContain('TARANAGAR WEST(BHALERI) HQ TARANAGAR');
    expect(short).toContain('CHURU');
    expect(short).toContain('CHURU NORTH HQ CHURU');
  });

  it('IST time, counting date, numbers, pending booth list, percent', () => {
    expect(istText(new Date('2026-11-06T11:02:00Z'))).toBe('06 Nov 2026, 04:32 PM IST');
    expect(istText(new Date('2026-11-19T18:30:00Z'))).toBe('20 Nov 2026, 12:00 AM IST');
    expect(istText(new Date('2026-11-20T06:45:00Z'))).toBe('20 Nov 2026, 12:15 PM IST');
    expect(countingDateText()).toBe('Counting date: 20 Nov 2026');
    expect(electionDateText(null)).toBe('Poll date: not set');
    expect(electionDateText('2026-11-13')).toBe('Poll date: 13 Nov 2026');
    expect(compactNumbers([12, 3, 13, 14, 7, 15, 3])).toBe('3, 7, 12–15');
    expect(compactNumbers([])).toBe('');
    expect(percentDown(1358, 1359)).toBe(99.9); // never 100 before every booth is done
    expect(percentDown(1359, 1359)).toBe(100);
    expect(percentDown(0, 0)).toBeNull();
  });

  it(`stalled exactly at ${String(STALLED_AFTER_MINUTES)} minutes, only while counting`, () => {
    const asOf = new Date('2026-11-20T08:00:00Z');
    const raw = (minutesAgo: number, withPostal: boolean): CountingStatusRaw => ({
      asOf,
      electionDate: null,
      ps: [{ id: 1, nameEnglish: 'CHURU PANCHAYAT SAMITI' }],
      wards: [{ id: 10, kind: 'PS', wardNo: 1, psId: 1, isUnopposed: false }],
      booths: [1, 2].map((id) => ({
        id,
        psId: 1,
        boothNo: id,
        name: `B${String(id)}`,
        psWardId: 10,
        zpWardId: 20,
      })),
      entries: [
        {
          boothId: 1,
          ballotFor: 'PS',
          roundNo: 1,
          sheetTotal: 10,
          enteredAt: new Date(asOf.getTime() - minutesAgo * 60_000),
          updatedAt: null,
          enteredBy: { username: 'u', role: 'PS_RO', psName: 'CHURU PANCHAYAT SAMITI' },
        },
      ],
      postal: withPostal ? [{ wardId: 10, enteredAt: asOf, updatedAt: null }] : [],
      postalAssignments: [],
      declarations: [],
      candidates: [],
      results: new Map(),
    });
    const ward = (r: CountingStatusRaw) => buildCountingStatus(r).wards[0];
    expect(ward(raw(29.99, false))?.stalled).toBe(false);
    expect(ward(raw(30, false))?.stalled).toBe(true);
    // A recent postal entry is activity too.
    expect(ward(raw(120, true))?.stalled).toBe(false);
    // No engine result for a ward that has entries: shown as Check Data, never hidden.
    expect(ward(raw(5, false))?.checkData).toBe(true);
    expect(buildCountingStatus(raw(5, false)).booths[0]?.enteredBy).toBe('PS RO (CHURU) · u');
  });

  it('the data read is one snapshot: DB time, no cache', async () => {
    const a = await readCountingStatus(pool);
    const b = await readCountingStatus(pool);
    expect(new Date(b.asOf).getTime()).toBeGreaterThanOrEqual(new Date(a.asOf).getTime());
    expect(b.wards).toEqual(a.wards);
  });
});
