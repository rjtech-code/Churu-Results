// Official order: a ZP ward's postal ballots are entered ONLY by the PS_RO of the assigned PS
// (zp_ward_postal_assignment); the ZP_RO enters no booth or postal sheet but declares and corrects;
// a ZP ward's progress is shown by Panchayat Samiti (one builder for RO pages, report, CSV).
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login } from '../auth/helpers.js';
import { confirmBody, declareClient, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  assignZpPostal,
  buildWorld,
  clientFor,
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
  await assignZpPostal(pool, w.zW1, w.ps1); // zW1 spans ps1 (5 booths) and ps2 (1 booth)
});

const REASON = 'पर्ची दोबारा जाँची, गलती सुधारी';
const zpPostal = (w: World, e: number, f: number, n: number, rejectedCount?: number) => ({
  sheetTotal: e + f + n,
  ...(rejectedCount === undefined ? {} : { rejectedCount }),
  votes: v([
    [w.c.E, e],
    [w.c.F, f],
    [w.c.N3, n],
  ]),
});

function expectNoWardTotals(body: unknown) {
  const text = JSON.stringify(body);
  for (const key of ['totalValidVotes', 'leader', 'runnerUp', 'margin', 'wardAfter', 'top3'])
    expect(text).not.toContain(`"${key}"`);
}

describe('ZP postal: only the assigned PS_RO', () => {
  let ro1: Client;
  let ro2: Client;
  let zp: Client;
  beforeEach(async () => {
    const app = countingApp(pool);
    ro1 = await clientFor(app, 'ro_ps1_x1');
    ro2 = await clientFor(app, 'ro_ps2_x2');
    zp = await clientFor(app, 'zp_ro_x3');
  });

  it('assigned PS_RO: preview, create, edit (reason + new version) and void; never ward totals', async () => {
    const preview = await ro1.post(`/wards/${w.zW1}/postal/preview`, zpPostal(w, 3, 2, 1, 4));
    expect(preview.status).toBe(200);
    expectNoWardTotals(preview.body);

    const created = await ro1.post(`/wards/${w.zW1}/postal`, zpPostal(w, 3, 2, 1, 4));
    expect(created.status).toBe(201);
    expect((created.body as { wardResult: unknown }).wardResult).toBeNull();
    const entry = (
      created.body as { entry: { id: number; rowVersion: number; rejectedCount: number } }
    ).entry;
    expect(entry.rejectedCount).toBe(4); // the rejected-postal field works as before

    expect((await ro1.get(`/postal/${entry.id}`)).status).toBe(200);
    const noReason = await ro1.put(`/postal/${entry.id}`, {
      rowVersion: 1,
      ...zpPostal(w, 4, 2, 1),
    });
    expect(noReason.status).toBe(400);
    const edited = await ro1.put(`/postal/${entry.id}`, {
      rowVersion: 1,
      ...zpPostal(w, 4, 2, 1),
      reason: REASON,
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { entry: { rowVersion: number } }).entry.rowVersion).toBe(2);
    expect((edited.body as { wardResult: unknown }).wardResult).toBeNull();
    expect((await ro1.get(`/wards/${w.zW1}/postal/history`)).status).toBe(200);

    const voided = await ro1.post(`/postal/${entry.id}/void`, { rowVersion: 2, reason: REASON });
    expect(voided.status).toBe(200);
    expect((voided.body as { wardResult: unknown }).wardResult).toBeNull();
  });

  it('another PS_RO and the ZP_RO: create, preview, edit and void -> 403, nothing written', async () => {
    const id = (
      (await ro1.post(`/wards/${w.zW1}/postal`, zpPostal(w, 3, 2, 1))).body as {
        entry: { id: number };
      }
    ).entry.id;
    const before = await tableCounts(pool);
    for (const c of [ro2, zp]) {
      expect((await c.post(`/wards/${w.zW1}/postal`, zpPostal(w, 1, 1, 1))).status).toBe(403);
      expect((await c.post(`/wards/${w.zW1}/postal/preview`, zpPostal(w, 1, 1, 1))).status).toBe(
        403,
      );
      const edit = await c.put(`/postal/${id}`, {
        rowVersion: 1,
        ...zpPostal(w, 9, 2, 1),
        reason: REASON,
      });
      expect(edit.status).toBe(403);
      expect((await c.post(`/postal/${id}/void`, { rowVersion: 1, reason: REASON })).status).toBe(
        403,
      );
    }
    expect((await ro2.get(`/postal/${id}`)).status).toBe(403);
    // The ZP_RO may READ it (it corrects the ward after declaring).
    expect((await zp.get(`/postal/${id}`)).status).toBe(200);
    expect(await tableCounts(pool)).toEqual(before);
  });

  it("PS ward postal stays with that PS's RO only (ZP_RO and other PS_RO 403)", async () => {
    const body = {
      sheetTotal: 2,
      votes: v([
        [w.c.A, 1],
        [w.c.B, 1],
        [w.c.N1, 0],
      ]),
    };
    expect((await zp.post(`/wards/${w.psW1}/postal`, body)).status).toBe(403);
    expect((await ro2.post(`/wards/${w.psW1}/postal`, body)).status).toBe(403);
    expect((await ro1.post(`/wards/${w.psW1}/postal`, body)).status).toBe(201);
  });

  it('a ZP ward with no assignment: nobody can enter its postal ballots', async () => {
    await pool.execute('DELETE FROM zp_ward_postal_assignment');
    for (const c of [ro1, ro2, zp])
      expect((await c.post(`/wards/${w.zW1}/postal`, zpPostal(w, 1, 1, 1))).status).toBe(403);
  });

  it('GET /zp-postal and /zp-postal/:id: the assigned wards with ballot and postal state only', async () => {
    const list = await ro1.get('/zp-postal');
    expect(list.status).toBe(200);
    expect((list.body as { wards: unknown[] }).wards).toEqual([
      {
        id: w.zW1,
        wardNo: 1,
        state: 'OPEN',
        postal: { entered: false, entryId: null, enteredAt: null },
      },
    ]);
    expect(((await ro2.get('/zp-postal')).body as { wards: unknown[] }).wards).toEqual([]);
    const one = await ro1.get(`/zp-postal/${w.zW1}`);
    expect(one.status).toBe(200);
    expectNoWardTotals(one.body);
    expect((one.body as { ballot: unknown[] }).ballot).toHaveLength(3);
    expect((await ro2.get(`/zp-postal/${w.zW1}`)).status).toBe(403);
    expect((await ro1.get('/zp-postal/999999')).status).toBe(404);
    expect((await zp.get('/zp-postal')).status).toBe(403);
  });
});

