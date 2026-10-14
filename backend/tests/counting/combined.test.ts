// Part 14: a PS_RO enters the PS and ZP parts of one booth's parchi. Own-PS ZP booth ballots only;
// ZP postal, declare, lottery and correction stay ZP_RO's. The combined save is all-or-nothing.
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { confirmBody, declareClient, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildWorld,
  captureEvents,
  clientFor,
  count,
  countingApp,
  tableCounts,
  v,
  zW1Sheet,
} from './helpers.js';
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

const REASON = 'पर्ची दोबारा जाँची, गलती सुधारी';

const psPart = (a = 300, b = 200, n = 10) => ({
  sheetTotal: a + b + n,
  votes: v([
    [w.c.A, a],
    [w.c.B, b],
    [w.c.N1, n],
  ]),
});
const zpPart = (e = 100, f = 50, n = 5) => ({
  sheetTotal: e + f + n,
  votes: v([
    [w.c.E, e],
    [w.c.F, f],
    [w.c.N3, n],
  ]),
});
const combined = (boothId: number, extra: Record<string, unknown> = {}) => ({
  boothId,
  roundNo: 2,
  ps: psPart(),
  zp: zpPart(),
  ...extra,
});
const liveEntries = (ballotFor: 'PS' | 'ZP') =>
  count(pool, 'SELECT COUNT(*) AS n FROM booth_entry WHERE ballot_for = ?', [ballotFor]);

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
    // The combined screen hides the declared ZP section and refuses a ZP part.
    const view = await ro1.get(`/booths/${w.b2}/combined`);
    expect(view.body).toMatchObject({
      sections: [
        { ballotFor: 'PS', state: 'OPEN' },
        { ballotFor: 'ZP', state: 'HIDDEN', hiddenReason: 'DECLARED', entry: null },
      ],
    });
    const comb = await ro1.post('/entries/combined', combined(w.b2));
    expect(comb.status).toBe(409);
    expect(await tableCounts(pool)).toEqual(before);
  });
});

