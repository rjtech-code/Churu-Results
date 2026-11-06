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
  electionDateText,
  istText,
  percentDown,
} from '../../src/services/counting-status.js';
import type {
  BoothRow,
  CountingStatusRaw,
  CountingStatusReport,
  WardRow,
} from '../../src/services/counting-status.js';
import { DEFAULT_SCREEN_LAYOUT } from '../../src/services/screen-layout.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';
import { PASSWORD, countingApp } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import type { DeclareClient } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';

type View = Omit<CountingStatusReport, 'booths'>;
interface WardView {
  ward: WardRow;
  booths: BoothRow[];
}

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
  const zp = await declareClient(app, users.zp);
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
  // ZP1: b1 and b2 by the ZP RO; b6 (in PS2) pending.
  await enter(zp, 'zp1', ids.zp1, b1, 'ZP', [210, 200, 3], 1);
  await enter(zp, 'zp1', ids.zp1, b2, 'ZP', [110, 100, 1], 3);
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
async function wardView(wardId: number): Promise<WardView> {
  const res = await (
    await as(users.dm)
  ).get(`/api/reports/counting-status/wards/${String(wardId)}`);
  expect(res.status).toBe(200);
  return res.body as WardView;
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
    expect(v.electionDateText).toBe('Counting date: 20 Nov 2026');
    expect(v.asOfText).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} (AM|PM) IST$/);
  });

  it('(c) ZP and PS wards count their own booths; a ZP ward spans two PS', async () => {
    const zp1 = wardOf(v, ids.zp1);
    expect(zp1).toMatchObject({ boothsDone: 2, boothsTotal: 3, latestRound: 3 });
    expect(zp1.pendingBooths).toBe('RAJGARH: 1');
    const booths = (await wardView(ids.zp1)).booths;
    expect(booths.map((b) => [b.psName, b.boothNo, b.entered])).toEqual([
      ['CHURU', 1, 'YES'],
      ['CHURU', 2, 'YES'],
      ['RAJGARH', 1, 'NO'],
    ]);
    // The same physical booth b1 is entered for both ballots; b6 only for PS.
    expect(booths[0]).toMatchObject({ enteredBy: `ZP RO · ${users.zp}`, totalVotes: 413 });
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
      /^attachment; filename="counting-status-\d{8}-\d{6}-IST\.pdf"$/,
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
      const tail = [doneTotal, n(w.boothsPending), n(w.latestRound), postal];
      const tailAt = findRun(pdf, tail, at + head.length);
      expect(tailAt - (at + head.length), `ward ${String(w.wardNo)} tail`).toBeLessThanOrEqual(5);
      expect(tailAt).toBeGreaterThanOrEqual(0);
    }
    expect(pdf).toContain(
      `Churu District - Counting Status Report   ·   Report time: ${v.asOfText}`,
    );
    expect(pdf.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
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
      const res = await dm.get(`/api/reports/counting-status/wards/${String(w.wardId)}`);
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

describe('(e) DM only', () => {
  const paths = () => [
    '/api/reports/counting-status',
    `/api/reports/counting-status/wards/${String(ids.w1)}`,
    '/api/reports/counting-status.pdf',
    '/api/reports/counting-status/wards.csv',
    '/api/reports/counting-status/booths.csv',
  ];

  it('PS_RO, ZP_RO and SUPER_ADMIN get 403; logged out 401; the DM 200', async () => {
    for (const u of [users.ro1, users.zp, users.sa]) {
      const agent = await as(u);
      for (const p of paths()) expect((await agent.get(p)).status, `${u} ${p}`).toBe(403);
    }
    const anon = request(buildApp(pool));
    for (const p of paths()) expect((await anon.get(p)).status, p).toBe(401);
    const dm = await as(users.dm);
    for (const p of paths()) expect((await dm.get(p)).status, p).toBe(200);
  });

  it('bad input is refused: unknown query keys 400, unknown ward 404', async () => {
    const dm = await as(users.dm);
    expect((await dm.get('/api/reports/counting-status?x=1')).status).toBe(400);
    expect((await dm.get('/api/reports/counting-status.pdf?scope=ZP')).status).toBe(400);
    expect((await dm.get('/api/reports/counting-status/wards/abc')).status).toBe(400);
    expect((await dm.get('/api/reports/counting-status/wards/999999')).status).toBe(404);
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
    expect(electionDateText(null)).toBe('Counting date: not set');
    expect(electionDateText('2026-11-20')).toBe('Counting date: 20 Nov 2026');
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
