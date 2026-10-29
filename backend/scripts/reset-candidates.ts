// npm run reset-candidates -- --backup-file <path> [--max-backup-age-hours 24] [--commit] [--yes-this-is-dummy-data]
//
// Removes every candidate and all counting data that hangs off candidates (booth/postal entries and
// their votes), and resets the ward lock and "list ready" fields, so a fresh candidate list can be
// imported. Everything else is kept and verified unchanged: users, parties, geography, booths and
// voter counts, settings, the audit log (one CANDIDATES_RESET row is added).
//
// Refuses when ward_declarations or voided_entry has any row: those tables are append-only and can
// never be emptied by a script (use the full database reset procedure instead).
// Dry run by default. With NODE_ENV=production it also needs --yes-this-is-dummy-data.
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runResetCandidates } from '../src/services/setup/reset-candidates.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { resolveUserPath } from './lib/paths.js';

export * from '../src/services/setup/reset-candidates.js';

const USAGE =
  'npm run reset-candidates -- --backup-file <path> [--max-backup-age-hours 24] [--commit] [--yes-this-is-dummy-data]';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    {
      'backup-file': { type: 'string' },
      'max-backup-age-hours': { type: 'string' },
      commit: { type: 'boolean' },
      'yes-this-is-dummy-data': { type: 'boolean' },
    },
    USAGE,
  );
  const maxAge = values['max-backup-age-hours'];
  return runResetCandidates(
    {
      backupFile:
        values['backup-file'] === undefined ? undefined : resolveUserPath(values['backup-file']),
      maxBackupAgeHours: maxAge === undefined ? undefined : Number(maxAge),
      commit: values.commit,
      yesDummyData: values['yes-this-is-dummy-data'],
      nodeEnv: process.env.NODE_ENV,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
