// npm run import:voters -- --file <xlsx> [--commit]
// Two file formats:
//  - template: one row per booth (panchayat_samiti, booth_no, voters_male/female/other/total);
//  - polling-station workbook (Part 14): sheet "Sheet1_withvoters", several rows per booth;
//    registered voters = SUM(Total_Elector) per (PanchayatSamiti, PollingStationNumber). Male and
//    female are not in that file and are stored as NULL. Cross-checked against SUM(Sheet3.Voters).
// The work itself lives in src/services/setup (shared with the Super Admin panel).
import { runImportVoters } from '../src/services/setup/voters.js';
import type { ScriptContext } from '../src/services/setup/run.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { resolveUserPath } from './lib/paths.js';

export * from '../src/services/setup/voters.js';

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run import:voters -- --file <xlsx> [--commit]',
  );
  return runImportVoters(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
