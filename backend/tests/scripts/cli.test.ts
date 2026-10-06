import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testEnv } from '../helpers/db.js';

const backendDir = resolve(import.meta.dirname, '..', '..');
const tsx = join(backendDir, 'node_modules', '.bin', 'tsx');

/** Runs a script exactly like `npm run`, but always against the TEST database. */
function runScript(
  script: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      tsx,
      [join('scripts', script), ...args],
      { cwd: backendDir, env: { ...process.env, DB_NAME: testEnv.TEST_DB }, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err === null ? 0 : typeof err.code === 'number' ? err.code : -1;
        done({ code, stdout, stderr });
      },
    );
  });
}

describe('command-line wrappers', () => {
  it('exit code 0 on success (users:list)', async () => {
    const { code, stdout } = await runScript('users-list.ts', []);
    expect(code).toBe(0);
    expect(stdout).toContain('RESULT: OK');
  });

  it('exit code 1 on a validation error (missing --file)', async () => {
    const { code, stdout } = await runScript('import-geography.ts', []);
    expect(code).toBe(1);
    expect(stdout).toContain('--file <xlsx> is required.');
  });

  it('exit code 2 on an unknown flag, with usage', async () => {
    const { code, stderr } = await runScript('import-parties.ts', ['--file', 'x.xlsx', '--comit']);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage: npm run import:parties');
  });
});