describe('combined PS + ZP save', () => {
  let ro1: Client;
  beforeEach(async () => {
    ro1 = await clientFor(countingApp(pool), 'ro_ps1_x1');
  });

  it('saves both parts in one go: two entries, two audit rows, both wards notified; no ward totals', async () => {
    const preview = await ro1.post('/entries/combined/preview', combined(w.b1));
    expect(preview.status).toBe(200);
    expectNoWardTotals(preview.body);
    expect(await liveEntries('PS')).toBe(0);

    const ev = captureEvents();
    const res = await ro1.post('/entries/combined', combined(w.b1));
    ev.stop();
    expect(res.status).toBe(201);
    expectNoWardTotals(res.body);
    const entries = (
      res.body as {
        entries: { ballotFor: string; wardId: number; roundNo: number; sheetTotal: number }[];
      }
    ).entries;
    expect(entries.map((e) => [e.ballotFor, e.wardId, e.roundNo, e.sheetTotal])).toEqual([
      ['PS', w.psW1, 2, 510],
      ['ZP', w.zW1, 2, 155],
    ]);
    expect(await liveEntries('PS')).toBe(1);
    expect(await liveEntries('ZP')).toBe(1);
    expect(
      await count(pool, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ENTRY_CREATED'"),
    ).toBe(2);
    expect(ev.events.map((e) => e.wardId).sort()).toEqual([w.psW1, w.zW1].sort());
  });

  it('only one part may be sent (the other already saved or hidden)', async () => {
    const res = await ro1.post('/entries/combined', { boothId: w.b1, roundNo: 1, zp: zpPart() });
    expect(res.status).toBe(201);
    expect(await liveEntries('PS')).toBe(0);
    expect(await liveEntries('ZP')).toBe(1);
  });

  it.each([
    [
      'ZP sum does not match its sheet total',
      () => ({ zp: { ...zpPart(), sheetTotal: 1 } }),
      'SUM_MISMATCH',
    ],
    [
      'PS sum does not match its sheet total',
      () => ({ ps: { ...psPart(), sheetTotal: 1 } }),
      'SUM_MISMATCH',
    ],
    [
      'ZP total over registered voters',
      () => ({ zp: zpPart(900, 100, 5) }),
      'EXCEEDS_REGISTERED_VOTERS',
    ],
    [
      'PS total over registered voters',
      () => ({ ps: psPart(900, 100, 5) }),
      'EXCEEDS_REGISTERED_VOTERS',
    ],
    [
      'ZP votes missing a candidate',
      () => ({ zp: { sheetTotal: 100, votes: v([[w.c.E, 100]]) } }),
      'VOTES_INCOMPLETE',
    ],
    [
      'ZP part with a PS candidate',
      () => ({
        zp: {
          sheetTotal: 1,
          votes: v([
            [w.c.A, 1],
            [w.c.E, 0],
            [w.c.F, 0],
            [w.c.N3, 0],
          ]),
        },
      }),
      'UNKNOWN_CANDIDATE',
    ],
  ])('all-or-nothing: %s -> nothing saved', async (_name, override, code) => {
    const before = await tableCounts(pool);
    // `w` is rebuilt per test, so the override is built lazily from the current world.
    const res = await ro1.post('/entries/combined', combined(w.b1, override()));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((res.body as { error: string }).error).toBe(code);
    expect((res.body as { section: string }).section).toBe(_name.startsWith('PS') ? 'PS' : 'ZP');
    expect(await tableCounts(pool)).toEqual(before);
    const preview = await ro1.post('/entries/combined/preview', combined(w.b1, override()));
    expect((preview.body as { error: string }).error).toBe(code);
  });

  it('all-or-nothing: ZP already entered by the ZP_RO -> 409 ALREADY_ENTERED and the PS part is not saved', async () => {
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    expect((await zp.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);
    const before = await tableCounts(pool);
    const res = await ro1.post('/entries/combined', combined(w.b1));
    expect([res.status, res.body]).toEqual([409, { error: 'ALREADY_ENTERED', section: 'ZP' }]);
    expect(await tableCounts(pool)).toEqual(before);
    expect(await liveEntries('PS')).toBe(0);
  });

  it('all-or-nothing: PS ward unopposed or not locked -> refused, ZP part not saved', async () => {
    const before = await tableCounts(pool);
    // b5 is in psW3 (unopposed), b6 in psW4 (not locked).
    expect(
      (
        await ro1.post(
          '/entries/combined',
          combined(w.b5, { ps: { sheetTotal: 0, votes: v([[w.c.U, 0]]) } }),
        )
      ).body,
    ).toEqual({
      error: 'WARD_UNOPPOSED',
      section: 'PS',
    });
    expect(
      (
        await ro1.post(
          '/entries/combined',
          combined(w.b6, {
            ps: {
              sheetTotal: 0,
              votes: v([
                [w.c.G, 0],
                [w.c.H, 0],
                [w.c.N4, 0],
              ]),
            },
          }),
        )
      ).body,
    ).toEqual({ error: 'BALLOT_NOT_LOCKED', section: 'PS' });
    expect(await tableCounts(pool)).toEqual(before);
  });

  it('permissions: other PS -> 403, ZP_RO -> 403, DM -> 403; nothing saved', async () => {
    const ro2 = await clientFor(countingApp(pool), 'ro_ps2_x2');
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    const dm = await clientFor(countingApp(pool), 'dm_x4');
    const before = await tableCounts(pool); // after the logins (they write audit rows)
    expect((await ro2.post('/entries/combined', combined(w.b1))).status).toBe(403);
    expect((await ro2.post('/entries/combined/preview', combined(w.b1))).status).toBe(403);
    expect(
      (await ro1.post('/entries/combined', { boothId: w.b3, roundNo: 1, zp: zpPart() })).status,
    ).toBe(403);
    expect(
      (await zp.post('/entries/combined', { boothId: w.b1, roundNo: 1, zp: zpPart() })).status,
    ).toBe(403);
    expect((await dm.post('/entries/combined', combined(w.b1))).status).toBe(403);
    expect(await tableCounts(pool)).toEqual(before);
  });

  it('validation: no part, a client wardId, a bad round -> VALIDATION_FAILED', async () => {
    for (const body of [
      { boothId: w.b1, roundNo: 1 },
      { ...combined(w.b1), wardId: w.psW1 },
      { ...combined(w.b1), roundNo: 0 },
      { boothId: w.b1, roundNo: 1, zp: { ...zpPart(), wardId: w.zW1 } },
    ]) {
      const res = await ro1.post('/entries/combined', body);
      expect([res.status, (res.body as { error: string }).error]).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
    expect(await liveEntries('PS')).toBe(0);
  });

  it('two combined saves of the same booth at once: exactly one wins', async () => {
    const ro1b = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const [a, b] = await Promise.all([
      ro1.post('/entries/combined', combined(w.b1)),
      ro1b.post('/entries/combined', combined(w.b1)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await liveEntries('PS')).toBe(1);
    expect(await liveEntries('ZP')).toBe(1);
  });
});

describe('GET /booths/:boothId/combined', () => {
  it('shows both sections with ballots; a ZP part saved by the ZP_RO shows as SAVED with its numbers', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const first = await ro1.get(`/booths/${w.b1}/combined`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      booth: { boothId: w.b1, boothNo: 1, registeredVotersTotal: 1000 },
      sections: [
        {
          ballotFor: 'PS',
          wardId: w.psW1,
          wardNo: 1,
          state: 'OPEN',
          hiddenReason: null,
          entry: null,
        },
        {
          ballotFor: 'ZP',
          wardId: w.zW1,
          wardNo: 1,
          state: 'OPEN',
          hiddenReason: null,
          entry: null,
        },
      ],
    });
    const zp = await clientFor(app, 'zp_ro_x3');
    await zp.post('/entries', zW1Sheet(w, w.b1));
    const after = await ro1.get(`/booths/${w.b1}/combined`);
    const zSection = (
      after.body as {
        sections: { state: string; entry: { sheetTotal: number; votes: unknown[] } | null }[];
      }
    ).sections[1];
    expect(zSection?.state).toBe('SAVED');
    expect(zSection?.entry?.sheetTotal).toBe(155);
    expectNoWardTotals(after.body);
  });

  it('hides an unopposed or not-locked PS section', async () => {
    const ro1 = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await ro1.get(`/booths/${w.b5}/combined`)).body).toMatchObject({
      sections: [{ state: 'HIDDEN', hiddenReason: 'UNOPPOSED', ballot: [] }, { state: 'OPEN' }],
    });
    expect((await ro1.get(`/booths/${w.b6}/combined`)).body).toMatchObject({
      sections: [{ state: 'HIDDEN', hiddenReason: 'NOT_LOCKED' }, { state: 'OPEN' }],
    });
  });

  it('other PS, ZP_RO and DM -> 403; unknown booth -> 404', async () => {
    const app = countingApp(pool);
    expect((await (await clientFor(app, 'ro_ps2_x2')).get(`/booths/${w.b1}/combined`)).status).toBe(
      403,
    );
    expect((await (await clientFor(app, 'zp_ro_x3')).get(`/booths/${w.b1}/combined`)).status).toBe(
      403,
    );
    expect((await (await clientFor(app, 'dm_x4')).get(`/booths/${w.b1}/combined`)).status).toBe(
      403,
    );
    expect(
      (await (await clientFor(app, 'ro_ps1_x1')).get('/booths/99999999/combined')).status,
    ).toBe(404);
  });
});

describe('ZP_RO ward list: booths entered per Panchayat Samiti', () => {
  it('counts ZP entries of each PS separately (PS_RO and ZP_RO entries alike)', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const zp = await clientFor(app, 'zp_ro_x3');
    await ro1.post('/entries/combined', combined(w.b1));
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
