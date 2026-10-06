import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appEnvSchema, parseEnv } from '../src/config/env.js';

const VALID = {
  NODE_ENV: 'test',
  PORT: '3000',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'churu_dev',
  DB_APP_USER: 'churu_app',
  DB_APP_PASSWORD: 'Sup3rSecretValue!!',
  SESSION_SECRET: 'a-test-session-secret-of-at-least-32-chars',
  APP_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('accepts a complete, valid environment', () => {
    const result = parseEnv(appEnvSchema, VALID);
    expect(result).toMatchObject({ ok: true, env: { PORT: 3000, DB_PORT: 3307 } });
  });

  it('names missing variables', () => {
    const { DB_APP_PASSWORD: _omit, ...rest } = VALID;
    expect(parseEnv(appEnvSchema, rest)).toEqual({
      ok: false,
      problems: ['DB_APP_PASSWORD is missing'],
    });
    expect(parseEnv(appEnvSchema, { ...VALID, DB_APP_PASSWORD: '' })).toEqual({
      ok: false,
      problems: ['DB_APP_PASSWORD is missing'],
    });
  });

  it('names invalid variables without printing their values', () => {
    const result = parseEnv(appEnvSchema, {
      ...VALID,
      PORT: 'not-a-port',
      DB_APP_PASSWORD: 'shortpw',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.problems.join('\n');
    expect(text).toMatch(/^DB_APP_PASSWORD is invalid/m);
    expect(text).toMatch(/^PORT is invalid/m);
    expect(text).not.toContain('not-a-port');
    expect(text).not.toContain('shortpw');
  });
});

describe('case 14: app startup', () => {
  it('fails with a clear message when a required variable is missing', async () => {
    const backendDir = resolve(import.meta.dirname, '..');
    const tsxBin = join(backendDir, 'node_modules', '.bin', 'tsx');
    const serverTs = join(backendDir, 'src', 'server.ts');
    // Run from an empty temp dir so no backend/.env is picked up by dotenv.
    const cwd = await mkdtemp(join(tmpdir(), 'churu-env-'));
    const { DB_APP_PASSWORD: _omit, ...withoutPassword } = VALID;
    const env = {
      PATH: process.env.PATH ?? '',
      ...withoutPassword,
      DB_NAME: 'Bad-Name-SENTINEL',
    };

    try {
      const outcome = await new Promise<{ code: number | null; stderr: string }>((done) => {
        execFile(tsxBin, [serverTs], { cwd, env, timeout: 20_000 }, (err, _stdout, stderr) => {
          const code = err && typeof err.code === 'number' ? err.code : err ? null : 0;
          done({ code, stderr });
        });
      });
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain('Configuration error');
      expect(outcome.stderr).toContain('DB_APP_PASSWORD is missing');
      expect(outcome.stderr).toContain('DB_NAME is invalid');
      expect(outcome.stderr).not.toContain('SENTINEL');
      expect(outcome.stderr).not.toContain(VALID.DB_APP_PASSWORD);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
