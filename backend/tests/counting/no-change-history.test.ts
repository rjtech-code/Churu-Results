// Part 8 fixes: identical updates are refused (NO_CHANGE, nothing written) and the whole-story
// history of a booth ballot / a ward's postal ballots (live + voided entries, oldest first).
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  buildWorld,
  captureEvents,
  clientFor,
  count,
  countingApp,
  psW1Sheet,
  tableCounts,
  v,
} from './helpers.js';
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

const REASON = 'Checked the sheet again';

const postal = (a: number, b: number, n: number, rejectedCount?: number) => ({
  sheetTotal: a + b + n,
  ...(rejectedCount === undefined ? {} : { rejectedCount }),
  votes: v([
    [w.c.A, a],
    [w.c.B, b],
    [w.c.N1, n],
  ]),
});

const idOf = (body: unknown) => (body as { entry: { id: number } }).entry.id;

interface Event {
  entryId: number;
  entryVoided: boolean;
  action: string;
  reason: string | null;
}

describe('NO_CHANGE: an identical update writes nothing', () => {
  it('booth entry: same round, total and votes -> 400 NO_CHANGE; row_version, votes, audit unchanged', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = idOf((await ro.post('/entries', psW1Sheet(w, w.b1, 300, 200, 10, 2))).body);
    const before = await tableCounts(pool);
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 300, 200, 10);
    // the votes in a different order are still the same sheet
    const cap = captureEvents();
    let res;
    try {
      res = await ro.put(`/entries/${id}`, {
        rowVersion: 1,
        roundNo: 2,
        sheetTotal,
        votes: [...votes].reverse(),
        reason: REASON,
      });
    } finally {
      cap.stop();
    }
    expect([res.status, res.body]).toEqual([400, { error: 'NO_CHANGE' }]);
    expect(cap.events).toEqual([]);
    expect(await tableCounts(pool)).toEqual(before);
    expect(
      await count(pool, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ENTRY_UPDATED'"),
    ).toBe(0);
    const entry = (await ro.get(`/entries/${id}`)).body as {
      entry: { rowVersion: number; votes: unknown };
    };
    expect(entry.entry.rowVersion).toBe(1);
    expect(entry.entry.votes).toEqual(votes);
  });

  it('booth entry: changing only the round is a real change (200)', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = idOf((await ro.post('/entries', psW1Sheet(w, w.b1))).body);
    const { votes, sheetTotal } = psW1Sheet(w, w.b1);
    const res = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 3,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect(res.status).toBe(200);
  });

  it('a stale identical update is still STALE_VERSION (the version check comes first)', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = idOf((await ro.post('/entries', psW1Sheet(w, w.b1))).body);
    const { votes, sheetTotal } = psW1Sheet(w, w.b1);
    const res = await ro.put(`/entries/${id}`, {
      rowVersion: 7,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect((res.body as { error: string }).error).toBe('STALE_VERSION');
  });

  it('postal entry: same total, rejected count and votes -> 400 NO_CHANGE; nothing written', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = idOf((await ro.post(`/wards/${w.psW1}/postal`, postal(4, 3, 1, 7))).body);
    const before = await tableCounts(pool);
    const res = await ro.put(`/postal/${id}`, {
      rowVersion: 1,
      ...postal(4, 3, 1, 7),
      reason: REASON,
    });
    expect([res.status, res.body]).toEqual([400, { error: 'NO_CHANGE' }]);
    expect(await tableCounts(pool)).toEqual(before);
    expect(
      ((await ro.get(`/postal/${id}`)).body as { entry: { rowVersion: number } }).entry.rowVersion,
    ).toBe(1);
  });

  it('postal entry: changing only the rejected count (or dropping it) is a real change', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const id = idOf((await ro.post(`/wards/${w.psW1}/postal`, postal(4, 3, 1, 7))).body);
    const changed = await ro.put(`/postal/${id}`, {
      rowVersion: 1,
      ...postal(4, 3, 1, 8),
      reason: REASON,
    });
    expect(changed.status).toBe(200);
    const dropped = await ro.put(`/postal/${id}`, {
      rowVersion: 2,
      ...postal(4, 3, 1),
      reason: REASON,
    });
    expect(dropped.status).toBe(200);
  });
});

