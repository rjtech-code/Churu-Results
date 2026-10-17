// Writes the PS ST Format numbers into a copy of the official template (docs/st-formats, shipped as
// src/assets/st-formats). Only data cells are written. When more rows are needed they are added
// INSIDE the template's data block (after its second-to-last data row), so the print area and the
// filter range of the template grow with them. Every column used is checked against the template's
// own header text first. Sheets without a TOTAL row in the template get none.
import { readFile } from 'node:fs/promises';
import { EDUCATIONS } from '../../services/master-data/candidate-details.js';
import {
  AGE_BUCKETS,
  DISTRICT_NAME,
  ST_CATEGORIES,
  ST_PARTIES,
} from '../../services/st-format-common.js';
import type { VoteShare, WinnerCounts } from '../../services/st-format-common.js';
import type { StFormatPs } from '../../services/st-format-ps.js';
import { TemplateBook } from '../../services/xlsx-template.js';
import type { CellValue, TemplateSheet } from '../../services/xlsx-template.js';
import { EDUCATION_LABELS, col, expectHeader, partyBlocks, writeRow } from './st-format.xlsx.js';

/** The officer's file name (spelling as given). ASCII only. */
export const PS_ST_FILE_NAME = 'ST_FORMAT_Panchyat_Samiti_Members_Election_2026.xlsx';

/** One PS: "<official name>_<PS name in English>.xlsx" (ASCII letters/digits; else the PS id). */
export function psStFileName(ps: { id: number; nameEnglish: string } | null): string {
  if (ps === null) return PS_ST_FILE_NAME;
  const safe = ps.nameEnglish.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return PS_ST_FILE_NAME.replace(/\.xlsx$/, `_${safe === '' ? String(ps.id) : safe}.xlsx`);
}

const TEMPLATE_URL = new URL('../../../src/assets/st-formats/PS_ST_FORMAT.xlsx', import.meta.url);
export const readPsTemplate = (): Promise<Buffer> => readFile(TEMPLATE_URL);

export const PS_SHEETS = {
  f14: 'ST.F14 (A)',
  f15: 'ST.F.15',
  f16: 'ST.F.16 ',
  f16a: 'ST.F16 (A)',
  f16b: 'ST.F16 (B)',
  f16c: 'ST.F16 (C) ',
  f17: 'ST.F17',
  f17a: 'ST.F17A',
  f18: 'ST.F18',
  f19: 'ST.F19',
  f19a: 'ST.F19 (A)',
} as const;

/** Template data rows first..last; `needed` rows are written from `first`. */
function makeRoom(sheet: TemplateSheet, first: number, last: number, needed: number): void {
  const extra = needed - (last - first + 1);
  if (extra > 0) sheet.insertRowsAfter(last - 1, extra);
}

const shareValues = (s: VoteShare): CellValue[] => {
  const cols = [...ST_PARTIES, 'NOTA'] as const;
  return [
    s.postal,
    s.evm,
    s.totalValid,
    ...cols.map((p) => s.votes[p]),
    ...cols.map((p) => s.percent[p]),
  ];
};
const genderValues = (c: WinnerCounts): CellValue[] => [
  ...ST_CATEGORIES.map((k) => c.gender.M[k]),
  ...ST_CATEGORIES.map((k) => c.gender.F[k]),
  c.gender.TG,
];
const womenValues = (c: WinnerCounts): CellValue[] => [
  ...ST_CATEGORIES.map((k) => c.women.reserved[k]),
  c.women.reservedTotal,
  ...ST_CATEGORIES.map((k) => c.women.elected[k]),
  c.women.electedTotal,
];
const ageValues = (c: WinnerCounts): CellValue[] => [
  ...c.age.buckets.flatMap((b) => [b.M, b.F]),
  c.age.total.M,
  c.age.total.F,
  c.age.total.TG,
  c.age.grand,
];
const educationValues = (c: WinnerCounts): CellValue[] => [
  ...EDUCATIONS.flatMap((e) => [c.education.levels[e].M, c.education.levels[e].F]),
  c.education.total.M,
  c.education.total.F,
  c.education.total.TG,
  c.education.grand,
];

function checkGenderHeads(s: TemplateSheet, row: number): void {
  ST_CATEGORIES.forEach((c, i) => {
    expectHeader(s, `${col('E', i)}${String(row + 1)}`, c);
    expectHeader(s, `${col('I', i)}${String(row + 1)}`, c);
  });
  expectHeader(s, `E${String(row)}`, 'MALE');
  expectHeader(s, `I${String(row)}`, 'FEMALE');
  expectHeader(s, `M${String(row)}`, 'THIRD GENDER');
}

