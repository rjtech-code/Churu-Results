// Writes the ZP ST Format numbers into a copy of the official template (docs/st-formats, shipped as
// src/assets/st-formats). Only data cells are written; rows are added above the footnotes when
// there are more members than template rows. Every column used is checked against the template's
// own header text first, so a number can never land under the wrong heading.
import { readFile } from 'node:fs/promises';
import {
  AGE_BUCKETS,
  DISTRICT_NAME,
  ST_CATEGORIES,
  ST_PARTIES,
} from '../../services/st-format-zp.js';
import type { StFormatZp, StParty, StWinnerRow } from '../../services/st-format-zp.js';
import { EDUCATIONS } from '../../services/master-data/candidate-details.js';
import { TemplateBook, colName, colNumber } from '../../services/xlsx-template.js';
import type { CellValue, TemplateSheet } from '../../services/xlsx-template.js';

/** The download keeps the official file name. */
export const ZP_ST_FILE_NAME =
  'STATISTICS_FORMAT_ZP_Members_ZILA_PRAMUKH_UP_PRUMUKH__Election_2026.xlsx';

// From src/modules/reports and from dist/modules/reports alike: <backend>/src/assets/…
const TEMPLATE_URL = new URL('../../../src/assets/st-formats/ZP_ST_FORMAT.xlsx', import.meta.url);

export const ZP_SHEETS = {
  f14: 'ST.F14 (A)',
  f15: 'ST.F15',
  f16: 'ST.F16',
  f16a: 'ST.F16 (A)',
  f17: 'ST.F17',
  f17a: 'ST.F17(A) ',
  f18: 'ST. F18',
  f19: 'ST.F19',
  f19a: 'ST.F19(A)',
} as const;

export const readZpTemplate = (): Promise<Buffer> => readFile(TEMPLATE_URL);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/\.$/, '');

/** Throws when the template's heading is not the expected one (the template was changed). */
export function expectHeader(sheet: TemplateSheet, ref: string, expected: string): void {
  const got = sheet.text(ref);
  if (norm(got) !== norm(expected)) {
    throw new Error(`ST format template: ${sheet.name} ${ref} is "${got}", expected "${expected}"`);
  }
}

export const col = (start: string, offset: number) => colName(colNumber(start) + offset);

export function writeRow(
  sheet: TemplateSheet,
  row: number,
  startCol: string,
  values: readonly CellValue[],
): void {
  values.forEach((v, i) => {
    sheet.set(`${col(startCol, i)}${String(row)}`, v);
  });
}

/** Rows first..last are the template's data rows; more members -> rows added after `last`. */
function makeRoom(sheet: TemplateSheet, first: number, last: number, needed: number): void {
  const extra = needed - (last - first + 1);
  if (extra > 0) sheet.insertRowsAfter(last, extra);
}

/** Party blocks of `width` columns from `start`, in the template's own order (labels on `row`). */
export function partyBlocks(
  sheet: TemplateSheet,
  start: string,
  width: number,
  row: number,
): Map<StParty, string> {
  const blocks = new Map<StParty, string>();
  ST_PARTIES.forEach((_, k) => {
    const c = col(start, k * width);
    const label = norm(sheet.text(`${c}${String(row)}`));
    const party = ST_PARTIES.find((p) => norm(p) === label);
    if (party === undefined)
      throw new Error(`ST format template: ${sheet.name} ${c}${String(row)} is not a party`);
    blocks.set(party, c);
  });
  if (blocks.size !== ST_PARTIES.length)
    throw new Error(`ST format template: ${sheet.name} party columns`);
  return blocks;
}

const genderLabel = (w: StWinnerRow) => w.gender;
export const EDUCATION_LABELS = [
  'ILLITERATE',
  'LITERATE',
  'PRIMARY',
  'UPPER PRIMARY',
  'SECONDARY',
  'SR. SECONDARY',
  'GRADUATE',
  'POST GRADUATE',
  'PROFFESSIONAL', // spelt so in the official template
] as const;

