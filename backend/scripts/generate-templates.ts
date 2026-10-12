// npm run templates:generate — writes the empty import templates under docs/templates/.
// No database access. (The voter-count template needs booths: npm run export:voter-template.)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { templateSheets } from '../src/services/master-data/templates.js';
import { isMainModule } from './lib/cli.js';
import { TEMPLATES_DIR } from './lib/paths.js';
import { writeSheet } from './lib/xlsx.js';

export async function generateTemplates(dir = TEMPLATES_DIR): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const parties = join(dir, 'parties-template.xlsx');
  await writeSheet(parties, templateSheets('parties'));
  const candidates = join(dir, 'candidates-template.xlsx');
  await writeSheet(candidates, templateSheets('candidates'));
  return [parties, candidates];
}

if (isMainModule(import.meta.url)) {
  for (const file of await generateTemplates()) console.log(`Wrote ${file}`);
}
