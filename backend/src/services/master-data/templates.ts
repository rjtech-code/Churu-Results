// The empty import templates, shared by `npm run templates:generate` and the DM's download links.
import { CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS } from './candidates.js';
import { PARTY_COLUMNS } from './parties.js';
import type { SheetSpec } from './xlsx.js';

export type TemplateName = 'parties' | 'candidates';
export const TEMPLATE_NAMES: readonly TemplateName[] = ['parties', 'candidates'];

type CandidateColumn =
  (typeof CANDIDATE_COLUMNS)[number] | (typeof OPTIONAL_CANDIDATE_COLUMNS)[number];

/** The note row of the candidate sample: one short explanation per column (every column has one). */
export const CANDIDATE_COLUMN_NOTES: Readonly<Record<CandidateColumn, string>> = {
  panchayat_samiti: 'Panchayat Samiti का English name (ZP के लिए खाली)',
  election: 'PS या ZP',
  ward_no: 'Ward no.',
  ballot_position: 'Ballot position 1, 2, 3…',
  name_hindi: 'उम्मीदवार का नाम (Hindi)',
  party_short_name: 'Party short name; निर्दलीय = खाली',
  gender: 'M / F / O',
  reservation_category: 'Ward reservation (optional)',
  dob: 'DOB DD/MM/YYYY (optional)',
  age: 'Age, अगर DOB नहीं (optional)',
  education: 'Education (optional)',
  mobile: '10-digit mobile (optional)',
  candidate_category: 'GEN / SC / ST / OBC (optional)',
  address: 'Address (optional)',
  occupation: 'Occupation (optional)',
};

export function templateSheets(name: TemplateName): SheetSpec[] {
  if (name === 'parties') return [{ name: 'parties', headers: PARTY_COLUMNS, rows: [] }];
  // The note row and the EXAMPLE rows show the format; the importer rejects any row containing
  // "EXAMPLE", so they must be deleted before upload.
  const headers = [...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS];
  return [
    {
      name: 'candidates',
      headers,
      rows: [
        headers.map(
          (c, i) => `${i === 0 ? 'EXAMPLE note (यह row हटाएँ): ' : ''}${CANDIDATE_COLUMN_NOTES[c]}`,
        ),
        [
          'EXAMPLE - CHURU PANCHAYAT SAMITI',
          'PS',
          1,
          1,
          'EXAMPLE - उम्मीदवार का नाम',
          'EXAMPLE-PARTY',
          'F',
          'EXAMPLE - सामान्य महिला',
          // Optional details: dob (DD/MM/YYYY) or age, education (English or Hindi), mobile,
          // candidate_category (GEN/SC/ST/OBC or the Hindi name), address, occupation (free text).
          '15/05/1980',
          null,
          'स्नातक',
          '9876543210',
          'सामान्य',
          'EXAMPLE - ग्राम पोस्ट- साण्डन, तह.- सुजानगढ़, जिला- चूरू',
          'कृषि',
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
          null,
          45,
          'Secondary',
          null,
          'OBC',
          null,
          null,
        ],
      ],
    },
  ];
}
