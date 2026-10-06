import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WardCard } from '../../src/services/public-views.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, count, psW1Sheet } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { getJson, nextVersion, publicApp } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let h: PublicHarness;

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
  w = await buildWorld(pool);
  h = await publicApp(pool);
});
afterEach(() => {
  h.stop();
});

interface Screen12 {
  panchayatSamitis: {
    panchayatSamiti: { id: number; name: string };
    summary: Record<string, number>;
    wards: WardCard[];
  }[];
}

async function cardOf(wardId: number): Promise<WardCard> {
  for (const screen of ['1', '2']) {
    const body = (await getJson(h.app, `/api/public/screens/${screen}`)).body as Screen12;
    for (const block of body.panchayatSamitis) {
      const card = block.wards.find((c) => c.wardId === wardId);
      if (card) return card;
    }
  }
  const zp = (await getJson(h.app, '/api/public/screens/3')).body as { zp: { wards: WardCard[] } };
  const card = zp.zp.wards.find((c) => c.wardId === wardId);
  if (!card) throw new Error(`ward ${wardId} not on any screen`);
  return card;
}

describe('public endpoints — no session involved', () => {
  it('need no login and never set a cookie, also with an invalid or a stale session cookie', async () => {
    // A real but logged-out session id, then destroyed: a "stale" cookie.
    const stale = (await request(h.app).get('/api/auth/csrf')).headers[
      'set-cookie'
    ] as unknown as string[];
    const staleCookie = (stale[0] ?? '').split(';')[0] ?? '';
    await pool.execute('DELETE FROM sessions');
    for (const cookie of [
      undefined,
      'churu.sid=s%3Anot-a-real-session.badsignature',
      staleCookie,
    ]) {
      for (const path of ['/api/public/meta', '/api/public/screens/1']) {
        const req = request(h.app).get(path);
        const res = await (cookie === undefined ? req : req.set('Cookie', cookie));
        expect(res.status, `${path} ${cookie ?? ''}`).toBe(200);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    }
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });

  it('is read-only: other methods -> 405 without touching sessions; unknown path -> 404', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(h.app)[method]('/api/public/meta').send({});
      expect([res.status, res.body]).toEqual([405, { error: 'METHOD_NOT_ALLOWED' }]);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await request(h.app).get('/api/public/nope')).status).toBe(404);
    expect((await request(h.app).head('/api/public/meta')).status).toBe(200);
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });
});

