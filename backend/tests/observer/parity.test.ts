// Observer figures must be IDENTICAL to the DM reports: every number on the observer API is
// compared against GET /api/reports/summary and GET /api/reports/counting-status for the same
// database state — in the zero state and mid-counting (with a ZP ward spanning two PS, an "A"
// booth and a voided entry). Plus the privacy scan (no personal or operational fields ever leave
// the observer API) and the cache behaviour.
import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObserverCache } from '../../src/modules/observer/observer.cache.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';
import { buildApp, createUser, login, seedTwoPs } from '../auth/helpers.js';
import type { Agent } from '../auth/helpers.js';
import { PASSWORD, countingApp, v } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import { buildReportWorld } from '../reports/world.js';
import type { ReportWorld } from '../reports/world.js';

let pool: Pool;
let migrator: Pool;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

async function observerAgent(app: Express): Promise<Agent> {
  await createUser(pool, { username: 'obs_par', role: 'OBSERVER', password: PASSWORD });
  const agent = request.agent(app);
  expect((await login(agent, 'obs_par', PASSWORD)).status).toBe(200);
  return agent;
}

async function dmAgent(app: Express, username: string): Promise<Agent> {
  const agent = request.agent(app);
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}

const getJson = async (agent: Agent, path: string): Promise<Record<string, unknown>> => {
  const res = await agent.get(path);
  expect(res.status, path).toBe(200);
  return res.body as Record<string, unknown>;
};

type Progress = Record<string, number>;
interface DmSummary {
  sections: Record<string, { progress: Progress; partySeats: unknown[]; women: { list: { ward: { id: number } }[] } }>;
}
interface DmStatus {
  summary: Record<'PS' | 'ZP', Record<string, unknown>>;
  psTable: Record<string, unknown>[];
  wards: Record<string, unknown>[];
}

function expectKpisEqualProgress(kpis: Record<string, unknown>, progress: Progress): void {
  for (const key of [
    'wardsTotal',
    'declared',
    'unopposed',
    'counting',
    'notStarted',
    'boothsEntered',
    'boothsTotal',
    'postalEntered',
    'postalTotal',
  ]) {
    expect(kpis[key], key).toBe(progress[key]);
  }
}

describe('zero state (before 20 November)', () => {
  let app: Express;
  let obs: Agent;
  let dm: Agent;

  beforeAll(async () => {
    await resetData(migrator);
    await seedTwoPs(pool);
    await createUser(pool, { username: 'dm_par', role: 'DM', password: PASSWORD });
    app = buildApp(pool);
    obs = await observerAgent(app);
    dm = await dmAgent(app, 'dm_par');
  });

  it('overview matches the DM summary and says NOT_STARTED', async () => {
    const overview = await getJson(obs, '/api/observer/overview');
    const summary = (await getJson(dm, '/api/reports/summary')) as unknown as DmSummary;
    expect(overview.phase).toBe('NOT_STARTED');
    const kpis = overview.kpis as { ps: Record<string, unknown>; zp: Record<string, unknown> };
    expectKpisEqualProgress(kpis.ps, summary.sections.ALL_PS?.progress ?? {});
    expectKpisEqualProgress(kpis.zp, summary.sections.ZP?.progress ?? {});
    expect(overview.partySeats).toEqual({
      ps: summary.sections.ALL_PS?.partySeats ?? [],
      zp: summary.sections.ZP?.partySeats ?? [],
    });
    expect(overview.feed).toEqual([]);
    const structure = overview.structure as Record<string, number>;
    expect(structure.panchayatSamitis).toBe(2);
    expect(structure.candidates).toBe(0);
  });

  it('PS list, ZP list and winners are empty but well-formed', async () => {
    const ps = await getJson(obs, '/api/observer/ps');
    const status = (await getJson(dm, '/api/reports/counting-status')) as unknown as DmStatus;
    expect((ps.list as unknown[]).length).toBe(status.psTable.length);
    const zp = await getJson(obs, '/api/observer/zp');
    expect(zp.wards).toEqual([]);
    const winners = await getJson(obs, '/api/observer/winners');
    expect(winners.list).toEqual([]);
  });
});

