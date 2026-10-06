import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appConfigFromEnv } from '../../src/config/app-config.js';
import { appEnvSchema, parseEnv } from '../../src/config/env.js';
import { announceVoterCheckConfig } from '../../src/config/startup-checks.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { testAppConfig } from '../auth/helpers.js';
import { buildWorld, clientFor, count, countingApp, psW1Sheet } from './helpers.js';
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
  APP_ORIGIN: 'https://results.example.in',
};

function configFrom(env: Record<string, string>) {
  const parsed = parseEnv(appEnvSchema, env);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return appConfigFromEnv(parsed.env);
}

describe('REQUIRE_VOTER_COUNTS', () => {
  it('defaults to true in production and false elsewhere; can be set explicitly; rejects other values', () => {
    expect(configFrom(ENV).requireVoterCounts).toBe(true);
    expect(configFrom({ ...ENV, NODE_ENV: 'development' }).requireVoterCounts).toBe(false);
    expect(configFrom({ ...ENV, REQUIRE_VOTER_COUNTS: 'false' }).requireVoterCounts).toBe(false);
    expect(
      configFrom({ ...ENV, NODE_ENV: 'development', REQUIRE_VOTER_COUNTS: 'true' })
        .requireVoterCounts,
    ).toBe(true);
    const bad = parseEnv(appEnvSchema, { ...ENV, REQUIRE_VOTER_COUNTS: 'yes' });
    expect(bad.ok).toBe(false);
  });

  it('true: a booth without a voter count cannot be entered (409 VOTER_COUNT_MISSING)', async () => {
    const ro = await clientFor(countingApp(pool, { requireVoterCounts: true }), 'ro_ps1_x1');
    const res = await ro.post('/entries', psW1Sheet(w, w.b4));
    expect([res.status, res.body]).toEqual([409, { error: 'VOTER_COUNT_MISSING' }]);
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry')).toBe(0);
    // Booths WITH a count are unaffected.
    expect((await ro.post('/entries', psW1Sheet(w, w.b1))).status).toBe(201);
  });

  it('false: the entry is saved with a VOTER_COUNT_MISSING warning (create, preview and update)', async () => {
    const ro = await clientFor(countingApp(pool, { requireVoterCounts: false }), 'ro_ps1_x1');
    expect((await ro.post('/entries/preview', psW1Sheet(w, w.b4))).body).toMatchObject({
      warnings: ['VOTER_COUNT_MISSING'],
    });
    const res = await ro.post('/entries', psW1Sheet(w, w.b4, 5000, 5000, 1)); // no limit to check against
    expect(res.status).toBe(201);
    expect((res.body as { warnings: string[] }).warnings).toEqual(['VOTER_COUNT_MISSING']);
    const id = (res.body as { entry: { id: number } }).entry.id;
    const { votes, sheetTotal } = psW1Sheet(w, w.b4, 1, 1, 1);
    const upd = await ro.put(`/entries/${id}`, {
      rowVersion: 1,
      roundNo: 1,
      sheetTotal,
      votes,
      reason: 'Recount on the sheet',
    });
    expect((upd.body as { warnings: string[] }).warnings).toEqual(['VOTER_COUNT_MISSING']);
    // A booth with a count gives no warning.
    expect(
      ((await ro.post('/entries', psW1Sheet(w, w.b1))).body as { warnings: string[] }).warnings,
    ).toEqual([]);
  });

  it('production with the check disabled: loud warning + one CONFIG_VOTER_CHECK_DISABLED audit row', async () => {
    const lines: string[] = [];
    const raised = await announceVoterCheckConfig(
      pool,
      testAppConfig({ production: true, requireVoterCounts: false }),
      (l) => lines.push(l),
    );
    expect(raised).toBe(true);
    expect(lines.join('\n')).toContain('WARNING: REQUIRE_VOTER_COUNTS=false in PRODUCTION.');
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT user_id, action, new_value FROM audit_log WHERE action = 'CONFIG_VOTER_CHECK_DISABLED'",
    );
    expect(rows).toEqual([
      {
        user_id: null,
        action: 'CONFIG_VOTER_CHECK_DISABLED',
        new_value: { REQUIRE_VOTER_COUNTS: false, NODE_ENV: 'production' },
      },
    ]);
  });

  it('no warning and no audit row when the check is on, or outside production', async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(
      await announceVoterCheckConfig(
        pool,
        testAppConfig({ production: true, requireVoterCounts: true }),
        log,
      ),
    ).toBe(false);
    expect(
      await announceVoterCheckConfig(
        pool,
        testAppConfig({ production: false, requireVoterCounts: false }),
        log,
      ),
    ).toBe(false);
    expect(lines).toEqual([]);
    expect(
      await count(
        pool,
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'CONFIG_VOTER_CHECK_DISABLED'",
      ),
    ).toBe(0);
  });
});
