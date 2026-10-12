// Writes the Part 13 e2e fixture files (test data only, never real data):
//   npx tsx tests/e2e-support/make-xlsx.ts <dir>
// -> <dir>/parties.xlsx (one new party) and <dir>/candidates.xlsx (Bidasar wards 1 and 2).
import { join } from 'node:path';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
} from '../../src/services/master-data/candidates.js';
import { PARTY_COLUMNS } from '../../src/services/master-data/parties.js';
import { writeSheet } from '../../src/services/master-data/xlsx.js';

const dir = process.argv[2];
if (dir === undefined) throw new Error('usage: tsx tests/e2e-support/make-xlsx.ts <dir>');

await writeSheet(join(dir, 'parties.xlsx'), [
  {
    name: 'parties',
    headers: PARTY_COLUMNS,
    rows: [['ई2ई जन पार्टी', 'E2E Jan Party', 'E2EJP', 'Kite']],
  },
]);
const PS = 'BIDASAR PANCHAYAT SAMITI';
await writeSheet(join(dir, 'candidates.xlsx'), [
  {
    name: 'candidates',
    headers: [...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS],
    rows: [
      [PS, 'PS', 1, 1, 'राधा कुमारी', 'E2EJP', 'F', 'सामान्य महिला'],
      [PS, 'PS', 1, 2, 'सीता', null, 'F', 'सामान्य महिला'],
      [PS, 'PS', 2, 1, 'मोहन लाल', 'E2EJP', 'M', 'सामान्य'],
      [PS, 'PS', 2, 2, 'श्याम सुंदर', null, 'M', 'सामान्य'],
    ],
  },
]);
console.log(`wrote ${dir}/parties.xlsx and ${dir}/candidates.xlsx`);
