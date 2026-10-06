import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, count } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import {
  appFor,
  confirmBody,
  declareClient,
  fillPsW1,
  PASSWORD,
  previewResult,
} from './helpers.js';

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

describe('declare permissions', () => {
  it('only the RO of the ward may preview, declare, correct or read declarations', async () => {
    const app = appFor(pool);
    const ro1 = await declareClient(app, 'ro_ps1_x1');
    await fillPsW1(ro1, w);
    const body = confirmBody(await previewResult(ro1, w.psW1));

    for (const username of ['ro_ps2_x2', 'zp_ro_x3']) {
      const other = await declareClient(app, username);
      expect((await other.dpost(`/wards/${w.psW1}/preview`, {})).status, username).toBe(403);
      expect((await other.dpost(`/wards/${w.psW1}`, body)).body, username).toEqual({
        error: 'FORBIDDEN',
      });
      expect(
        (await other.dpost(`/wards/${w.psW1}/correction/preview`, { changes: [] })).status,
      ).toBe(400);
      expect((await other.dget(`/wards/${w.psW1}/declarations`)).status, username).toBe(403);
    }
    // PS_RO on a ZP ward.
    expect(
      (await ro1.dpost(`/wards/${w.zW1}`, { ...body, confirmWinnerCandidateId: w.c.E })).status,
    ).toBe(403);
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM ward_declarations')).toBe(0);
  });

  it('DM gets 403 on every declare route; logged out 401; missing CSRF 403', async () => {
    const app = appFor(pool);
    const dm = await declareClient(app, 'dm_x4');
    expect(
      (
        await dm.dpost(`/wards/${w.psW1}`, {
          password: PASSWORD,
          confirmWinnerCandidateId: w.c.A,
          confirmTotalValidVotes: 0,
        })
      ).body,
    ).toEqual({ error: 'FORBIDDEN' });
    expect((await dm.dget(`/wards/${w.psW1}/declarations`)).status).toBe(403);
    expect((await request(app).get(`/api/declare/wards/${w.psW1}/declarations`)).status).toBe(401);
    const ro = await declareClient(app, 'ro_ps1_x1');
    const noCsrf = await ro.agent.post(`/api/declare/wards/${w.psW1}/preview`).send({});
    expect([noCsrf.status, noCsrf.body]).toEqual([403, { error: 'CSRF_FAILED' }]);
  });

  it('unknown ward -> 404', async () => {
    const ro = await declareClient(appFor(pool), 'ro_ps1_x1');
    expect((await ro.dpost('/wards/999999/preview', {})).body).toEqual({ error: 'NOT_FOUND' });
  });
});
