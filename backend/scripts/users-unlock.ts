// npm run users:unlock -- --username <u> --by "<name>" [--commit]
// Clears a login lockout (locked_until and failed_login_count). Does not change the password.
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runUsersUnlock } from '../src/services/setup/users-unlock.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';

export * from '../src/services/setup/users-unlock.js';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { username: { type: 'string' }, by: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run users:unlock -- --username <u> --by "<name>" [--commit]',
  );
  return runUsersUnlock(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
