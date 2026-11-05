// Writes the Part 13 e2e fixture files (test data only, never real data):
//   npx tsx tests/e2e-support/make-xlsx.ts <dir>
// -> <dir>/parties.xlsx (one new party), <dir>/candidates.xlsx (Bidasar wards 1 and 2) and
//    <dir>/ro-bulk.xlsx (a new RO for Taranagar, see ro-bulk-ps.ts; Sardarshahar, Churu and ZP
//    already have one: skipped).
import { join } from 'node:path';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
} from '../../src/services/master-data/candidates.js';
import { PARTY_COLUMNS } from '../../src/services/master-data/parties.js';
import { RO_BULK_COLUMNS } from '../../src/services/master-data/ro-bulk.js';
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
await writeSheet(join(dir, 'ro-bulk.xlsx'), [
  {
    name: 'ro_list',
    headers: RO_BULK_COLUMNS,
    rows: [
      ['PS', 'Taranagar', 'तारानगर ई2ई अधिकारी', '9829011111'],
      ['PS', 'Sardarshahar', 'सरदारशहर ई2ई अधिकारी', '9829044444'],
      ['PS', 'चूरू', 'चूरू ई2ई अधिकारी', '9829022222'],
      ['ZP', null, 'ज़िला ई2ई अधिकारी', '9829033333'],
    ],
  },
]);
console.log(`wrote ${dir}/parties.xlsx, ${dir}/candidates.xlsx and ${dir}/ro-bulk.xlsx`);