describe('booth ballot history: GET /booths/:boothId/history?ballotFor=', () => {
  it('create -> edit -> void -> re-create: 4 events, oldest first, across 2 entry ids', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const first = idOf((await ro.post('/entries', psW1Sheet(w, w.b1, 100, 50, 5))).body);
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 101, 50, 5);
    expect(
      (
        await ro.put(`/entries/${first}`, {
          rowVersion: 1,
          roundNo: 1,
          sheetTotal,
          votes,
          reason: 'Corrected candidate A count',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await ro.post(`/entries/${first}/void`, {
          rowVersion: 2,
          reason: 'Wrong booth chosen here',
        })
      ).status,
    ).toBe(200);
    const second = idOf((await ro.post('/entries', psW1Sheet(w, w.b1, 7, 8, 9))).body);
    // another booth's story must not leak in
    await ro.post('/entries', psW1Sheet(w, w.b2));

    const res = await ro.get(`/booths/${w.b1}/history?ballotFor=PS`);
    expect(res.status).toBe(200);
    const history = (res.body as { history: Event[] }).history;
    expect(history.map((e) => [e.action, e.entryId, e.entryVoided])).toEqual([
      ['ENTRY_CREATED', first, true],
      ['ENTRY_UPDATED', first, true],
      ['ENTRY_VOIDED', first, true],
      ['ENTRY_CREATED', second, false],
    ]);
    expect(history[1]?.reason).toBe('Corrected candidate A count');
    expect(history[2]?.reason).toBe('Wrong booth chosen here');
  });

  it('the ZP ballot of the same booth has its own story; empty when never entered', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    await ro.post('/entries', psW1Sheet(w, w.b1));
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    const res = await zp.get(`/booths/${w.b1}/history?ballotFor=ZP`);
    expect([res.status, res.body]).toEqual([200, { history: [] }]);
  });

  it('same permissions as the entry: other PS 403, PS_RO on a ZP ballot 403, ZP_RO on PS 403', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    await ro1.post('/entries', psW1Sheet(w, w.b1));
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    const zp = await clientFor(app, 'zp_ro_x3');
    expect((await ro2.get(`/booths/${w.b1}/history?ballotFor=PS`)).status).toBe(403);
    expect((await ro1.get(`/booths/${w.b1}/history?ballotFor=ZP`)).status).toBe(403);
    expect((await zp.get(`/booths/${w.b1}/history?ballotFor=PS`)).status).toBe(403);
  });

  it('unknown booth 404; a missing or bad ballotFor is VALIDATION_FAILED', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await ro.get('/booths/99999999/history?ballotFor=PS')).status).toBe(404);
    for (const q of ['', '?ballotFor=XX', '?ballotFor=PS&x=1']) {
      expect((await ro.get(`/booths/${w.b1}/history${q}`)).body).toMatchObject({
        error: 'VALIDATION_FAILED',
      });
    }
  });

  it('the DM may not read it (counting routes are for ROs)', async () => {
    const dm = await clientFor(countingApp(pool), 'dm_x4');
    expect((await dm.get(`/booths/${w.b1}/history?ballotFor=PS`)).status).toBe(403);
  });
});

describe('postal history: GET /wards/:wardId/postal/history', () => {
  it('create -> edit -> void -> re-create: 4 events, oldest first, across 2 entry ids', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const first = idOf((await ro.post(`/wards/${w.psW1}/postal`, postal(4, 3, 1))).body);
    expect(
      (await ro.put(`/postal/${first}`, { rowVersion: 1, ...postal(5, 3, 1), reason: REASON }))
        .status,
    ).toBe(200);
    expect(
      (await ro.post(`/postal/${first}/void`, { rowVersion: 2, reason: 'Sheet of another ward' }))
        .status,
    ).toBe(200);
    const second = idOf((await ro.post(`/wards/${w.psW1}/postal`, postal(1, 1, 1))).body);

    const res = await ro.get(`/wards/${w.psW1}/postal/history`);
    expect(res.status).toBe(200);
    const history = (res.body as { history: Event[] }).history;
    expect(history.map((e) => [e.action, e.entryId, e.entryVoided])).toEqual([
      ['POSTAL_CREATED', first, true],
      ['POSTAL_UPDATED', first, true],
      ['POSTAL_VOIDED', first, true],
      ['POSTAL_CREATED', second, false],
    ]);
  });

  it('same permissions as the postal entry: other PS 403, ZP_RO on a PS ward 403; unknown ward 404', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    await ro1.post(`/wards/${w.psW1}/postal`, postal(1, 1, 1));
    expect(
      (await (await clientFor(app, 'ro_ps2_x2')).get(`/wards/${w.psW1}/postal/history`)).status,
    ).toBe(403);
    expect(
      (await (await clientFor(app, 'zp_ro_x3')).get(`/wards/${w.psW1}/postal/history`)).status,
    ).toBe(403);
    expect((await ro1.get('/wards/99999999/postal/history')).status).toBe(404);
    expect((await ro1.get(`/wards/${w.psW2}/postal/history`)).status).toBe(403);
  });
});
