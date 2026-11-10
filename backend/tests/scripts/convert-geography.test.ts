// convert:geography (file only): Hindi PS names -> system names, District = Churu, the first number
// of the GP ward list; "A" booths (e.g. 15A) are kept as text labels.
import { describe, expect, it } from 'vitest';
import {
  PS_HINDI_TO_ENGLISH,
  convertGeographyRows,
  firstNumber,
} from '../../scripts/convert-geography.js';
import { COLUMNS } from '../../src/services/setup/geography.js';
import type { Cell, SheetRow } from '../../src/services/master-data/xlsx.js';

function row(rowNumber: number, ps: string, boothNo: Cell, gpWard: Cell): SheetRow {
  const cells: Record<string, Cell> = {
    [COLUMNS.district]: 'चूरू',
    [COLUMNS.ps]: ps,
    [COLUMNS.gp]: 'लीलकी',
    [COLUMNS.gpWard]: gpWard,
    [COLUMNS.boothNo]: boothNo,
    [COLUMNS.nameHindi]: 'विद्यालय',
    [COLUMNS.nameEnglish]: 'School',
    [COLUMNS.psWard]: 2,
    [COLUMNS.zpWard]: 32,
  };
  return { rowNumber, cells, allText: [] };
}

describe('convert:geography', () => {
  it('maps all 13 PS to different system names', () => {
    expect(new Set(Object.values(PS_HINDI_TO_ENGLISH)).size).toBe(13);
  });

  it('first number of a GP ward list', () => {
    expect(firstNumber('1,2,3')).toBe(1);
    expect(firstNumber('वार्ड सं. 4 से 5')).toBe(4);
    expect(firstNumber(7)).toBe(7);
    expect(firstNumber('कोई नहीं')).toBeNull();
    expect(firstNumber(null)).toBeNull();
  });

  it('clean rows use Churu and the English PS name; "A" booths are kept as text labels', () => {
    const r = convertGeographyRows([
      row(2, 'राजगढ़ (चूरू)', 1, '1,2'),
      row(3, 'तारानगर पश्चिम (भालेरी)मुख्यालय तारानगर', '15A', '3'),
      row(4, 'तारानगर', '12', 5),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.clean).toEqual([
      ['Churu', 'RAJGARH PANCHAYAT SAMITI', 'लीलकी', 1, 1, 'विद्यालय', 'School', 2, 32],
      [
        'Churu',
        'TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI',
        'लीलकी',
        3,
        '15A',
        'विद्यालय',
        'School',
        2,
        32,
      ],
      ['Churu', 'TARANAGAR EAST PANCHAYAT SAMITI', 'लीलकी', 5, 12, 'विद्यालय', 'School', 2, 32],
    ]);
  });

  it('a booth number that is not like 12 / 12A is an error (nothing guessed)', () => {
    const r = convertGeographyRows([
      row(2, 'चूरू', '15a', '1'),
      row(3, 'चूरू', 'A15', '1'),
      row(4, 'चूरू', '0', '1'),
      row(5, 'चूरू', null, '1'),
    ]);
    expect(r.clean).toEqual([]);
    expect(r.errors).toHaveLength(4);
  });

  it('an unknown PS or a ward cell without a number is an error (nothing guessed)', () => {
    const r = convertGeographyRows([row(2, 'अज्ञात', 1, '1'), row(3, 'चूरू', 2, 'कोई नहीं')]);
    expect(r.clean).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
});
