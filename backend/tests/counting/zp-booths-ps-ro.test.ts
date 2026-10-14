// Part 14 / 14.1: a PS_RO enters ZP booth ballots of its own PS only (the ZP tab); ZP postal, declare,
// lottery and correction stay ZP_RO's. Includes the PS_RO's two read endpoints for the ZP tab.
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { confirmBody, declareClient, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, count, countingApp, tableCounts, v, zW1Sheet } from './helpers.js';
import type { Client, World } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;

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
});

const liveEntries = (ballotFor: 'PS' | 'ZP') =>
  count(pool, 'SELECT COUNT(*) AS n FROM booth_entry WHERE ballot_for = ?', [ballotFor]);

const REASON = 'पर्ची दोबारा जाँची, गलती सुधारी';

/** Words that only appear in a ward result (totals / leader); a PS_RO must never get them for ZP. */
function expectNoWardTotals(body: unknown) {
  const text = JSON.stringify(body);
  for (const key of ['totalValidVotes', 'leader', 'runnerUp', 'margin', 'wardAfter', 'top3'])
    expect(text).not.toContain(`"${key}"`);
}

describe('PS_RO on ZP booth ballots (single-ballot API)', () => {
  let ro1: Client;
  beforeEach(async () => {
    ro1 = await clientFor(countingApp(pool), 'ro_ps1_x1');
  });

  it('own PS: create, edit (reason) and void (reason) are allowed; no ZP ward totals returned', async () => {
    const preview = await ro1.post('/entries/preview', zW1Sheet(w, w.b1));
    expect(preview.status).toBe(200);
    expectNoWardTotals(preview.body);

    const created = await ro1.post('/entries', zW1Sheet(w, w.b1));
    expect(created.status).toBe(201);
    expect((created.body as { wardResult: unknown }).wardResult).toBeNull();
    const entry = (created.body as { entry: { id: number; rowVersion: number } }).entry;

    const noReason = await ro1.put(`/entries/${entry.id}`, {
      rowVersion: entry.rowVersion,
      roundNo: 1,
      sheetTotal: 156,
      votes: v([
        [w.c.E, 101],
        [w.c.F, 50],
        [w.c.N3, 5],
      ]),
    });
    expect(noReason.status).toBe(400);
    const edited = await ro1.put(`/entries/${entry.id}`, {
      rowVersion: entry.rowVersion,
      roundNo: 1,
      sheetTotal: 156,
      votes: v([
        [w.c.E, 101],
        [w.c.F, 50],
        [w.c.N3, 5],
      ]),
      reason: REASON,
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { wardResult: unknown }).wardResult).toBeNull();
    expect(
      await count(
        pool,
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ENTRY_UPDATED' AND entity_id = ?",
        [entry.id],
      ),
    ).toBe(1);

    const voided = await ro1.post(`/entries/${entry.id}/void`, {
      rowVersion: entry.rowVersion + 1,
      reason: REASON,
    });
    expect(voided.status).toBe(200);
    expect((voided.body as { wardResult: unknown }).wardResult).toBeNull();
    expect(await liveEntries('ZP')).toBe(0);
  });

  it('another PS: ZP booth ballot create, edit, void and read -> 403', async () => {
    const ro2 = await clientFor(countingApp(pool), 'ro_ps2_x2');
    expect((await ro2.post('/entries', zW1Sheet(w, w.b1))).status).toBe(403);
    expect((await ro2.post('/entries/preview', zW1Sheet(w, w.b1))).status).toBe(403);
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    const id = ((await zp.post('/entries', zW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    expect((await ro2.get(`/entries/${id}`)).status).toBe(403);
    expect(
      (
        await ro2.put(`/entries/${id}`, {
          rowVersion: 1,
          roundNo: 1,
          sheetTotal: 155,
          votes: zW1Sheet(w, w.b1).votes,
          reason: REASON,
        })
      ).status,
    ).toBe(403);
    expect((await ro2.post(`/entries/${id}/void`, { rowVersion: 1, reason: REASON })).status).toBe(
      403,
    );
    expect(await liveEntries('ZP')).toBe(1);
  });

  it('ZP ward-level work stays ZP_RO only: postal, booth list, ballot, declare, lottery, correction -> 403', async () => {
    const zpPostal = {
      sheetTotal: 0,
      votes: v([
        [w.c.E, 0],
        [w.c.F, 0],
        [w.c.N3, 0],
      ]),
    };
    expect((await ro1.post(`/wards/${w.zW1}/postal`, zpPostal)).status).toBe(403);
    expect((await ro1.post(`/wards/${w.zW1}/postal/preview`, zpPostal)).status).toBe(403);
    expect((await ro1.get(`/wards/${w.zW1}/booths`)).status).toBe(403);
    expect((await ro1.get(`/wards/${w.zW1}/ballot`)).status).toBe(403);

    const d = await declareClient(countingApp(pool), 'ro_ps1_x1');
    expect((await d.dpost(`/wards/${w.zW1}/preview`, {})).status).toBe(403);
    const decision = {
      password: 'Counting-Pass-1',
      confirmWinnerCandidateId: w.c.E,
      confirmTotalValidVotes: 0,
    };
    expect((await d.dpost(`/wards/${w.zW1}`, decision)).status).toBe(403);
    // A tie decided by lottery is recorded with the declare call.
    const lottery = { winnerCandidateId: w.c.E, conductedBy: 'आर.ओ.', note: 'लॉटरी से निर्णय हुआ' };
    expect((await d.dpost(`/wards/${w.zW1}`, { ...decision, lottery })).status).toBe(403);
    const changes = [
      { kind: 'BOOTH', entryId: 1, rowVersion: 1, sheetTotal: 0, votes: v([[w.c.E, 0]]) },
    ];
    expect((await d.dpost(`/wards/${w.zW1}/correction/preview`, { changes })).status).toBe(403);
    expect(
      (await d.dpost(`/wards/${w.zW1}/correction`, { ...decision, reason: REASON, changes }))
        .status,
    ).toBe(403);
  });
});

describe('after a ZP ward is declared', () => {
  it('a PS_RO can no longer create, edit or void its booth entries', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const zp = await declareClient(app, 'zp_ro_x3');
    const mine = (
      (await ro1.post('/entries', zW1Sheet(w, w.b1))).body as {
        entry: { id: number; rowVersion: number };
      }
    ).entry;
    for (const b of [w.b2, w.b3, w.b4, w.b5, w.b6])
      expect((await zp.post('/entries', zW1Sheet(w, b))).status).toBe(201);
    expect(
      (
        await zp.post(`/wards/${w.zW1}/postal`, {
          sheetTotal: 1,
          votes: v([
            [w.c.E, 1],
            [w.c.F, 0],
            [w.c.N3, 0],
          ]),
        })
      ).status,
    ).toBe(201);
    const result = await previewResult(zp, w.zW1);
    expect((await zp.dpost(`/wards/${w.zW1}`, confirmBody(result))).status).toBe(201);

    const before = await tableCounts(pool);
    const edit = await ro1.put(`/entries/${mine.id}`, {
      rowVersion: mine.rowVersion,
      roundNo: 1,
      sheetTotal: 156,
      votes: v([
        [w.c.E, 101],
        [w.c.F, 50],
        [w.c.N3, 5],
      ]),
      reason: REASON,
    });
    expect([edit.status, edit.body]).toEqual([409, { error: 'WARD_DECLARED' }]);
    const voided = await ro1.post(`/entries/${mine.id}/void`, {
      rowVersion: mine.rowVersion,
      reason: REASON,
    });
    expect(voided.status).toBe(409);
    // Creating a ZP booth entry is refused too (the booth is already entered, but the ward check
    // comes first: WARD_DECLARED, not ALREADY_ENTERED).
    const again = await ro1.post('/entries', zW1Sheet(w, w.b2));
    expect([again.status, again.body]).toEqual([409, { error: 'WARD_DECLARED' }]);
    const view = await ro1.get(`/zp-wards/${w.zW1}/ps-booths`);
    expect(view.body).toMatchObject({ ward: { state: 'DECLARED' } });
    expectNoWardTotals(view.body);
    expect(await tableCounts(pool)).toEqual(before);
  });
});

describe('ZP_RO ward list: booths entered per Panchayat Samiti', () => {
  it('counts ZP entries of each PS separately (PS_RO and ZP_RO entries alike)', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const zp = await clientFor(app, 'zp_ro_x3');
    await ro1.post('/entries', zW1Sheet(w, w.b1));
    await zp.post('/entries', zW1Sheet(w, w.b3));
    const wards = (
      (await zp.get('/wards')).body as {
        wards: { id: number; boothsByPs: unknown[]; boothsEntered: number; boothsTotal: number }[];
      }
    ).wards;
    const z = wards.find((x) => x.id === w.zW1);
    expect([z?.boothsEntered, z?.boothsTotal]).toEqual([2, 6]);
    expect(z?.boothsByPs).toEqual(
      expect.arrayContaining([
        { psId: w.ps1, psName: expect.any(String) as string, entered: 1, total: 5 },
        { psId: w.ps2, psName: expect.any(String) as string, entered: 1, total: 1 },
      ]),
    );
    expect(z?.boothsByPs).toHaveLength(2);
  });
});

describe('PS_RO ZP tab read endpoints', () => {
  it('GET /zp-wards: only ZP wards with own-PS booths, own-PS progress, no totals', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const zp = await clientFor(app, 'zp_ro_x3');
    await ro1.post('/entries', zW1Sheet(w, w.b1));
    await zp.post('/entries', zW1Sheet(w, w.b3)); // another PS's booth: must not count for PS 1
    const res = await ro1.get('/zp-wards');
    expect(res.status).toBe(200);
    expectNoWardTotals(res.body);
    const wards = (
      res.body as {
        wards: { id: number; boothsEntered: number; boothsTotal: number; state: string }[];
      }
    ).wards;
    const z = wards.find((x) => x.id === w.zW1);
    expect([z?.boothsEntered, z?.boothsTotal, z?.state]).toEqual([1, 5, 'OPEN']);
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    const other = (await ro2.get('/zp-wards')).body as {
      wards: { id: number; boothsEntered: number; boothsTotal: number }[];
    };
    const z2 = other.wards.find((x) => x.id === w.zW1);
    expect([z2?.boothsEntered, z2?.boothsTotal]).toEqual([1, 1]);
  });

  it('GET /zp-wards/:id/ps-booths: only own-PS booths and the ballot; no totals, leader or postal', async () => {
    const ro1 = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const res = await ro1.get(`/zp-wards/${w.zW1}/ps-booths`);
    expect(res.status).toBe(200);
    expectNoWardTotals(res.body);
    expect(JSON.stringify(res.body)).not.toContain('postal');
    const body = res.body as {
      ward: { id: number; state: string };
      booths: { boothId: number }[];
      ballot: { nameHindi: string }[];
    };
    expect(body.ward).toMatchObject({ id: w.zW1, state: 'OPEN' });
    expect(body.booths.map((b) => b.boothId)).not.toContain(w.b3);
    expect(body.booths.map((b) => b.boothId)).toContain(w.b1);
    expect(body.ballot).toHaveLength(3);
  });

  it('PS ward id or unknown id -> 404; each PS sees only its own booths; ZP_RO, DM -> 403', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    expect((await ro1.get(`/zp-wards/${w.psW1}/ps-booths`)).status).toBe(404);
    expect((await ro1.get('/zp-wards/99999999/ps-booths')).status).toBe(404);
    const ro2Booths = (await ro2.get(`/zp-wards/${w.zW1}/ps-booths`)).body as {
      booths: { boothId: number }[];
    };
    expect(ro2Booths.booths.map((b) => b.boothId)).toEqual([w.b3]);
    for (const user of ['zp_ro_x3', 'dm_x4']) {
      const c = await clientFor(app, user);
      expect((await c.get('/zp-wards')).status).toBe(403);
      expect((await c.get(`/zp-wards/${w.zW1}/ps-booths`)).status).toBe(403);
    }
  });
});
