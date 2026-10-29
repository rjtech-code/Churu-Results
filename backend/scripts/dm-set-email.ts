// npm run set-dm-email -- <email> [--commit]
// Sets the DM's email (OTP for the DM profile page goes there). Only the active DM account; the
// page itself can never change it. The audit row keeps the email masked.
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runSetDmEmail } from '../src/services/setup/dm-email.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { UsageError, isMainModule, parseCli, runCli } from './lib/cli.js';

export * from '../src/services/setup/dm-email.js';

const USAGE = 'npm run set-dm-email -- <email> [--commit]';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values, positionals } = parseCli(argv, { commit: { type: 'boolean' } }, USAGE, true);
  if (positionals.length > 1) {
    throw new UsageError(`Give exactly one email.\n\nUsage: ${USAGE}`);
  }
  return runSetDmEmail({ email: positionals[0], commit: values.commit }, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