describe('public data', () => {
  it('/meta: version, IST time, counting date, PS ids per screen in layout order', async () => {
    const res = await getJson(h.app, '/api/public/meta');
    expect(res.body).toEqual({
      version: expect.any(Number) as unknown,
      generatedAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+05:30$/,
      ) as unknown,
      countingDate: '2026-11-20',
      screens: { '1': [w.ps1], '2': [w.ps2], '3': 'ZP' },
    });
  });

  it('NOT_STARTED cards show no leader: empty top3, null margin, no tie, no NOTA count', async () => {
    const card = await cardOf(w.psW1);
    expect(card).toMatchObject({
      status: 'NOT_STARTED',
      top3: [],
      margin: null,
      topTied: false,
      notaVotes: 0,
      winner: null,
      boothsEntered: 0,
      boothsTotal: 3,
      latestRound: null,
      declarationVersion: null,
      isCorrected: false,
    });
  });

  it('COUNTING card has top3 and margin; UNOPPOSED has a winner', async () => {
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    const v0 = h.snapshots.get()?.version ?? 0;
    await ro.post('/entries', psW1Sheet(w, w.b1, 300, 200, 10, 3));
    await nextVersion(h, v0);
    expect(await cardOf(w.psW1)).toMatchObject({
      status: 'COUNTING',
      boothsEntered: 1,
      latestRound: 3,
      top3: [
        { name: 'ए', party: null, votes: 300, rank: 1, tiedWithPrevious: false },
        { name: 'बी', party: null, votes: 200, rank: 2, tiedWithPrevious: false },
      ],
      margin: 100,
      notaVotes: 10,
      winner: null,
    });
    expect(await cardOf(w.psW3)).toMatchObject({
      status: 'UNOPPOSED',
      isUnopposed: true,
      winner: { name: 'यू', party: null },
      margin: null,
    });
  });

  it('DECLARED card has the winner; a corrected ward shows isCorrected and version 2', async () => {
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    const filled = await fillPsW1(ro, w);
    await ro.dpost(`/wards/${w.psW1}`, confirmBody(await previewResult(ro, w.psW1)));
    await waitFor(async () => ((await cardOf(w.psW1)).status === 'DECLARED' ? true : undefined));
    expect(await cardOf(w.psW1)).toMatchObject({
      status: 'DECLARED',
      winner: { name: 'ए' },
      declarationVersion: 1,
      isCorrected: false,
    });

    const change = {
      kind: 'BOOTH',
      entryId: filled.entries.b1,
      rowVersion: 1,
      sheetTotal: 510,
      votes: [
        { candidateId: w.c.A, votes: 200 },
        { candidateId: w.c.B, votes: 300 },
        { candidateId: w.c.N1, votes: 10 },
      ],
    };
    const preview = await ro.dpost(`/wards/${w.psW1}/correction/preview`, { changes: [change] });
    const after = (
      preview.body as { after: { leader: { candidateId: number }; totalValidVotes: number } }
    ).after;
    const before = h.snapshots.get()?.version ?? 0;
    const res = await ro.dpost(`/wards/${w.psW1}/correction`, {
      password: 'Counting-Pass-1',
      reason: 'Booth one sheet corrected',
      changes: [change],
      confirmWinnerCandidateId: after.leader.candidateId,
      confirmTotalValidVotes: after.totalValidVotes,
    });
    expect(res.status).toBe(201);
    await nextVersion(h, before);
    expect(await cardOf(w.psW1)).toMatchObject({
      status: 'DECLARED',
      winner: { name: 'बी' },
      declarationVersion: 2,
      isCorrected: true,
    });

    const winners = (await getJson(h.app, '/api/public/winners')).body as {
      items: Record<string, unknown>[];
    };
    expect(
      winners.items.map((i) => [
        i.wardId,
        i.version,
        i.isCorrection,
        (i.winner as { name: string }).name,
      ]),
    ).toEqual([
      [w.psW1, 2, true, 'बी'],
      [w.psW1, 1, false, 'ए'],
    ]);
  });

  it('a ward without candidates is NO_CANDIDATES; a ward with broken data is UNAVAILABLE (others unaffected)', async () => {
    await pool.execute<ResultSetHeader>(
      "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT 'PS', district_id, id, 9 FROM panchayat_samiti WHERE id = ?",
      [w.ps1],
    );
    // An entry without vote rows: the engine refuses this ward.
    await pool.execute(
      "INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, 'PS', ?, 1, 0, ?)",
      [w.b3, w.psW2, w.users.ro2],
    );
    h.snapshots.requestRebuild();
    await nextVersion(h, h.snapshots.get()?.version ?? 0);
    const screen1 = (await getJson(h.app, '/api/public/screens/1')).body as Screen12;
    expect(screen1.panchayatSamitis[0]?.wards.find((c) => c.wardNo === 9)).toMatchObject({
      status: 'NO_CANDIDATES',
      top3: [],
      winner: null,
    });
    expect(await cardOf(w.psW2)).toMatchObject({
      status: 'UNAVAILABLE',
      top3: [],
      margin: null,
      winner: null,
    });
    expect(await cardOf(w.psW1)).toMatchObject({ status: 'NOT_STARTED' });
    expect(h.logs.some((l) => l.includes(`ward ${w.psW2} is UNAVAILABLE`))).toBe(true);
    expect(screen1.panchayatSamitis[0]?.summary).toEqual({
      wardsTotal: 4,
      declared: 0,
      unopposed: 1,
      counting: 0,
      notStarted: 3,
    });
  });

  it('/recent: newest first with leader or winner; limits; limit > 50 -> 400', async () => {
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    const zp = await declareClient(h.app, 'zp_ro_x3');
    await ro.post('/entries', psW1Sheet(w, w.b1));
    await new Promise((r) => setTimeout(r, 30));
    await zp.post('/entries', {
      wardId: w.zW1,
      boothId: w.b2,
      ballotFor: 'ZP',
      roundNo: 1,
      sheetTotal: 3,
      votes: [
        { candidateId: w.c.E, votes: 1 },
        { candidateId: w.c.F, votes: 1 },
        { candidateId: w.c.N3, votes: 1 },
      ],
    });
    await waitFor(
      async () =>
        ((await getJson(h.app, '/api/public/recent')).body as { items: unknown[] }).items.length ===
          2 || undefined,
    );
    const recent = (await getJson(h.app, '/api/public/recent')).body as {
      items: Record<string, unknown>[];
    };
    expect(recent.items.map((i) => [i.wardId, i.kind, i.psName, i.wardNo])).toEqual([
      [w.zW1, 'ZP', null, 1],
      [w.psW1, 'PS', 'पंचायत समिति चूरू', 1],
    ]);
    expect(recent.items[1]).toMatchObject({
      status: 'COUNTING',
      leaderOrWinner: { name: 'ए', party: null },
    });
    expect(recent.items[0]?.leaderOrWinner).toBeNull(); // E and F are tied
    expect(String(recent.items[0]?.changedAt)).toMatch(/\+05:30$/);
    expect(
      ((await getJson(h.app, '/api/public/recent?limit=1')).body as { items: unknown[] }).items,
    ).toHaveLength(1);
    for (const bad of ['51', '0', 'abc']) {
      expect((await getJson(h.app, `/api/public/recent?limit=${bad}`)).status).toBe(400);
      expect((await getJson(h.app, `/api/public/winners?limit=${bad}`)).status).toBe(400);
    }
    expect((await getJson(h.app, '/api/public/recent?other=1')).status).toBe(400);
  });

  it('screen number must be 1, 2 or 3', async () => {
    expect((await getJson(h.app, '/api/public/screens/4')).body).toMatchObject({
      error: 'VALIDATION_FAILED',
    });
    const s3 = (await getJson(h.app, '/api/public/screens/3')).body as Record<string, unknown>;
    expect(Object.keys(s3).sort()).toEqual([
      'generatedAt',
      'partySeats',
      'psPartySeats',
      'version',
      'zp',
    ]);
  });
});

async function waitFor<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 150; i++) {
    const v = await check();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout');
}
