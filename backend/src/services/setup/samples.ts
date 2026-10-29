// "नमूना फ़ाइल" (sample files) for every upload of the Super Admin panel, built from the SAME column
// lists the importers read (geography COLUMNS, VOTER_COLUMNS, FIX_KEYS, the candidate columns), so a
// sample can never drift from its importer. Excel samples: header row, one note row explaining each
// column, then example rows. Every note/example row contains "EXAMPLE" and fails the import on
// purpose, so a sample uploaded unchanged is refused rather than loaded.
import { templateSheets } from '../master-data/templates.js';
import { writeSheetToBuffer } from '../master-data/xlsx.js';
import type { Cell } from '../master-data/xlsx.js';
import { COLUMNS, FIX_FIELDS, FIX_KEYS } from './geography.js';
import { VOTER_COLUMNS, VOTER_OPTIONAL_COLUMNS } from './voters.js';

export const SAMPLE_NAMES = ['geography', 'fixes', 'ps-names', 'voters', 'candidates'] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

export interface SampleFile {
  fileName: string;
  contentType: string;
  data: Buffer;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NOTE_PREFIX = 'EXAMPLE note (यह row हटाएँ): ';

type GeoColumn = (typeof COLUMNS)[keyof typeof COLUMNS];
const GEOGRAPHY_NOTES: Readonly<Record<GeoColumn, string>> = {
  District: 'Churu',
  PanchayatSamiti: 'Panchayat Samiti का पूरा English name',
  Grampanchayat: 'Gram Panchayat name',
  WardNumber: 'GP ward no.',
  PollingStationNumber: 'Booth no. (हर PS में 1 से शुरू)',
  'Polling Station in Hindi': 'Booth name (Hindi)',
  'Polling Station in English': 'Booth name (English)',
  PanchayatSamitiConstituenyNumber: 'PS ward no.',
  ZillaParishadConstituencyNumber: 'ZP ward no.',
};
const GEOGRAPHY_EXAMPLES: Readonly<Record<GeoColumn, Cell>>[] = [
  {
    District: 'EXAMPLE Churu',
    PanchayatSamiti: 'CHURU PANCHAYAT SAMITI',
    Grampanchayat: 'EXAMPLE GP',
    WardNumber: 1,
    PollingStationNumber: 1,
    'Polling Station in Hindi': 'राजकीय विद्यालय, ग्राम उदाहरण',
    'Polling Station in English': 'Govt School, Example Village',
    PanchayatSamitiConstituenyNumber: 1,
    ZillaParishadConstituencyNumber: 1,
  },
  {
    District: 'EXAMPLE Churu',
    PanchayatSamiti: 'CHURU PANCHAYAT SAMITI',
    Grampanchayat: 'EXAMPLE GP',
    WardNumber: 2,
    PollingStationNumber: 1,
    'Polling Station in Hindi': 'राजकीय विद्यालय, ग्राम उदाहरण',
    'Polling Station in English': 'Govt School, Example Village',
    PanchayatSamitiConstituenyNumber: 1,
    ZillaParishadConstituencyNumber: 1,
  },
  {
    District: 'EXAMPLE Churu',
    PanchayatSamiti: 'CHURU PANCHAYAT SAMITI',
    Grampanchayat: 'EXAMPLE GP 2',
    WardNumber: 1,
    PollingStationNumber: 2,
    'Polling Station in Hindi': 'आंगनबाड़ी केंद्र, ग्राम उदाहरण',
    'Polling Station in English': 'Anganwadi Centre, Example Village',
    PanchayatSamitiConstituenyNumber: 2,
    ZillaParishadConstituencyNumber: 1,
  },
];

type VoterColumn = (typeof VOTER_COLUMNS)[number] | (typeof VOTER_OPTIONAL_COLUMNS)[number];
const VOTER_NOTES: Readonly<Record<VoterColumn, string>> = {
  panchayat_samiti: 'पंचायत समिति का पूरा अंग्रेज़ी नाम',
  booth_no: 'Booth no.',
  voters_male: 'Male voters',
  voters_female: 'Female voters',
  voters_total: 'Total = male + female + other',
  voters_other: 'Other voters (खाली = 0)',
};
const VOTER_EXAMPLES: Readonly<Record<VoterColumn, Cell>>[] = [
  {
    panchayat_samiti: 'EXAMPLE CHURU PANCHAYAT SAMITI',
    booth_no: 1,
    voters_male: 450,
    voters_female: 420,
    voters_total: 870,
    voters_other: 0,
  },
  {
    panchayat_samiti: 'EXAMPLE CHURU PANCHAYAT SAMITI',
    booth_no: 2,
    voters_male: 510,
    voters_female: 498,
    voters_total: 1009,
    voters_other: 1,
  },
];

/** Header row, note row, example rows: always in the importer's own column order. */
async function excelSample<C extends string>(
  sheet: string,
  columns: readonly C[],
  notes: Readonly<Record<C, string>>,
  examples: readonly Readonly<Record<C, Cell>>[],
): Promise<Buffer> {
  return writeSheetToBuffer([
    {
      name: sheet,
      headers: columns,
      rows: [
        columns.map((c, i) => `${i === 0 ? NOTE_PREFIX : ''}${notes[c]}`),
        ...examples.map((e) => columns.map((c) => e[c])),
      ],
    },
  ]);
}

function jsonFile(fileName: string, value: unknown): SampleFile {
  return {
    fileName,
    contentType: 'application/json',
    data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
  };
}

export async function sampleFile(name: SampleName): Promise<SampleFile> {
  switch (name) {
    case 'geography':
      return {
        fileName: 'geography-sample.xlsx',
        contentType: XLSX,
        data: await excelSample(
          'polling-stations',
          Object.values(COLUMNS),
          GEOGRAPHY_NOTES,
          GEOGRAPHY_EXAMPLES,
        ),
      };
    case 'voters':
      return {
        fileName: 'voters-sample.xlsx',
        contentType: XLSX,
        data: await excelSample(
          'voters',
          [...VOTER_COLUMNS, ...VOTER_OPTIONAL_COLUMNS],
          VOTER_NOTES,
          VOTER_EXAMPLES,
        ),
      };
    case 'candidates':
      return {
        fileName: 'candidates-sample.xlsx',
        contentType: XLSX,
        data: await writeSheetToBuffer(templateSheets('candidates')),
      };
    case 'ps-names':
      // JSON has no note row: { "<English PS name exactly as in the geography file>": "<Hindi name>" }.
      return jsonFile('ps-names-sample.json', {
        'EXAMPLE CHURU PANCHAYAT SAMITI': 'चूरू',
        'EXAMPLE RATANGARH PANCHAYAT SAMITI': 'रतनगढ़',
      });
    case 'fixes': {
      // One entry per approved correction; the keys are exactly FIX_KEYS.
      const example: Record<(typeof FIX_KEYS)[number], string | number> = {
        panchayat_samiti: 'EXAMPLE CHURU PANCHAYAT SAMITI',
        booth_no: 12,
        field: FIX_FIELDS[1] ?? 'zp_ward_no',
        value: 3,
        reason: 'EXAMPLE: RO letter no. ___ dated ___ confirms the correct ZP ward',
        approved_by: 'EXAMPLE: Name, designation',
        approved_on: '2026-10-01',
      };
      return jsonFile('fixes-sample.json', [example]);
    }
  }
}