function checkWomenHeads(s: TemplateSheet): void {
  [...ST_CATEGORIES, 'TOTAL'].forEach((c, i) => {
    expectHeader(s, `${col('E', i)}6`, c);
    expectHeader(s, `${col('J', i)}6`, c);
  });
  expectHeader(s, 'E5', 'RESERVATION FOR WOMEN');
  expectHeader(s, 'J5', 'ELECTED WOMEN CANDIDATES');
}

export async function writePsStFormat(data: StFormatPs, template: Buffer): Promise<Buffer> {
  const book = await TemplateBook.load(template);
  const n = data.ps.length;

  // ---- ST.F14 (A): one row per PS, rows 9-15. No TOTAL row in the template.
  {
    const s = book.sheet(PS_SHEETS.f14);
    [...ST_PARTIES, 'NOTA'].forEach((p, i) => {
      expectHeader(s, `${col('H', i)}7`, p);
      expectHeader(s, `${col('R', i)}7`, p);
    });
    expectHeader(s, 'C6', 'NAME OF PANCHAYAT SAMITI');
    makeRoom(s, 9, 15, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 9 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        p.psName,
        p.totalWards,
        ...shareValues(p.share),
      ]);
    });
  }

  // ---- ST.F.15: one row per elected member, rows 8-11.
  {
    const s = book.sheet(PS_SHEETS.f15);
    expectHeader(s, 'D5', 'PS CONSTITUENCY NO.');
    expectHeader(s, 'F6', 'NAME');
    expectHeader(s, 'J6', 'CATEGORY (GEN, SC, ST, OBC)');
    makeRoom(s, 8, 11, data.winners.length);
    data.winners.forEach((w, i) => {
      writeRow(s, 8 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        w.psName,
        w.wardNo,
        w.constituencyCategory,
        w.name,
        w.dobOrAge,
        w.party,
        w.gender,
        w.category,
      ]);
    });
  }

  // ---- ST.F.16: one district row (9), TOTAL row 12.
  {
    const s = book.sheet(PS_SHEETS.f16);
    checkGenderHeads(s, 6);
    expectHeader(s, 'C6', 'TOTAL NO. OF PANCHAYAT SAMITI');
    expectHeader(s, 'A12', 'TOTAL');
    const d = data.district;
    const v = [d.psCount, d.totalWards, ...genderValues(d.counts)];
    writeRow(s, 9, 'A', [1, DISTRICT_NAME, ...v]);
    writeRow(s, 12, 'C', v);
  }

  // ---- ST.F16 (A): one row per PS (rows 9-11), TOTAL row after them.
  {
    const s = book.sheet(PS_SHEETS.f16a);
    checkGenderHeads(s, 6);
    expectHeader(s, 'A12', 'TOTAL');
    makeRoom(s, 9, 11, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 9 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        p.psName,
        p.totalWards,
        ...genderValues(p.counts),
      ]);
    });
    const totalRow = 12 + Math.max(0, n - 3);
    expectHeader(s, `A${String(totalRow)}`, 'TOTAL');
    writeRow(s, totalRow, 'D', [data.total.totalWards, ...genderValues(data.total.counts)]);
  }

  // ---- ST.F16 (B): one district row (8). No TOTAL row.
  {
    const s = book.sheet(PS_SHEETS.f16b);
    checkWomenHeads(s);
    expectHeader(s, 'C5', 'TOTAL NO. OF PANCHAYAT SAMITI');
    const d = data.district;
    writeRow(s, 8, 'A', [1, DISTRICT_NAME, d.psCount, d.totalWards, ...womenValues(d.counts)]);
  }

  // ---- ST.F16 (C): one row per PS (rows 8-10). No TOTAL row.
  {
    const s = book.sheet(PS_SHEETS.f16c);
    checkWomenHeads(s);
    expectHeader(s, 'C5', 'NAME OF PANCHAYAT SAMITI');
    makeRoom(s, 8, 10, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 8 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        p.psName,
        p.totalWards,
        ...womenValues(p.counts),
      ]);
    });
  }

  // ---- ST.F17: party x category per PS (rows 9-10), TOTAL row after them.
  {
    const s = book.sheet(PS_SHEETS.f17);
    const blocks = partyBlocks(s, 'E', 5, 6);
    for (const start of blocks.values()) {
      [...ST_CATEGORIES, 'TOTAL'].forEach((c, i) => {
        expectHeader(s, `${col(start, i)}7`, c);
      });
    }
    makeRoom(s, 9, 10, n);
    const totalRow = 11 + Math.max(0, n - 2);
    expectHeader(s, `A${String(totalRow)}`, 'TOTAL');
    const write = (row: number, c: WinnerCounts) => {
      for (const [party, start] of blocks) {
        const pc = c.partyCategory[party];
        writeRow(s, row, start, [...ST_CATEGORIES.map((k) => pc[k]), pc.TOTAL]);
      }
    };
    data.ps.forEach((p, i) => {
      writeRow(s, 9 + i, 'A', [i + 1, DISTRICT_NAME, p.psName, p.totalWards]);
      write(9 + i, p.counts);
    });
    s.set(`D${String(totalRow)}`, data.total.totalWards);
    write(totalRow, data.total.counts);
  }

  // ---- ST.F17A: party x gender per PS (rows 9-14). No TOTAL row.
  {
    const s = book.sheet(PS_SHEETS.f17a);
    const blocks = partyBlocks(s, 'E', 4, 6);
    for (const start of blocks.values()) {
      ['MALE', 'FEMALE', 'THIRD GENDER', 'TOTAL'].forEach((c, i) => {
        expectHeader(s, `${col(start, i)}7`, c);
      });
    }
    makeRoom(s, 9, 14, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 9 + i, 'A', [i + 1, DISTRICT_NAME, p.psName, p.totalWards]);
      for (const [party, start] of blocks) {
        const pg = p.counts.partyGender[party];
        writeRow(s, 9 + i, start, [pg.M, pg.F, pg.TG, pg.TOTAL]);
      }
    });
  }

  // ---- ST.F18: one row per elected member, rows 9-12.
  {
    const s = book.sheet(PS_SHEETS.f18);
    expectHeader(s, 'F6', 'TOTAL ELECTORATE');
    expectHeader(s, 'H6', 'REJECTED');
    expectHeader(s, 'J6', 'TOTAL VALID VOTES (10= 7-8-9)');
    expectHeader(s, 'L7', 'AGE');
    expectHeader(s, 'Q7', 'LITERACY STATUS');
    expectHeader(s, 'V7', 'VALID VOTES SECURED');
    expectHeader(s, 'W6', 'MARGIN OF VOTES');
    makeRoom(s, 9, 12, data.winners.length);
    data.winners.forEach((w, i) => {
      writeRow(s, 9 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        w.psName,
        w.wardNo,
        w.constituencyCategory,
        w.electorate,
        w.polled,
        w.rejected,
        w.nota,
        w.valid,
        w.name,
        w.age, // this column is AGE only (F15 has DOB/AGE)
        w.party,
        w.winnerVotes,
        w.gender,
        w.category,
        w.literacy,
        w.mobile,
        w.rival?.name ?? null,
        w.rival?.party ?? null,
        w.rival?.mobile ?? null,
        w.rival?.votes ?? null,
        w.margin,
      ]);
    });
  }

  // ---- ST.F19: age per PS (rows 7-12), Total row after them.
  {
    const s = book.sheet(PS_SHEETS.f19);
    AGE_BUCKETS.forEach((b, i) => {
      expectHeader(s, `${col('E', i * 2)}4`, b.label);
      expectHeader(s, `${col('E', i * 2)}5`, 'MALE');
      expectHeader(s, `${col('E', i * 2 + 1)}5`, 'FEMALE');
    });
    expectHeader(s, 'O4', 'Total');
    expectHeader(s, 'Q5', 'THIRD GENDER');
    expectHeader(s, 'R4', 'GRAND TOTAL');
    makeRoom(s, 7, 12, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 7 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        p.psName,
        p.totalWards,
        ...ageValues(p.counts),
      ]);
    });
    const totalRow = 13 + Math.max(0, n - 6);
    expectHeader(s, `A${String(totalRow)}`, 'Total');
    writeRow(s, totalRow, 'D', [data.total.totalWards, ...ageValues(data.total.counts)]);
  }

  // ---- ST.F19 (A): education per PS (rows 7-9), Total row after them.
  {
    const s = book.sheet(PS_SHEETS.f19a);
    EDUCATION_LABELS.forEach((label, i) => {
      expectHeader(s, `${col('E', i * 2)}4`, label);
    });
    expectHeader(s, 'W4', 'TOTAL');
    expectHeader(s, 'Y5', 'THIRD GENDER');
    expectHeader(s, 'Z4', 'GRAND TOTAL');
    makeRoom(s, 7, 9, n);
    data.ps.forEach((p, i) => {
      writeRow(s, 7 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        p.psName,
        p.totalWards,
        ...educationValues(p.counts),
      ]);
    });
    const totalRow = 10 + Math.max(0, n - 3);
    expectHeader(s, `A${String(totalRow)}`, 'Total');
    writeRow(s, totalRow, 'D', [data.total.totalWards, ...educationValues(data.total.counts)]);
  }

  return book.toBuffer();
}
