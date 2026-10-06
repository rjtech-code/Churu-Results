import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, countingApp, psW1Sheet, v } from './helpers.js';
import type { World } from './helpers.js';

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

interface WardItem {
  id: number;
  status: string;
}

describe('counting reads', () => {
  it('GET /wards: PS_RO sees only its PS wards (with status), ZP_RO only ZP wards; no-candidate wards are NO_CANDIDATES', async () => {
    // A PS ward of ps1 with a booth but no candidates yet.
    await pool.execute(
      "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT 'PS', district_id, id, 9 FROM panchayat_samiti WHERE id = ?",
      [w.ps1],
    );
    const app = countingApp(pool);
    const ro = await clientFor(app, 'ro_ps1_x1');
    await ro.post('/entries', psW1Sheet(w, w.b1));
    const res = await ro.get('/wards');
    expect(res.status).toBe(200);
    const wards = (res.body as { wards: (WardItem & Record<string, unknown>)[] }).wards;
    expect(wards.map((x) => [x.wardNo, x.status])).toEqual([
      [1, 'COUNTING'],
      [3, 'UNOPPOSED'],
      [4, 'NOT_STARTED'],
      [9, 'NO_CANDIDATES'],
    ]);
    expect(wards[0]).toEqual({
      id: w.psW1,
      kind: 'PS',
      wardNo: 1,
      panchayatSamiti: { id: w.ps1, name: 'पंचायत समिति चूरू' },
      ballotLocked: true,
      isUnopposed: false,
      status: 'COUNTING',
      boothsEntered: 1,
      boothsTotal: 3,
      postalEntered: false,
    });
    expect(wards.find((x) => x.status === 'NO_CANDIDATES')).toMatchObject({
      boothsTotal: 0,
      ballotLocked: false,
    });

    const zp = await clientFor(app, 'zp_ro_x3');
    const zpWards = ((await zp.get('/wards')).body as { wards: (WardItem & { kind: string })[] })
      .wards;
    expect(zpWards.map((x) => [x.id, x.kind, x.status])).toEqual([[w.zW1, 'ZP', 'NOT_STARTED']]);
  });

  it('GET /wards/:id/booths lists the booths (ZP ward across PS) with entry state and postal state', async () => {
    const app = countingApp(pool);
    const zp = await clientFor(app, 'zp_ro_x3');
    const created = await zp.post('/entries', {
      wardId: w.zW1,
      boothId: w.b3,
      ballotFor: 'ZP',
      roundNo: 4,
      sheetTotal: 3,
      votes: v([
        [w.c.E, 1],
        [w.c.F, 1],
        [w.c.N3, 1],
      ]),
    });
    const entryId = (created.body as { entry: { id: number } }).entry.id;
    const res = await zp.get(`/wards/${w.zW1}/booths`);
    const body = res.body as {
      booths: {
        boothId: number;
        entered: boolean;
        entryId: number | null;
        roundNo: number | null;
        panchayatSamiti: string;
      }[];
      postal: unknown;
    };
    expect(body.booths).toHaveLength(6);
    expect(body.booths.find((b) => b.boothId === w.b3)).toMatchObject({
      entered: true,
      entryId,
      roundNo: 4,
      panchayatSamiti: 'पंचायत समिति राजगढ़',
    });
    expect(body.booths.filter((b) => b.entered)).toHaveLength(1);
    expect(body.postal).toEqual({ entered: false, entryId: null, enteredAt: null });
    expect((await zp.get(`/wards/${w.psW1}/booths`)).status).toBe(403);
  });

  it('GET /wards/:id/ballot gives candidates in ballot order with NOTA', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const res = await ro.get(`/wards/${w.psW1}/ballot`);
    expect((res.body as { candidates: unknown[] }).candidates).toEqual([
      {
        candidateId: w.c.A,
        ballotPosition: 1,
        nameHindi: 'ए',
        partyShortName: null,
        isNota: false,
      },
      {
        candidateId: w.c.B,
        ballotPosition: 2,
        nameHindi: 'बी',
        partyShortName: null,
        isNota: false,
      },
      {
        candidateId: w.c.N1,
        ballotPosition: 3,
        nameHindi: 'नोटा',
        partyShortName: null,
        isNota: true,
      },
    ]);
    expect((await ro.get(`/wards/${w.psW2}/ballot`)).status).toBe(403);
  });

  it('GET entry and its history (create, update, void) — history survives the void', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const entry = await ro.get(`/entries/${id}`);
    expect((entry.body as { entry: unknown }).entry).toMatchObject({
      id,
      rowVersion: 1,
      votes: psW1Sheet(w, w.b1).votes,
    });
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 1, 2, 3);
    await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 2,
      sheetTotal,
      votes,
      reason: 'Corrected all three counts',
    });
    await ro.post(`/entries/${id}/void`, {
      rowVersion: 2,
      reason: 'Wrong booth entirely, re-enter',
    });

    const history = (await ro.get(`/entries/${id}/history`)).body as {
      history: {
        action: string;
        user: { username: string };
        reason: string | null;
        oldValue: unknown;
        newValue: unknown;
      }[];
    };
    expect(history.history.map((h) => [h.action, h.user.username, h.reason])).toEqual([
      ['ENTRY_CREATED', 'ro_ps1_x1', null],
      ['ENTRY_UPDATED', 'ro_ps1_x1', 'Corrected all three counts'],
      ['ENTRY_VOIDED', 'ro_ps1_x1', 'Wrong booth entirely, re-enter'],
    ]);
    expect(JSON.stringify(history)).not.toMatch(/"ip"/);
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    expect((await zp.get(`/entries/${id}/history`)).status).toBe(403);
  });

  it('GET postal entry and its history', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const created = await ro.post(`/wards/${w.psW1}/postal`, {
      sheetTotal: 3,
      rejectedCount: 1,
      votes: v([
        [w.c.A, 1],
        [w.c.B, 1],
        [w.c.N1, 1],
      ]),
    });
    const id = (created.body as { entry: { id: number } }).entry.id;
    expect(((await ro.get(`/postal/${id}`)).body as { entry: unknown }).entry).toMatchObject({
      id,
      rejectedCount: 1,
      rowVersion: 1,
    });
    const booths = (await ro.get(`/wards/${w.psW1}/booths`)).body as { postal: unknown };
    expect(booths.postal).toMatchObject({ entered: true, entryId: id });
    const history = (await ro.get(`/postal/${id}/history`)).body as {
      history: { action: string }[];
    };
    expect(history.history.map((h) => h.action)).toEqual(['POSTAL_CREATED']);
  });
});