describe('ZP_RO: no entries, but declares', () => {
  it('booth create/preview/edit/void and postal -> 403; declares once its PS ROs are done', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    const zp = await declareClient(app, 'zp_ro_x3');

    expect((await zp.post('/entries', zW1Sheet(w, w.b1))).status).toBe(403);
    expect((await zp.post('/entries/preview', zW1Sheet(w, w.b1))).status).toBe(403);
    const mine = ((await ro1.post('/entries', zW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    expect(
      (
        await zp.put(`/entries/${mine}`, {
          rowVersion: 1,
          sheetTotal: 155,
          votes: zW1Sheet(w, w.b1).votes,
          reason: REASON,
        })
      ).status,
    ).toBe(403);
    expect((await zp.post(`/entries/${mine}/void`, { rowVersion: 1, reason: REASON })).status).toBe(
      403,
    );
    expect((await zp.get(`/entries/${mine}`)).status).toBe(200); // read-only, for correction

    for (const b of [w.b2, w.b4, w.b5, w.b6])
      expect((await ro1.post('/entries', zW1Sheet(w, b))).status).toBe(201);
    expect((await ro2.post('/entries', zW1Sheet(w, w.b3))).status).toBe(201);
    expect((await ro1.post(`/wards/${w.zW1}/postal`, zpPostal(w, 1, 0, 0))).status).toBe(201);

    const result = await previewResult(zp, w.zW1);
    expect(result.status).toBe('READY_TO_DECLARE');
    expect((await zp.dpost(`/wards/${w.zW1}`, confirmBody(result))).status).toBe(201);
  });
});

describe('ZP ward progress by Panchayat Samiti', () => {
  it('two PS: booths done / total per PS add up to the ward; postal row assigned to one; same in the list, report and CSV', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    const zp = await clientFor(app, 'zp_ro_x3');
    expect((await ro1.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);
    expect((await ro1.post('/entries', zW1Sheet(w, w.b2))).status).toBe(201);
    expect((await ro2.post('/entries', zW1Sheet(w, w.b3))).status).toBe(201);

    const res = await zp.get(`/wards/${w.zW1}/zp-progress`);
    expect(res.status).toBe(200);
    const progress = (res.body as { progress: unknown }).progress;
    expect(progress).toMatchObject({
      wardId: w.zW1,
      wardNo: 1,
      rows: [
        // ps1 = पंचायत समिति चूरू (English "Churu"), ps2 = Rajgarh: name order
        { psId: w.ps1, boothsDone: 2, boothsTotal: 5 },
        { psId: w.ps2, boothsDone: 1, boothsTotal: 1 },
      ],
      postal: { assignedPsId: w.ps1, entered: false, lastEntryAt: null },
    });
    // The ZP_RO's ward list shows the same numbers: the ward across both PS, and per PS.
    const listed = (
      (await zp.get('/wards')).body as {
        wards: {
          id: number;
          boothsEntered: number;
          boothsTotal: number;
          boothsByPs: { psId: number; entered: number; total: number }[];
        }[];
      }
    ).wards.find((x) => x.id === w.zW1);
    expect(listed).toMatchObject({ boothsEntered: 3, boothsTotal: 6 });
    expect(
      [...(listed?.boothsByPs ?? [])]
        .sort((a, b) => a.psId - b.psId)
        .map((p) => [p.psId, p.entered, p.total]),
    ).toEqual(
      [
        [w.ps1, 2, 5],
        [w.ps2, 1, 1],
      ].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)),
    );
    const rows = (progress as { rows: { lastEntryAt: string | null }[] }).rows;
    expect(rows.every((r) => r.lastEntryAt !== null)).toBe(true);
    expect((progress as { postal: { label: string } }).postal.label).toMatch(/^Assigned to /);
    // Not for PS wards, not for a PS_RO (it gets its own row only, on the ZP tab).
    expect((await zp.get(`/wards/${w.psW1}/zp-progress`)).status).toBe(403);
    expect((await ro1.get(`/wards/${w.zW1}/zp-progress`)).status).toBe(403);
    const tab = (await ro2.get(`/zp-wards/${w.zW1}/ps-booths`)).body as {
      progress: { rows: { psId: number }[]; postal: { assignedPsId: number } };
    };
    expect(tab.progress.rows.map((r) => r.psId)).toEqual([w.ps2]);
    expect(tab.progress.postal.assignedPsId).toBe(w.ps1);

    // The postal entry shows on the postal row.
    await ro1.post(`/wards/${w.zW1}/postal`, zpPostal(w, 1, 0, 0));
    const after = (
      (await zp.get(`/wards/${w.zW1}/zp-progress`)).body as {
        progress: { postal: { entered: boolean; lastEntryAt: string | null } };
      }
    ).progress.postal;
    expect(after.entered).toBe(true);
    expect(after.lastEntryAt).not.toBeNull();

    // The Counting Status Report (ZP_RO) carries the very same rows; the CSV prints them.
    const agent = request.agent(app);
    expect((await login(agent, 'zp_ro_x3', PASSWORD)).status).toBe(200);
    const report = (await agent.get(`/api/reports/counting-status?level=WARD&wardId=${w.zW1}`))
      .body as { zpPsProgress: unknown[] };
    const fresh = ((await zp.get(`/wards/${w.zW1}/zp-progress`)).body as { progress: unknown })
      .progress;
    expect(report.zpPsProgress).toEqual([fresh]);
    const csv = (
      await agent.get(`/api/reports/counting-status/zp-by-ps.csv?level=WARD&wardId=${w.zW1}`)
    ).text;
    const lines = csv
      .replace(/^\uFEFF/, '')
      .replaceAll('"', '')
      .trim()
      .split(/\r?\n/);
    expect(lines[0]).toBe(
      'zp_ward_no,row,ps_name,booths_done,booths_total,postal,last_entry_ist,report_time_ist,counting_date',
    );
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 6).join(','))).toEqual([
      expect.stringMatching(/^1,booths,.+,2,5,$/) as string,
      expect.stringMatching(/^1,booths,.+,1,1,$/) as string,
      expect.stringMatching(/^1,postal,.+,,,entered$/) as string,
    ]);
  });
});
