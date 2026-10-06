import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { createPool } from '../../src/config/db.js';
import { loadEnvOrExit } from '../../src/config/env.js';
import { ScriptError } from './db.js';
import { scriptEnvSchema } from './env.js';
import { DEFAULT_REPORTS_DIR } from './paths.js';
import type { ScriptContext } from './run.js';

/** Wrong or missing command-line arguments (exit code 2). */
export class UsageError extends Error {}

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(resolve(entry)).href;
}

type Options = NonNullable<ParseArgsConfig['options']>;

/** util.parseArgs in strict mode; unknown flags become a UsageError with the usage text. */
export function parseCli<T extends Options>(
  argv: string[],
  options: T,
  usage: string,
  allowPositionals = false,
) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals });
  } catch (err) {
    throw new UsageError(`${err instanceof Error ? err.message : String(err)}\n\nUsage: ${usage}`);
  }
}

async function askOnTerminal(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Standard entry point: validates env, opens the APP-user pool, runs the script and exits with
 * 0 (success), 1 (validation/data errors) or 2 (bad command-line usage).
 */
export async function runCli(
  main: (argv: string[], ctx: ScriptContext) => Promise<{ ok: boolean }>,
): Promise<void> {
  const env = loadEnvOrExit(scriptEnvSchema);
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_APP_USER,
    password: env.DB_APP_PASSWORD,
  });
  const ctx: ScriptContext = {
    pool,
    reportsDir: DEFAULT_REPORTS_DIR,
    out: (text) => {
      console.log(text);
    },
    confirm: askOnTerminal,
    now: () => new Date(),
  };

  let code = 1;
  try {
    const result = await main(process.argv.slice(2), ctx);
    code = result.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      code = 2;
    } else if (err instanceof ScriptError) {
      console.error(`ERROR: ${err.message}`);
    } else {
      console.error('Unexpected error:', err);
    }
  } finally {
    await pool.end();
  }
  process.exitCode = code;
}
