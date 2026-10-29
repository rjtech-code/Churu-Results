// npm run users:reset-password -- --username <u> [--commit]
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runUsersResetPassword } from '../src/services/setup/users-reset-password.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';

export * from '../src/services/setup/users-reset-password.js';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { username: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run users:reset-password -- --username <u> [--commit]',
  );
  return runUsersResetPassword(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
