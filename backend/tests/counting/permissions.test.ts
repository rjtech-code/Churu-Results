import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, count, countingApp, psW1Sheet, v, zW1Sheet } from './helpers.js';
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

const FORBIDDEN = { error: 'FORBIDDEN' };
const entries = () => count(pool, 'SELECT COUNT(*) AS n FROM booth_entry');

describe('counting permissions', () => {
  it('PS_RO on a booth of another PS -> 403', async () => {
    const ro2 = await clientFor(countingApp(pool), 'ro_ps2_x2');
    const res = await ro2.post('/entries', psW1Sheet(w, w.b1));
    expect([res.status, res.body]).toEqual([403, FORBIDDEN]);
    expect((await ro2.post('/entries/preview', psW1Sheet(w, w.b1))).status).toBe(403);
    expect(await entries()).toBe(0);
  });

  it('PS_RO on a ZP ballot -> 403', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await ro.post('/entries', zW1Sheet(w, w.b1))).status).toBe(403);
    expect(
      (
        await ro.post(`/wards/${w.zW1}/postal`, {
          sheetTotal: 0,
          votes: v([
            [w.c.E, 0],
            [w.c.F, 0],
            [w.c.N3, 0],
          ]),
        })
      ).status,
    ).toBe(403);
  });

  it('ZP_RO on a PS ballot -> 403', async () => {
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    expect((await zp.post('/entries', psW1Sheet(w, w.b1))).status).toBe(403);
    expect(
      (
        await zp.post(`/wards/${w.psW1}/postal`, {
          sheetTotal: 0,
          votes: v([
            [w.c.A, 0],
            [w.c.B, 0],
            [w.c.N1, 0],
          ]),
        })
      ).status,
    ).toBe(403);
  });

  it('PS_RO cannot update, void or read another PS_RO entry', async () => {
    const app = countingApp(pool);
    const ro1 = await clientFor(app, 'ro_ps1_x1');
    const id = ((await ro1.post('/entries', psW1Sheet(w, w.b1))).body as { entry: { id: number } })
      .entry.id;
    const ro2 = await clientFor(app, 'ro_ps2_x2');
    const zp = await clientFor(app, 'zp_ro_x3');
    for (const client of [ro2, zp]) {
      expect(
        (
          await client.put(`/entries/${id}`, {
            rowVersion: 1,
            ...psW1Sheet(w, w.b1, 1, 1, 1),
            wardId: undefined,
            boothId: undefined,
            ballotFor: undefined,
            reason: 'Trying someone else entry',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/entries/${id}/void`, {
            rowVersion: 1,
            reason: 'Trying someone else entry',
          })
        ).status,
      ).toBe(403);
      expect((await client.get(`/entries/${id}`)).status).toBe(403);
      expect((await client.get(`/entries/${id}/history`)).status).toBe(403);
    }
  });

  it('DM gets 403 on every counting route, reads included', async () => {
    const dm = await clientFor(countingApp(pool), 'dm_x4');
    expect((await dm.post('/entries', psW1Sheet(w, w.b1))).body).toEqual(FORBIDDEN);
    expect((await dm.post('/entries/preview', psW1Sheet(w, w.b1))).status).toBe(403);
    expect((await dm.get('/wards')).body).toEqual(FORBIDDEN);
    expect((await dm.get(`/wards/${w.psW1}/booths`)).status).toBe(403);
    expect((await dm.get(`/wards/${w.psW1}/ballot`)).status).toBe(403);
  });

  it('not logged in -> 401; missing CSRF token -> 403', async () => {
    const app = countingApp(pool);
    expect((await request(app).get('/api/counting/wards')).status).toBe(401);
    const ro = await clientFor(app, 'ro_ps1_x1');
    const noToken = await ro.agent.post('/api/counting/entries').send(psW1Sheet(w, w.b1));
    expect([noToken.status, noToken.body]).toEqual([403, { error: 'CSRF_FAILED' }]);
    expect(await entries()).toBe(0);
  });
});