describe('mid-counting parity with the DM reports', () => {
  let world: ReportWorld;
  let app: Express;
  let obs: Agent;
  let dm: Agent;
  let zpSpanId = 0; // the ZP ward with booths (and entries) in BOTH PS

  beforeAll(async () => {
    await resetData(migrator);
    world = await buildReportWorld(pool, migrator);

    // --- extend the world: a ZP ward spanning two PS, an "A" booth, and a voided entry.
    const [zpRow] = await pool.execute<ResultSetHeader>(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'Test' WHERE ward_type = 'ZP' AND ward_no = 2",
    );
    expect(zpRow.affectedRows).toBe(1);
    const [[zpRest]] = (await pool.execute(
      "SELECT id FROM ward WHERE ward_type = 'ZP' AND ward_no = 2",
    )) as unknown as [{ id: number }[]];
    zpSpanId = zpRest?.id ?? 0;
    const zc1 = await insert(
      pool,
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, 1, 'ज़िला उम्मीदवार एक', 'M', 0, ?)",
      [zpSpanId, world.parties.P1],
    );
    const zc2 = await insert(
      pool,
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, 2, 'ज़िला उम्मीदवार दो', 'F', 0, ?)",
      [zpSpanId, world.parties.P2],
    );
    const zNota = await insert(
      pool,
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, 3, 'नोटा', NULL, 1, NULL)",
      [zpSpanId],
    );

    // An "A" booth (15A) in ps2 on the mid-counting PS ward, also in the spanning ZP ward.
    const ps2Ward = world.w.ps2Lead;
    if (!ps2Ward) throw new Error('ps2Lead missing');
    const boothA = await insert(
      pool,
      "INSERT INTO booth (panchayat_samiti_id, booth_no, booth_suffix, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, 15, 'A', 'बूथ 15A', ?, ?)",
      [world.ps2, ps2Ward.id, zpSpanId],
    );

    const capp = countingApp(pool);
    const ro2 = await declareClient(capp, world.users.ro2);
    const ro1 = await declareClient(capp, world.users.ro1);

    // PS ballot on 15A (the "A" booth counts toward ps2Lead's booth progress).
    const entryA = await ro2.post('/entries', {
      wardId: ps2Ward.id,
      boothId: boothA,
      ballotFor: 'PS',
      sheetTotal: 120,
      votes: v([
        [ps2Ward.A, 70],
        [ps2Ward.B, 45],
        [ps2Ward.NOTA, 5],
      ]),
    });
    expect(entryA.status, JSON.stringify(entryA.body)).toBe(201);

    // ZP ballot entries in BOTH PS for the spanning ZP ward: 15A (ps2) and close100's booth (ps1).
    const zpVotes = v([
      [zc1, 70],
      [zc2, 20],
      [zNota, 10],
    ]);
    const zpA = await ro2.post('/entries', {
      wardId: zpSpanId,
      boothId: boothA,
      ballotFor: 'ZP',
      sheetTotal: 100,
      votes: zpVotes,
    });
    expect(zpA.status, JSON.stringify(zpA.body)).toBe(201);
    const c100 = world.w.close100;
    if (!c100) throw new Error('close100 missing');
    const zpB = await ro1.post('/entries', {
      wardId: zpSpanId,
      boothId: c100.boothId,
      ballotFor: 'ZP',
      sheetTotal: 60,
      votes: v([
        [zc1, 40],
        [zc2, 15],
        [zNota, 5],
      ]),
    });
    expect(zpB.status, JSON.stringify(zpB.body)).toBe(201);

    // A voided entry: one more ZP entry, then void it (it must vanish from every count).
    const ps2OwnBooth = await insert(
      pool,
      "INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, 16, 'बूथ 16', ?, ?)",
      [world.ps2, ps2Ward.id, zpSpanId],
    );
    const toVoid = await ro2.post('/entries', {
      wardId: zpSpanId,
      boothId: ps2OwnBooth,
      ballotFor: 'ZP',
      sheetTotal: 10,
      votes: v([
        [zc1, 8],
        [zc2, 2],
        [zNota, 0],
      ]),
    });
    expect(toVoid.status, JSON.stringify(toVoid.body)).toBe(201);
    const voidId = (toVoid.body as { entry: { id: number } }).entry.id;
    const voided = await ro2.post(`/entries/${voidId}/void`, {
      rowVersion: 1,
      reason: 'गलत बूथ की पर्ची दर्ज हो गई थी',
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);

    // A fresh app AFTER all writes, so the observer cache builds on the final state.
    app = buildApp(pool);
    obs = await observerAgent(app);
    dm = await dmAgent(app, world.users.dm);
  });

  it('overview KPIs and party position equal the DM summary exactly', async () => {
    const overview = await getJson(obs, '/api/observer/overview');
    const summary = (await getJson(dm, '/api/reports/summary')) as unknown as DmSummary;
    expect(overview.phase).toBe('IN_PROGRESS');
    const kpis = overview.kpis as { ps: Record<string, unknown>; zp: Record<string, unknown> };
    expectKpisEqualProgress(kpis.ps, summary.sections.ALL_PS?.progress ?? {});
    expectKpisEqualProgress(kpis.zp, summary.sections.ZP?.progress ?? {});
    expect(overview.partySeats).toEqual({
      ps: summary.sections.ALL_PS?.partySeats,
      zp: summary.sections.ZP?.partySeats,
    });
  });

  it('the declarations feed matches the ward_declarations table (newest first, corrections marked)', async () => {
    const overview = await getJson(obs, '/api/observer/overview');
    const feed = overview.feed as { wardId: number; version: number; isCorrection: boolean; declaredAt: string }[];
    const [[row]] = (await pool.execute(
      'SELECT COUNT(*) AS n FROM ward_declarations',
    )) as unknown as [{ n: number }[]];
    expect(feed.length).toBe(Math.min(row?.n ?? 0, 15));
    for (let i = 1; i < feed.length; i++) {
      const a = feed[i - 1]?.declaredAt ?? '';
      const b = feed[i]?.declaredAt ?? '';
      expect(a >= b).toBe(true);
    }
    const corrected = world.w.corrected;
    expect(feed.some((f) => f.wardId === corrected?.id && f.version === 2 && f.isCorrection)).toBe(
      true,
    );
  });

  it('PS cards equal the DM Counting Status PS table', async () => {
    const ps = await getJson(obs, '/api/observer/ps');
    const status = (await getJson(dm, '/api/reports/counting-status')) as unknown as DmStatus;
    const list = ps.list as Record<string, unknown>[];
    expect(list.length).toBe(status.psTable.length);
    for (const card of list) {
      const dmRow = status.psTable.find((p) => p.psId === card.psId);
      expect(dmRow, String(card.psId)).toBeDefined();
      expect(card.wardsTotal).toBe(dmRow?.wardsTotal);
      expect(card.declared).toBe(dmRow?.declared);
      expect(card.boothsDone).toBe(dmRow?.psBoothsDone);
      expect(card.boothsTotal).toBe(dmRow?.psBoothsTotal);
      expect(card.zpBoothsDone).toBe(dmRow?.zpBoothsDone);
      expect(card.zpBoothsTotal).toBe(dmRow?.zpBoothsTotal);
    }
    expect(ps.summary).toEqual(status.summary.PS);
  });

  it('ward rows (PS drill-down and ZP list) equal the DM Counting Status ward rows', async () => {
    const status = (await getJson(dm, '/api/reports/counting-status')) as unknown as DmStatus;
    const detail = await getJson(obs, `/api/observer/ps/${world.ps1}`);
    for (const row of detail.wards as Record<string, unknown>[]) {
      const dmRow = status.wards.find((x) => x.wardId === row.wardId);
      expect(dmRow, String(row.wardId)).toBeDefined();
      for (const key of ['status', 'boothsDone', 'boothsTotal', 'postalDone', 'margin']) {
        expect(row[key], `${String(row.wardId)} ${key}`).toStrictEqual(dmRow?.[key]);
      }
      expect(row.winner).toEqual(dmRow?.winner);
    }
    const zp = await getJson(obs, '/api/observer/zp');
    const zpRows = zp.wards as Record<string, unknown>[];
    expect(zpRows.length).toBe(status.wards.filter((x) => x.kind === 'ZP').length);
    const span = zpRows.find((x) => x.wardId === zpSpanId);
    const dmSpan = status.wards.find((x) => x.wardId === zpSpanId);
    // The spanning ZP ward: 2 of its booths entered (15A in ps2, one in ps1); the voided one not.
    expect(span?.boothsDone).toBe(2);
    expect(span?.boothsDone).toBe(dmSpan?.boothsDone);
    expect(span?.boothsTotal).toBe(dmSpan?.boothsTotal);
    expect(zp.summary).toEqual(status.summary.ZP);
    // Its by-PS progress rows match the DM's zpPsProgress (both PS contribute).
    const byPs = (zp.byPs as { wardId: number; rows: { boothsDone: number }[] }[]).find(
      (x) => x.wardId === zpSpanId,
    );
    expect(byPs?.rows.reduce((s, r) => s + r.boothsDone, 0)).toBe(2);
  });

  it('ward detail equals the DM ward detail (declared, counting, and the spanning ZP ward)', async () => {
    const corrected = world.w.corrected;
    const ps2Lead = world.w.ps2Lead;
    for (const wardId of [corrected?.id ?? 0, ps2Lead?.id ?? 0, zpSpanId]) {
      const ours = await getJson(obs, `/api/observer/wards/${wardId}`);
      const theirs = await getJson(dm, `/api/reports/wards/${wardId}`);
      const ourWard = ours.ward as Record<string, unknown>;
      const dmWard = theirs.ward as Record<string, unknown>;
      for (const key of [
        'status',
        'totalValidVotes',
        'notaVotes',
        'boothsEntered',
        'boothsTotal',
        'postalEntered',
        'margin',
      ]) {
        expect(ourWard[key], `${String(wardId)} ${key}`).toStrictEqual(dmWard[key]);
      }
      const ourCands = ours.candidates as Record<string, unknown>[];
      const dmCands = theirs.candidates as Record<string, unknown>[];
      expect(ourCands.length).toBe(dmCands.length);
      for (const c of ourCands) {
        const d = dmCands.find((x) => x.id === c.id);
        expect(c.totalVotes, String(c.id)).toBe(d?.totalVotes);
        expect(c.boothVotes).toBe(d?.boothVotes);
        expect(c.postalVotes).toBe(d?.postalVotes);
        expect(c.rank).toStrictEqual(d?.rank);
        expect(c.isWinner).toBe(d?.isWinner);
      }
      // Booth labels (incl. "15A") agree with the DM's, with only progress fields kept.
      const ourBooths = ours.booths as Record<string, unknown>[];
      const dmBooths = theirs.booths as Record<string, unknown>[];
      expect(ourBooths.map((b) => [b.boothNo, b.entered])).toEqual(
        dmBooths.map((b) => [b.boothNo, b.entered]),
      );
    }
    const zpDetail = await getJson(obs, `/api/observer/wards/${zpSpanId}`);
    expect((zpDetail.ward as { status: string }).status).toBe('COUNTING');
    expect((zpDetail.booths as { boothNo: string }[]).some((b) => b.boothNo === '15A')).toBe(true);
    expect((zpDetail.ward as { boothsEntered: number }).boothsEntered).toBe(2);
  });

  it('winners equal the DM Counting Status winners; women flags equal the DM women section', async () => {
    const winners = await getJson(obs, '/api/observer/winners');
    const status = (await getJson(dm, '/api/reports/counting-status')) as unknown as DmStatus;
    const summary = (await getJson(dm, '/api/reports/summary')) as unknown as DmSummary;
    const dmWinners = status.wards.filter((x) => x.winner !== null);
    const list = winners.list as Record<string, unknown>[];
    expect(list.length).toBe(dmWinners.length);
    for (const w of list) {
      const d = dmWinners.find((x) => x.wardId === w.wardId);
      expect(w.winner).toEqual(d?.winner);
      expect(w.margin).toStrictEqual(d?.margin);
    }
    const womenIds = new Set(
      [
        ...(summary.sections.ALL_PS?.women.list ?? []),
        ...(summary.sections.ZP?.women.list ?? []),
      ].map((x) => x.ward.id),
    );
    for (const w of list) {
      expect(w.isWoman, String(w.wardId)).toBe(womenIds.has(w.wardId as number));
    }
    // The women section itself is the DM's, verbatim.
    const women = await getJson(obs, '/api/observer/women');
    expect(women.ps).toEqual(summary.sections.ALL_PS?.women);
    expect(women.zp).toEqual(summary.sections.ZP?.women);
  });

  it('search finds wards by number, PS name and candidate name', async () => {
    const byNo = await getJson(obs, '/api/observer/search?q=1');
    expect((byNo.hits as unknown[]).length).toBeGreaterThan(0);
    const byPs = await getJson(obs, '/api/observer/search?q=rajgarh');
    expect(
      (byPs.hits as { psName: string | null }[]).every((h) => h.psName?.includes('RAJGARH')),
    ).toBe(true);
    const byCand = await getJson(obs, '/api/observer/search?q=सीमा');
    const hits = byCand.hits as { matchedCandidates: { name: string }[] }[];
    expect(hits.some((h) => h.matchedCandidates.some((c) => c.name.includes('सीमा')))).toBe(true);
  });

  // ---------------------------------------------------------------- privacy

  const FORBIDDEN_KEYS = new Set([
    'username',
    'fullName',
    'full_name',
    'enteredBy',
    'updatedBy',
    'declaredBy',
    'entered_by',
    'declared_by',
    'phone',
    'mobile',
    'dob',
    'dateOfBirth',
    'date_of_birth',
    'address',
    'occupation',
    'age',
    'fatherName',
    'father_husband_name',
    'reason',
    'correctionReason',
    'lottery',
    'conductedBy',
    'note',
    'password',
    'passwordEnc',
    'email',
    'registeredVoters',
    'registeredVotersTotal',
    'ip',
  ]);

  function scanKeys(value: unknown, path: string, hits: string[]): void {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        scanKeys(item, `${path}[${String(i)}]`, hits);
      });
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) hits.push(`${path}.${key}`);
        scanKeys(child, `${path}.${key}`, hits);
      }
    }
  }

  it('no observer JSON response contains a personal or operational field', async () => {
    const paths = [
      '/api/observer/overview',
      '/api/observer/ps',
      `/api/observer/ps/${world.ps1}`,
      '/api/observer/zp',
      '/api/observer/winners',
      '/api/observer/women',
      '/api/observer/search?q=सीमा',
      `/api/observer/wards/${world.w.corrected?.id ?? 0}`, // corrected: has reasons in the DM view
      `/api/observer/wards/${world.w.lottery?.id ?? 0}`, // lottery: has conductedBy in the DM view
      `/api/observer/wards/${zpSpanId}`,
    ];
    for (const path of paths) {
      const body = await getJson(obs, path);
      const hits: string[] = [];
      scanKeys(body, path, hits);
      expect(hits, path).toEqual([]);
    }
  });

  it('downloads carry no officer names (the entered-by column is blanked)', async () => {
    for (const path of [
      '/api/observer/reports/counting-status/booths.csv',
      '/api/observer/reports/counting-status/wards.csv',
      '/api/observer/reports/counting-status/zp-by-ps.csv',
    ]) {
      const res = await obs.get(path);
      expect(res.status, path).toBe(200);
      const text = res.text;
      expect(text.includes('rep_ro'), path).toBe(false);
      expect(text.includes('Full rep'), path).toBe(false);
    }
    const pdf = await obs.get('/api/observer/reports/counting-status.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('download CSV numbers equal the DM CSV numbers (same renderer, same report)', async () => {
    const ours = await obs.get('/api/observer/reports/counting-status/wards.csv');
    const theirs = await dm.get('/api/reports/counting-status/wards.csv');
    expect(ours.status).toBe(200);
    expect(theirs.status).toBe(200);
    // Identical apart from the entered-by blanking (ward CSV has no officer column at all):
    // allow the as-of timestamp to differ between the two reads.
    const strip = (t: string) =>
      t
        .split('\n')
        .filter((line) => !line.includes('IST'))
        .join('\n');
    expect(strip(ours.text)).toBe(strip(theirs.text));
  });

  // ---------------------------------------------------------------- cache

  it('the observer cache serves one build per TTL and shares concurrent builds', async () => {
    const cache = new ObserverCache(pool, 200);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b); // one in-flight build shared
    const c = await cache.get();
    expect(c).toBe(a); // still cached
    await new Promise((resolve) => setTimeout(resolve, 250));
    const d = await cache.get();
    expect(d).not.toBe(a); // rebuilt after the TTL
    expect(d.builtAt >= a.builtAt).toBe(true);
  });
});
