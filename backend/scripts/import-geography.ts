// npm run import:geography -- --file <xlsx> [--fixes <json>] [--ps-names <json>] [--replace] [--commit]
//
// Loads Panchayat Samitis, PS wards, ZP wards and booths from the polling-station Excel file.
// Each Excel ROW is a Gram Panchayat ward; several rows share one booth.
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runImportGeography } from '../src/services/setup/geography.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { resolveUserPath } from './lib/paths.js';

export * from '../src/services/setup/geography.js';

const USAGE =
  'npm run import:geography -- --file <xlsx> [--fixes <json>] [--ps-names <json>] [--replace] [--commit]';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    {
      file: { type: 'string' },
      fixes: { type: 'string' },
      'ps-names': { type: 'string' },
      replace: { type: 'boolean' },
      commit: { type: 'boolean' },
    },
    USAGE,
  );
  return runImportGeography(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      fixes: values.fixes === undefined ? undefined : resolveUserPath(values.fixes),
      psNames: values['ps-names'] === undefined ? undefined : resolveUserPath(values['ps-names']),
      replace: values.replace,
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
