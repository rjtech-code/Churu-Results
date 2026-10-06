import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runDemoReset } from '../../scripts/demo-reset.js';
import { runDemoSeed } from '../../scripts/demo-seed.js';
import { assertDemoEnvironment } from '../../scripts/lib/demo-guard.js';
import { testEnv } from '../helpers/db.js';
import { auditCount, closeHarness, count, createHarness, makeCtx, resetDb } from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  h = await createHarness();
  await resetDb(h);
});
afterAll(async () => {
  await closeHarness(h);
});
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('demo guard', () => {
  it('accepts only non-production and *_dev database names', () => {
    expect(() => {
      assertDemoEnvironment({ nodeEnv: 'development', dbName: 'churu_dev' });
    }).not.toThrow();
    for (const dbName of ['churu_test', 'churu', 'churu_dev_backup', 'dev', undefined]) {
      expect(() => {
        assertDemoEnvironment({ nodeEnv: 'development', dbName });
      }, String(dbName)).toThrow(/_dev/);
    }
    expect(() => {
      assertDemoEnvironment({ nodeEnv: 'production', dbName: 'churu_dev' });
    }).toThrow(/production/);
  });
});

describe('demo:seed', () => {
  it('refuses on a database whose name does not end in _dev (here: churu_test) and writes nothing', async () => {
    const { ctx, output } = makeCtx(h);
    const result = await runDemoSeed({ commit: true }, ctx);
    expect(result.ok).toBe(false);
    expect(output.join('\n')).toContain('only run on a database whose name ends in _dev');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM ward')).toBe(0);
    expect(await auditCount(h)).toBe(0);
  });

  it('refuses in production', async () => {
    process.env.NODE_ENV = 'production';
    const { ctx, output } = makeCtx(h);
    expect((await runDemoSeed({ commit: true }, ctx)).ok).toBe(false);
    expect(output.join('\n')).toContain('NODE_ENV=production');
  });
});

describe('demo:reset (never connects in these tests)', () => {
  // A wrong password: even a bug that connected could not change anything.
  const env = { ...testEnv, DB_MIGRATION_PASSWORD: 'deliberately-wrong-password' };

  it('refuses without typing RESET', async () => {
    const lines: string[] = [];
    const result = await runDemoReset(
      { commit: true },
      {
        env: { ...env, DB_NAME: 'churu_dev' },
        nodeEnv: 'development',
        out: (l) => lines.push(l),
        confirm: () => Promise.resolve('reset'),
      },
    );
    expect(result).toEqual({ ok: false, wiped: false });
    expect(lines.join('\n')).toContain('Not confirmed (you did not type RESET)');
  });

  it('refuses a non-_dev database and production before asking or connecting', async () => {
    const asked: string[] = [];
    const deps = (dbName: string, nodeEnv: string) => ({
      env: { ...env, DB_NAME: dbName },
      nodeEnv,
      out: () => undefined,
      confirm: (q: string) => {
        asked.push(q);
        return Promise.resolve('RESET');
      },
    });
    expect(
      await runDemoReset({ commit: true, yes: true }, deps(testEnv.TEST_DB, 'development')),
    ).toEqual({ ok: false, wiped: false });
    expect(await runDemoReset({ commit: true }, deps('churu_dev', 'production'))).toEqual({
      ok: false,
      wiped: false,
    });
    expect(asked).toEqual([]);
  });
});
