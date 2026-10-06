import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actorsFor } from '../../scripts/demo-simulate.js';
import { testEnv } from '../helpers/db.js';

const backendDir = resolve(import.meta.dirname, '..', '..');

/** Runs the real CLI; the guard must stop it before any connection or HTTP request. */
function run(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((done) => {
    execFile(
      join(backendDir, 'node_modules', '.bin', 'tsx'),
      [join('scripts', 'demo-simulate.ts'), '--yes', '--speed', 'fast'],
      {
        cwd: backendDir,
        env: { ...process.env, ...env, DEMO_API_URL: 'http://127.0.0.1:9' },
        timeout: 30_000,
      },
      (err, _out, stderr) => {
        done({ code: err === null ? 0 : typeof err.code === 'number' ? err.code : -1, stderr });
      },
    );
  });
}

describe('demo:simulate guards (it never runs against the test database)', () => {
  it('refuses a database that does not end in _dev', async () => {
    const res = await run({ DB_NAME: testEnv.TEST_DB, NODE_ENV: 'development' });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('only run on a database whose name ends in _dev');
  });

  it('refuses in production', async () => {
    const res = await run({ DB_NAME: 'churu_dev', NODE_ENV: 'production' });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('NODE_ENV=production');
  });

  it('chooses the demo accounts from the options', () => {
    expect(actorsFor({})).toEqual(['CHURU', 'RAJGARH']);
    expect(actorsFor({ ps: 'CHURU' })).toEqual(['CHURU']);
    expect(actorsFor({ zp: true })).toEqual(['ZP']);
    expect(actorsFor({ ps: 'all-demo', zp: true })).toEqual(['CHURU', 'RAJGARH', 'ZP']);
  });
});
