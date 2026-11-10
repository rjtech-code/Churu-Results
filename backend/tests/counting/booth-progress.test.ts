// Counting progress = booths entered / total booths (booth-progress.ts), the same on every screen:
// the RO ward list, the booth list, the PS_RO's ZP tab, ZP progress by PS, the DM's Counting Status
// Report and ward detail. A booth counts once it has a live (not voided) entry; postal ballots are
// shown next to it, never inside it. Ward status follows booth entries + the one postal entry.
import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  assignZpPostal,
  buildWorld,
  clientFor,
  count,
  countingApp,
  psW1Sheet,
  v,
  zW1Sheet,
} from './helpers.js';
import type { Client, World } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
/** ps1's "A" booth 2A (between 2 and 4): in psW1 and zW1, like every ps1 booth. */
let b2A: number;
let app: Express;
let ro1: Client;
let ro2: Client;
let zp: Client;

const REASON = 'गलत बूथ की पर्ची दर्ज हो गई थी';

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
  await assignZpPostal(pool, w.zW1, w.ps1);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO booth (panchayat_samiti_id, booth_no, booth_suffix, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
     VALUES (?, 2, 'A', 'बूथ 2A', ?, ?, 1000)`,
    [w.ps1, w.psW1, w.zW1],
  );
  b2A = res.insertId;
  app = countingApp(pool);
  ro1 = await clientFor(app, 'ro_ps1_x1');
  ro2 = await clientFor(app, 'ro_ps2_x2');
  zp = await clientFor(app, 'zp_ro_x3');
});

interface ListedWard {
  id: number;
  status: string;
  boothsEntered: number;
  boothsTotal: number;
  postalEntered: boolean;
  boothsByPs: { psId: number; entered: number; total: number }[];
}
const listed = async (c: Client, wardId: number): Promise<ListedWard> => {
  const ward = ((await c.get('/wards')).body as { wards: ListedWard[] }).wards.find(
    (x) => x.id === wardId,
  );
  if (ward === undefined) throw new Error(`ward ${String(wardId)} not listed`);
  return ward;
};
const boothList = async (c: Client, wardId: number) =>
  (await c.get(`/wards/${String(wardId)}/booths`)).body as {
    booths: { boothNo: string; entered: boolean; entryId: number | null }[];
    postal: { entered: boolean };
  };

/** The DM's view of one ward: the Counting Status ward row and the ward-detail numbers. */
async function dmView(wardId: number) {
  const agent = request.agent(app);
  expect((await login(agent, 'dm_x4', PASSWORD)).status).toBe(200);
  const report = (
    await agent.get(`/api/reports/counting-status?level=WARD&wardId=${String(wardId)}`)
  ).body as {
    wards: {
      status: string;
      boothsDone: number;
      boothsTotal: number;
      postalDone: boolean;
      pendingBooths: string;
    }[];
    zpPsProgress: { rows: { psId: number; boothsDone: number; boothsTotal: number }[] }[];
  };
  const detail = (await agent.get(`/api/reports/wards/${String(wardId)}`)).body as {
    ward: { boothsEntered: number; boothsTotal: number; postalEntered: boolean };
  };
  const row = report.wards[0];
  if (row === undefined || report.wards.length !== 1) throw new Error('one ward row expected');
  return { row, zpPsProgress: report.zpPsProgress, detail: detail.ward };
}

/** Every screen agrees on `entered / total` for the PS ward psW1. */
async function expectPsW1Progress(entered: number, total: number, pendingBooths: string) {
  expect(await listed(ro1, w.psW1)).toMatchObject({ boothsEntered: entered, boothsTotal: total });
  const booths = await boothList(ro1, w.psW1);
  expect(booths.booths.filter((b) => b.entered)).toHaveLength(entered);
  expect(booths.booths).toHaveLength(total);
  const dm = await dmView(w.psW1);
  expect(dm.row).toMatchObject({ boothsDone: entered, boothsTotal: total, pendingBooths });
  expect(dm.detail).toMatchObject({ boothsEntered: entered, boothsTotal: total });
}

const entryId = (body: unknown): number => (body as { entry: { id: number } }).entry.id;

describe('booth progress: booths entered / total, one count on every screen', () => {
  it('PS ward with an "A" booth: 2A counts like any booth, sorts after 2; a voided entry is not counted', async () => {
    expect((await boothList(ro1, w.psW1)).booths.map((b) => b.boothNo)).toEqual([
      '1',
      '2',
      '2A',
      '4',
    ]);
    await expectPsW1Progress(0, 4, '1–2, 2A, 4');

    expect((await ro1.post('/entries', psW1Sheet(w, w.b1))).status).toBe(201);
    const a = await ro1.post('/entries', psW1Sheet(w, b2A));
    expect(a.status).toBe(201);
    await expectPsW1Progress(2, 4, '2, 4');
    expect((await boothList(ro1, w.psW1)).booths.map((b) => [b.boothNo, b.entered])).toEqual([
      ['1', true],
      ['2', false],
      ['2A', true],
      ['4', false],
    ]);

    // Void: the booth is pending again everywhere.
    const voided = await ro1.post(`/entries/${String(entryId(a.body))}/void`, {
      rowVersion: 1,
      reason: REASON,
    });
    expect(voided.status).toBe(200);
    await expectPsW1Progress(1, 4, '2, 2A, 4');

    // Entered again: counted once, not twice.
    expect((await ro1.post('/entries', psW1Sheet(w, b2A))).status).toBe(201);
    await expectPsW1Progress(2, 4, '2, 4');
  });

  it('ZP ward spanning two PS: counted across every booth of both PS; the per-PS parts add up', async () => {
    expect((await ro1.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);
    expect((await ro1.post('/entries', zW1Sheet(w, b2A))).status).toBe(201);
    expect((await ro2.post('/entries', zW1Sheet(w, w.b3))).status).toBe(201);
    // ps1: b1, b2, b2A, b4, b5, b6 (6) · ps2: b3 (1).
    const zpList = await listed(zp, w.zW1);
    expect(zpList).toMatchObject({ boothsEntered: 3, boothsTotal: 7, postalEntered: false });
    const byPs = new Map(zpList.boothsByPs.map((p) => [p.psId, [p.entered, p.total]]));
    expect(byPs).toEqual(
      new Map([
        [w.ps1, [2, 6]],
        [w.ps2, [1, 1]],
      ]),
    );

    const progress = (
      (await zp.get(`/wards/${String(w.zW1)}/zp-progress`)).body as {
        progress: { rows: { psId: number; boothsDone: number; boothsTotal: number }[] };
      }
    ).progress.rows;
    expect(new Map(progress.map((r) => [r.psId, [r.boothsDone, r.boothsTotal]]))).toEqual(byPs);

    // Each PS_RO sees only its own part on its ZP tab.
    const tab = async (c: Client) =>
      (
        (await c.get('/zp-wards')).body as {
          wards: { id: number; boothsEntered: number; boothsTotal: number }[];
        }
      ).wards.find((x) => x.id === w.zW1);
    expect(await tab(ro1)).toMatchObject({ boothsEntered: 2, boothsTotal: 6 });
    expect(await tab(ro2)).toMatchObject({ boothsEntered: 1, boothsTotal: 1 });

    const dm = await dmView(w.zW1);
    expect(dm.row).toMatchObject({ boothsDone: 3, boothsTotal: 7, pendingBooths: 'CHURU: 2, 4–6' });
    expect(dm.detail).toMatchObject({ boothsEntered: 3, boothsTotal: 7 });
    expect(dm.zpPsProgress[0]?.rows.reduce((s, r) => s + r.boothsDone, 0)).toBe(3);
    expect(dm.zpPsProgress[0]?.rows.reduce((s, r) => s + r.boothsTotal, 0)).toBe(7);

    // Postal ballots are shown next to the booth count, never inside it.
    const postal = await ro1.post(`/wards/${String(w.zW1)}/postal`, {
      sheetTotal: 1,
      votes: v([
        [w.c.E, 1],
        [w.c.F, 0],
        [w.c.N3, 0],
      ]),
    });
    expect(postal.status).toBe(201);
    expect(await listed(zp, w.zW1)).toMatchObject({
      boothsEntered: 3,
      boothsTotal: 7,
      postalEntered: true,
    });
    expect((await dmView(w.zW1)).row).toMatchObject({
      boothsDone: 3,
      boothsTotal: 7,
      postalDone: true,
    });
  });

  it('status: Not Started -> In Progress -> Ready from booth entries + the one postal entry', async () => {
    const status = async () => {
      const ro = await listed(ro1, w.psW1);
      const dm = (await dmView(w.psW1)).row;
      return [
        ro.status,
        `${String(ro.boothsEntered)} / ${String(ro.boothsTotal)}`,
        ro.postalEntered,
        dm.status,
      ];
    };
    expect(await status()).toEqual(['NOT_STARTED', '0 / 4', false, 'NOT_STARTED']);

    // Postal alone already starts counting.
    const postal = await ro1.post(`/wards/${String(w.psW1)}/postal`, {
      sheetTotal: 0,
      votes: v([
        [w.c.A, 0],
        [w.c.B, 0],
        [w.c.N1, 0],
      ]),
    });
    expect(postal.status).toBe(201);
    expect(await status()).toEqual(['COUNTING', '0 / 4', true, 'IN_PROGRESS']);

    const ids: number[] = [];
    for (const b of [w.b1, w.b2, b2A])
      ids.push(entryId((await ro1.post('/entries', psW1Sheet(w, b))).body));
    expect(await status()).toEqual(['COUNTING', '3 / 4', true, 'IN_PROGRESS']);
    ids.push(entryId((await ro1.post('/entries', psW1Sheet(w, w.b4))).body));
    expect(await status()).toEqual(['READY_TO_DECLARE', '4 / 4', true, 'READY']);

    // A void takes the ward back to counting until the booth is entered again.
    expect(
      (await ro1.post(`/entries/${String(ids[3] ?? 0)}/void`, { rowVersion: 1, reason: REASON }))
        .status,
    ).toBe(200);
    expect(await status()).toEqual(['COUNTING', '3 / 4', true, 'IN_PROGRESS']);
    expect((await ro1.post('/entries', psW1Sheet(w, w.b4))).status).toBe(201);
    expect(await status()).toEqual(['READY_TO_DECLARE', '4 / 4', true, 'READY']);
  });

  it('every booth entered but no postal sheet: still counting', async () => {
    expect(
      (
        await ro2.post('/entries', {
          wardId: w.psW2,
          boothId: w.b3,
          ballotFor: 'PS',
          sheetTotal: 3,
          votes: v([
            [w.c.C, 2],
            [w.c.D, 1],
            [w.c.N2, 0],
          ]),
        })
      ).status,
    ).toBe(201);
    expect(await listed(ro2, w.psW2)).toMatchObject({
      status: 'COUNTING',
      boothsEntered: 1,
      boothsTotal: 1,
      postalEntered: false,
    });
  });
});

describe('one live entry per booth ballot', () => {
  it('a second sheet for the same booth ballot is refused; after a void it can be entered once more', async () => {
    const first = await ro1.post('/entries', psW1Sheet(w, w.b1));
    expect(first.status).toBe(201);
    const again = await ro1.post('/entries', psW1Sheet(w, w.b1, 1, 1, 1));
    expect([again.status, (again.body as { error: string }).error]).toEqual([
      409,
      'ALREADY_ENTERED',
    ]);
    // The ZP ballot of the same booth is a separate sheet.
    expect((await ro1.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);

    // The database itself refuses a second live row, whatever the app does.
    await expect(
      migrator.execute(
        "INSERT INTO booth_entry (booth_id, ballot_for, ward_id, sheet_total, entered_by) VALUES (?, 'PS', ?, 0, ?)",
        [w.b1, w.psW1, w.users.ro1],
      ),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    expect(
      (
        await ro1.post(`/entries/${String(entryId(first.body))}/void`, {
          rowVersion: 1,
          reason: REASON,
        })
      ).status,
    ).toBe(200);
    expect((await ro1.post('/entries', psW1Sheet(w, w.b1, 1, 1, 1))).status).toBe(201);
    expect(
      await count(
        pool,
        "SELECT COUNT(*) AS n FROM booth_entry WHERE booth_id = ? AND ballot_for = 'PS'",
        [w.b1],
      ),
    ).toBe(1);
    expect(
      await count(
        pool,
        "SELECT COUNT(*) AS n FROM voided_entry WHERE entry_kind = 'BOOTH' AND booth_id = ? AND ballot_for = 'PS'",
        [w.b1],
      ),
    ).toBe(1);
  });
});
