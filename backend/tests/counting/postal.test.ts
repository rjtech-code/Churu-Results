import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, captureEvents, clientFor, countingApp, tableCounts, v } from './helpers.js';
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

const postal = (w: World, a: number, b: number, n: number, rejectedCount?: number) => ({
  sheetTotal: a + b + n,
  ...(rejectedCount === undefined ? {} : { rejectedCount }),
  votes: v([
    [w.c.A, a],
    [w.c.B, b],
    [w.c.N1, n],
  ]),
});

describe('postal entries', () => {
  it('create: 201; rejectedCount stored and NOT part of the sum; audit; event', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const cap = captureEvents();
    let res;
    try {
      res = await ro.post(`/wards/${w.psW1}/postal`, postal(w, 4, 3, 1, 7));
      expect(cap.events).toEqual([{ wardId: w.psW1 }]);
    } finally {
      cap.stop();
    }
    expect(res.status).toBe(201);
    const body = res.body as {
      entry: Record<string, unknown>;
      wardResult: Record<string, unknown>;
    };
    expect(body.entry).toMatchObject({
      kind: 'POSTAL',
      wardId: w.psW1,
      sheetTotal: 8,
      rejectedCount: 7,
      rowVersion: 1,
    });
    expect(body.wardResult).toMatchObject({
      postalEntered: true,
      rejectedPostal: 7,
      totalValidVotes: 8,
    });
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM audit_log WHERE action = 'POSTAL_CREATED'",
    );
    expect(audit[0]).toMatchObject({
      entity: 'postal_entry',
      new_value: { ward_id: w.psW1, rejected_count: 7 },
    });

    // Only one postal entry per ward.
    const second = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await second.post(`/wards/${w.psW1}/postal`, postal(w, 1, 1, 1))).body).toMatchObject({
      error: 'ALREADY_ENTERED',
    });
  });

  it('rejectedCount is optional; postal sum must equal sheetTotal', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const bad = await ro.post(`/wards/${w.psW1}/postal`, {
      ...postal(w, 4, 3, 1, 5),
      sheetTotal: 13,
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'SUM_MISMATCH', sum: 8, sheetTotal: 13 });
    const ok = await ro.post(`/wards/${w.psW1}/postal`, postal(w, 4, 3, 1));
    expect((ok.body as { entry: { rejectedCount: unknown } }).entry.rejectedCount).toBeNull();
  });

  it('preview writes nothing and shows the ward with postal', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const before = await tableCounts(pool);
    const res = await ro.post(`/wards/${w.psW1}/postal/preview`, postal(w, 4, 3, 1, 2));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      summary: { wardId: w.psW1, boothId: null, sheetTotal: 8, rejectedCount: 2, sum: 8 },
      wardAfter: { postalEntered: true, rejectedPostal: 2 },
    });
    expect(await tableCounts(pool)).toEqual(before);
  });

  it('update with reason and rowVersion; void archives and frees the ward for a new postal entry', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const created = await ro.post(`/wards/${w.psW1}/postal`, postal(w, 4, 3, 1, 7));
    const id = (created.body as { entry: { id: number } }).entry.id;

    const upd = await ro.put(`/postal/${id}`, {
      rowVersion: 1,
      ...postal(w, 5, 3, 1, 6),
      reason: 'Recounted the postal sheet',
    });
    expect(upd.status).toBe(200);
    expect((upd.body as { entry: unknown }).entry).toMatchObject({
      rowVersion: 2,
      sheetTotal: 9,
      rejectedCount: 6,
    });
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM audit_log WHERE action = 'POSTAL_UPDATED'",
    );
    expect(audit[0]).toMatchObject({
      old_value: { sheet_total: 8, rejected_count: 7 },
      new_value: { sheet_total: 9, rejected_count: 6 },
      reason: 'Recounted the postal sheet',
    });

    const stale = await ro.post(`/postal/${id}/void`, {
      rowVersion: 1,
      reason: 'Wrong ward postal sheet',
    });
    expect(stale.body).toMatchObject({ error: 'STALE_VERSION', currentRowVersion: 2 });
    const voided = await ro.post(`/postal/${id}/void`, {
      rowVersion: 2,
      reason: 'Wrong ward postal sheet',
    });
    expect(voided.status).toBe(200);
    expect((voided.body as { wardResult: unknown }).wardResult).toMatchObject({
      postalEntered: false,
    });
    const [archive] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM voided_entry WHERE entry_kind = 'POSTAL'",
    );
    expect(archive[0]).toMatchObject({
      original_entry_id: id,
      booth_id: null,
      sheet_total: 9,
      rejected_count: 6,
    });
    const [vaudit] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM audit_log WHERE action = 'POSTAL_VOIDED'",
    );
    expect(vaudit).toHaveLength(1);
    expect((await ro.post(`/wards/${w.psW1}/postal`, postal(w, 1, 1, 1))).status).toBe(201);
  });

  it('ZP_RO enters ZP postal; PS_RO cannot', async () => {
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    const body = {
      sheetTotal: 3,
      votes: v([
        [w.c.E, 1],
        [w.c.F, 1],
        [w.c.N3, 1],
      ]),
    };
    expect((await zp.post(`/wards/${w.zW1}/postal`, body)).status).toBe(201);
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await ro.post(`/wards/${w.zW1}/postal/preview`, body)).status).toBe(403);
  });
});
