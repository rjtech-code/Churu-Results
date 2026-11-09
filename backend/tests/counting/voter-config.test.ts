// Official order: the registered-voter count is no check on any entry (no refusal, no warning,
// no setting). The sheet's own check stays: candidates + NOTA must equal the typed sheet total.
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appConfigFromEnv } from '../../src/config/app-config.js';
import { appEnvSchema, parseEnv } from '../../src/config/env.js';
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

const ENV = {
  NODE_ENV: 'production',
  PORT: '3000',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'churu_dev',
  DB_APP_USER: 'churu_app',
  DB_APP_PASSWORD: 'Sup3rSecretValue!!',
  SESSION_SECRET: 'a-test-session-secret-of-at-least-32-chars',
  RO_PASSWORD_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  APP_ORIGIN: 'https://results.example.in',
};

function configFrom(env: Record<string, string>) {
  const parsed = parseEnv(appEnvSchema, env);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return appConfigFromEnv(parsed.env);
}

const REASON = 'पर्ची दोबारा जाँची, गलती सुधारी';

describe('no registered-voter checks', () => {
  it('an old .env that still has REQUIRE_VOTER_COUNTS starts fine (the key is ignored)', () => {
    for (const value of ['true', 'false', 'yes', '']) {
      const config = configFrom({ ...ENV, REQUIRE_VOTER_COUNTS: value });
      expect(config).not.toHaveProperty('requireVoterCounts');
    }
  });

  it('a booth without a voter count: preview, create and update are saved with no warning', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const preview = await ro.post('/entries/preview', psW1Sheet(w, w.b4));
    expect([preview.status, (preview.body as { warnings: unknown }).warnings]).toEqual([200, []]);
    const res = await ro.post('/entries', psW1Sheet(w, w.b4));
    expect([res.status, (res.body as { warnings: unknown }).warnings]).toEqual([201, []]);
    const id = (res.body as { entry: { id: number } }).entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b4, 1, 1, 1);
    const upd = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect([upd.status, (upd.body as { warnings: unknown }).warnings]).toEqual([200, []]);
  });

  it('more votes than registered voters (1000) are saved: PS and ZP booth, create and edit', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const ps = await ro.post('/entries', psW1Sheet(w, w.b1, 900, 900, 5)); // 1805 > 1000
    expect(ps.status).toBe(201);
    const zp = await ro.post('/entries', zW1Sheet(w, w.b1, 1500, 10, 0));
    expect(zp.status).toBe(201);
    const id = (ps.body as { entry: { id: number } }).entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b1, 2000, 900, 5);
    const upd = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: REASON,
    });
    expect(upd.status).toBe(200);
    expect(
      await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry WHERE sheet_total > 1000'),
    ).toBe(2);
  });

  it('the sheet total (कुल योग, पर्ची के अनुसार) must still match: SUM_MISMATCH, nothing saved', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const wrong = { ...psW1Sheet(w, w.b1, 900, 900, 5), sheetTotal: 1806 };
    for (const path of ['/entries/preview', '/entries']) {
      const res = await ro.post(path, wrong);
      expect([res.status, res.body]).toEqual([
        400,
        { error: 'SUM_MISMATCH', sum: 1805, sheetTotal: 1806 },
      ]);
    }
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry')).toBe(0);

    const ok = await ro.post('/entries', psW1Sheet(w, w.b1));
    const id = (ok.body as { entry: { id: number } }).entry.id;
    const badEdit = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal: 9,
      votes: v([
        [w.c.A, 1],
        [w.c.B, 1],
        [w.c.N1, 1],
      ]),
      reason: REASON,
    });
    expect((badEdit.body as { error: string }).error).toBe('SUM_MISMATCH');

    const badPostal = await ro.post(`/wards/${w.psW1}/postal`, {
      sheetTotal: 4,
      votes: v([
        [w.c.A, 1],
        [w.c.B, 1],
        [w.c.N1, 1],
      ]),
    });
    expect((badPostal.body as { error: string }).error).toBe('SUM_MISMATCH');
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM postal_entry')).toBe(0);
  });
});