export async function writeZpStFormat(data: StFormatZp, template: Buffer): Promise<Buffer> {
  const book = await TemplateBook.load(template);
  const head = [1, DISTRICT_NAME, data.totalWards] as const;

  // ---- ST.F14 (A): row 8, TOTAL row 10 (same values: one district).
  {
    const s = book.sheet(ZP_SHEETS.f14);
    const cols = [...ST_PARTIES, 'NOTA'] as const;
    cols.forEach((p, i) => {
      expectHeader(s, `${col('G', i)}6`, p);
      expectHeader(s, `${col('Q', i)}6`, p);
    });
    expectHeader(s, 'A10', 'TOTAL');
    const f = data.f14;
    const values = [
      f.postal,
      f.evm,
      f.totalValid,
      ...cols.map((p) => f.votes[p]),
      ...cols.map((p) => f.percent[p]),
    ];
    writeRow(s, 8, 'A', [...head, ...values]);
    writeRow(s, 10, 'C', [data.totalWards, ...values]);
  }

  // ---- ST.F15: one row per elected member, from row 8 (template rows 8-13).
  {
    const s = book.sheet(ZP_SHEETS.f15);
    expectHeader(s, 'E6', "PERSON'S NAME");
    expectHeader(s, 'I6', 'CATEGORY (GEN /SC /ST /OBC)');
    makeRoom(s, 8, 13, data.winners.length);
    data.winners.forEach((w, i) => {
      writeRow(s, 8 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        w.wardNo,
        w.constituencyCategory,
        w.name,
        w.dobOrAge,
        w.party,
        genderLabel(w),
        w.category,
      ]);
    });
  }

  // ---- ST.F16: row 8, TOTAL row 14.
  {
    const s = book.sheet(ZP_SHEETS.f16);
    ST_CATEGORIES.forEach((c, i) => {
      expectHeader(s, `${col('D', i)}6`, c);
      expectHeader(s, `${col('H', i)}6`, c);
    });
    expectHeader(s, 'D5', 'MALE');
    expectHeader(s, 'H5', 'FEMALE');
    expectHeader(s, 'L5', 'THIRD GENDER');
    expectHeader(s, 'A14', 'TOTAL');
    const v = [
      ...ST_CATEGORIES.map((c) => data.f16.M[c]),
      ...ST_CATEGORIES.map((c) => data.f16.F[c]),
      data.f16.TG,
    ];
    writeRow(s, 8, 'A', [...head, ...v]);
    writeRow(s, 14, 'C', [data.totalWards, ...v]);
  }

  // ---- ST.F16 (A): row 8.
  {
    const s = book.sheet(ZP_SHEETS.f16a);
    [...ST_CATEGORIES, 'TOTAL'].forEach((c, i) => {
      expectHeader(s, `${col('D', i)}6`, c);
      expectHeader(s, `${col('I', i)}6`, c);
    });
    const a = data.f16a;
    writeRow(s, 8, 'A', [
      ...head,
      ...ST_CATEGORIES.map((c) => a.reserved[c]),
      a.reservedTotal,
      ...ST_CATEGORIES.map((c) => a.elected[c]),
      a.electedTotal,
    ]);
  }

  // ---- ST.F17: row 9, TOTAL row 11. Party order as in the template (BJP before BSP here).
  {
    const s = book.sheet(ZP_SHEETS.f17);
    const blocks = partyBlocks(s, 'D', 5, 6);
    expectHeader(s, 'A11', 'TOTAL');
    writeRow(s, 9, 'A', head);
    s.set('C11', data.totalWards);
    for (const [party, start] of blocks) {
      [...ST_CATEGORIES, 'TOTAL'].forEach((c, i) => {
        expectHeader(s, `${col(start, i)}7`, c);
      });
      const p = data.f17[party];
      const v = [...ST_CATEGORIES.map((c) => p[c]), p.TOTAL];
      writeRow(s, 9, start, v);
      writeRow(s, 11, start, v);
    }
  }

  // ---- ST.F17(A): row 10.
  {
    const s = book.sheet(ZP_SHEETS.f17a);
    const blocks = partyBlocks(s, 'D', 4, 7);
    writeRow(s, 10, 'A', head);
    for (const [party, start] of blocks) {
      ['MALE', 'FEMALE', 'THIRD GENDER', 'TOTAL'].forEach((c, i) => {
        expectHeader(s, `${col(start, i)}8`, c);
      });
      const p = data.f17a[party];
      writeRow(s, 10, start, [p.M, p.F, p.TG, p.TOTAL]);
    }
  }

  // ---- ST. F18: one row per elected member, from row 9 (template rows 9-12).
  {
    const s = book.sheet(ZP_SHEETS.f18);
    expectHeader(s, 'E6', 'TOTAL ELECTORATE');
    expectHeader(s, 'G6', 'REJECTED VOTES');
    expectHeader(s, 'P7', 'LITERACY STATUS');
    expectHeader(s, 'U7', 'VALID VOTES SECURED');
    expectHeader(s, 'V6', 'MARGIN OF VOTES');
    makeRoom(s, 9, 12, data.winners.length);
    data.winners.forEach((w, i) => {
      writeRow(s, 9 + i, 'A', [
        i + 1,
        DISTRICT_NAME,
        w.wardNo,
        w.constituencyCategory,
        w.electorate,
        w.polled,
        w.rejected,
        w.nota,
        w.valid,
        w.name,
        w.dobOrAge,
        w.party,
        w.winnerVotes,
        genderLabel(w),
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

  // ---- ST.F19: row 7.
  {
    const s = book.sheet(ZP_SHEETS.f19);
    AGE_BUCKETS.forEach((b, i) => {
      expectHeader(s, `${col('D', i * 2)}4`, b.label);
      expectHeader(s, `${col('D', i * 2)}5`, 'MALE');
      expectHeader(s, `${col('D', i * 2 + 1)}5`, 'FEMALE');
    });
    expectHeader(s, 'N4', 'Total');
    expectHeader(s, 'P5', 'THIRD GENDER');
    expectHeader(s, 'Q4', 'GRANDTOTAL');
    const f = data.f19;
    writeRow(s, 7, 'A', [
      ...head,
      ...f.buckets.flatMap((b) => [b.M, b.F]),
      f.total.M,
      f.total.F,
      f.total.TG,
      f.grand,
    ]);
  }

  // ---- ST.F19(A): row 7, Total row 12.
  {
    const s = book.sheet(ZP_SHEETS.f19a);
    EDUCATION_LABELS.forEach((label, i) => {
      expectHeader(s, `${col('D', i * 2)}4`, label);
    });
    expectHeader(s, 'V4', 'TOTAL');
    expectHeader(s, 'X5', 'THIRD GENDER');
    expectHeader(s, 'Y4', 'GRANDTOTAL');
    expectHeader(s, 'A12', 'Total');
    const f = data.f19a;
    const v = [
      ...EDUCATIONS.flatMap((e) => [f.levels[e].M, f.levels[e].F]),
      f.total.M,
      f.total.F,
      f.total.TG,
      f.grand,
    ];
    writeRow(s, 7, 'A', [...head, ...v]);
    writeRow(s, 12, 'C', [data.totalWards, ...v]);
  }

  return book.toBuffer();
}
