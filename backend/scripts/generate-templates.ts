// npm run templates:generate — writes the empty import templates under docs/templates/.
// No database access. (The voter-count template needs booths: npm run export:voter-template.)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS } from './import-candidates.js';
import { PARTY_COLUMNS } from './import-parties.js';
import { isMainModule } from './lib/cli.js';
import { TEMPLATES_DIR } from './lib/paths.js';
import { writeSheet } from './lib/xlsx.js';

export async function generateTemplates(dir = TEMPLATES_DIR): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const parties = join(dir, 'parties-template.xlsx');
  await writeSheet(parties, [{ name: 'parties', headers: PARTY_COLUMNS, rows: [] }]);

  // EXAMPLE rows show the format; the importer rejects any row containing "EXAMPLE".
  const candidates = join(dir, 'candidates-template.xlsx');
  await writeSheet(candidates, [
    {
      name: 'candidates',
      headers: [...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS],
      rows: [
        [
          'EXAMPLE - CHURU PANCHAYAT SAMITI',
          'PS',
          1,
          1,
          'EXAMPLE - उम्मीदवार का नाम',
          'EXAMPLE-PARTY',
          'F',
          'EXAMPLE - सामान्य महिला',
        ],
        [
          'EXAMPLE - (leave empty for ZP)',
          'ZP',
          1,
          1,
          'EXAMPLE - निर्दलीय उम्मीदवार',
          null,
          'M',
          'EXAMPLE - अन्य पिछड़ा वर्ग',
        ],
      ],
    },
  ]);
  return [parties, candidates];
}

if (isMainModule(import.meta.url)) {
  for (const file of await generateTemplates()) console.log(`Wrote ${file}`);
}
