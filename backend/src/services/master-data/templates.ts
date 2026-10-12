// The empty import templates, shared by `npm run templates:generate` and the DM's download links.
import { CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS } from './candidates.js';
import { PARTY_COLUMNS } from './parties.js';
import type { SheetSpec } from './xlsx.js';

export type TemplateName = 'parties' | 'candidates';
export const TEMPLATE_NAMES: readonly TemplateName[] = ['parties', 'candidates'];

export function templateSheets(name: TemplateName): SheetSpec[] {
  if (name === 'parties') return [{ name: 'parties', headers: PARTY_COLUMNS, rows: [] }];
  // EXAMPLE rows show the format; the importer rejects any row containing "EXAMPLE".
  return [
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
  ];
}
