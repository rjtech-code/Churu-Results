import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatMarginPercent } from '../../src/services/reports.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { psW1Sheet } from '../counting/helpers.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;

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
  w = await buildAdminWorld(pool);
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

const REASON = 'आधिकारिक सूची के अनुसार सुधार';
const booth = async (id: number) => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_hindi, ps_ward_id, zp_ward_id, registered_voters_male AS m, registered_voters_female AS f, registered_voters_total AS t FROM booth WHERE id = ?',
    [id],
  );
  return rows[0];
};
const update = (id: number, body: Record<string, unknown>) =>
  dm.post(`/api/admin/booths/${id}`, { reason: REASON, password: PASSWORD, ...body });

describe('DM booth and ward updates', () => {
  it('search shows voters (other = total − male − female) and what may change', async () => {
    const res = await dm.get(`/api/admin/booths?psId=${w.ps1}&wardNo=5`);
    expect((res.body as { booths: unknown[] }).booths).toEqual([
      {
        id: w.b7,
        boothNo: 7,
        nameHindi: 'बूथ सात',
        psWard: { id: w.psW5, wardNo: 5 },
        zpWard: { id: w.zW2, wardNo: 2 },
        voters: { male: 400, female: 350, other: 10, total: 760 },
        hasEntry: false,
        canEditName: true,
        canMove: true,
        canEditVoters: true,
      },
    ]);
  });

  it('name and voters: total recomputed on the server; audited with old and new values', async () => {
    const res = await update(w.b7, {
      nameHindi: 'राजकीय विद्यालय',
      votersMale: 500,
      votersFemale: 450,
      votersOther: 3,
    });
    expect(res.status).toBe(200);
    expect(await booth(w.b7)).toMatchObject({
      name_hindi: 'राजकीय विद्यालय',
      m: 500,
      f: 450,
      t: 953,
    });
    const [audit] = await auditOf(pool, 'BOOTH_UPDATED');
    expect(audit?.old_value).toEqual({
      name_hindi: 'बूथ सात',
      male: 400,
      female: 350,
      other: 10,
      total: 760,
    });
    expect(audit?.reason).toBe(REASON);
    // Not Hindi -> refused.
    expect(
      (await update(w.b7, { nameHindi: 'School', votersMale: 1, votersFemale: 1, votersOther: 0 }))
        .body,
    ).toEqual({
      error: 'BOOTH_NAME_INVALID',
    });
    // A short reason -> refused by validation.
    expect(
      (
        await dm.post(`/api/admin/booths/${w.b7}`, {
          nameHindi: 'राम',
          votersMale: 1,
          votersFemale: 1,
          votersOther: 0,
          reason: 'x',
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
  });

  it('locked ward: the name is frozen, voters still change until the booth has an entry', async () => {
    // b1 is in psW1 (locked) and zW1 (locked).
    const name = await update(w.b1, {
      nameHindi: 'नया नाम',
      votersMale: 0,
      votersFemale: 0,
      votersOther: 1000,
    });
    expect(name.body).toEqual({ error: 'BALLOT_LOCKED' });
    const voters = await update(w.b1, {
      nameHindi: 'बूथ 1',
      votersMale: 500,
      votersFemale: 490,
      votersOther: 0,
    });
    expect(voters.status).toBe(200);
    expect((await booth(w.b1))?.t).toBe(990);

    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post('/api/counting/entries', psW1Sheet(w, w.b1, 10, 10, 1))).status).toBe(
      201,
    );
    const before = await masterSnapshot(pool);
    const after = await update(w.b1, {
      nameHindi: 'बूथ 1',
      votersMale: 600,
      votersFemale: 490,
      votersOther: 0,
    });
    expect(after.body).toEqual({ error: 'COUNTING_STARTED' });
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('move: allowed between open wards; refused into a locked ward or for a booth with an entry', async () => {
    const into = await dm.post(`/api/admin/booths/${w.b7}/move`, {
      psWardId: w.psW1, // locked
      zpWardId: w.zW2,
      reason: REASON,
      password: PASSWORD,
    });
    expect(into.body).toEqual({ error: 'BALLOT_LOCKED' });
    const otherPs = await dm.post(`/api/admin/booths/${w.b7}/move`, {
      psWardId: w.psW2, // ward of another PS
      zpWardId: w.zW2,
      reason: REASON,
      password: PASSWORD,
    });
    expect(otherPs.body).toEqual({ error: 'WARD_NOT_ALLOWED' });

    const ok = await dm.post(`/api/admin/booths/${w.b7}/move`, {
      psWardId: w.psW4,
      zpWardId: w.zW2,
      reason: REASON,
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect(await booth(w.b7)).toMatchObject({ ps_ward_id: w.psW4, zp_ward_id: w.zW2 });
    const [audit] = await auditOf(pool, 'BOOTH_MOVED');
    expect(audit?.old_value).toMatchObject({ ps_ward_id: w.psW5, ps_ward_no: 5 });
    expect(audit?.new_value).toMatchObject({ ps_ward_id: w.psW4, ps_ward_no: 4 });

    // b1 has an entry (and locked wards): never moved.
    const ro = await apiClient(app, 'ro_ps1_x1');
    await ro.post('/api/counting/entries', psW1Sheet(w, w.b1, 1, 1, 1));
    const refused = await dm.post(`/api/admin/booths/${w.b1}/move`, {
      psWardId: w.psW4,
      zpWardId: w.zW1,
      reason: REASON,
      password: PASSWORD,
    });
    expect(refused.body).toEqual({ error: 'COUNTING_STARTED' });
  });

  it('ward reservation category: open wards only; wrong password writes nothing', async () => {
    const before = await masterSnapshot(pool);
    const wrong = await dm.post(`/api/admin/wards/${w.psW5}/category`, {
      category: 'अनुसूचित जाति',
      reason: REASON,
      password: 'wrong',
    });
    expect(wrong.body).toEqual({ error: 'REAUTH_FAILED' });
    const snapshot = JSON.parse(await masterSnapshot(pool)) as unknown[];
    expect(snapshot.slice(0, 4)).toEqual((JSON.parse(before) as unknown[]).slice(0, 4));

    const ok = await dm.post(`/api/admin/wards/${w.psW5}/category`, {
      category: 'अनुसूचित जाति',
      reason: REASON,
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT reservation_category FROM ward WHERE id = ?',
      [w.psW5],
    );
    expect(rows[0]?.reservation_category).toBe('अनुसूचित जाति');
    expect((await auditOf(pool, 'WARD_CATEGORY_UPDATED')).length).toBe(1);

    const locked = await dm.post(`/api/admin/wards/${w.psW1}/category`, {
      category: 'सामान्य',
      reason: REASON,
      password: PASSWORD,
    });
    expect(locked.body).toEqual({ error: 'BALLOT_LOCKED' });
  });
});

describe('close contests "अंतर %"', () => {
  it('2 decimals below 1%, "<0.01%" for tiny margins, never "0%" for a non-zero margin', () => {
    expect(formatMarginPercent(0, 1000)).toBe('0%');
    expect(formatMarginPercent(3, 10_000)).toBe('0.03%');
    expect(formatMarginPercent(1, 1_000_000)).toBe('<0.01%');
    expect(formatMarginPercent(1, 10_000)).toBe('0.01%');
    expect(formatMarginPercent(55, 10_000)).toBe('0.55%');
    expect(formatMarginPercent(101, 10_100)).toBe('1.0%');
    expect(formatMarginPercent(123, 10_000)).toBe('1.2%');
    expect(formatMarginPercent(5, 0)).toBe('0%');
    for (let margin = 1; margin < 200; margin += 7)
      expect(formatMarginPercent(margin, 9_999_999)).not.toBe('0%');
  });
});
