// Every message the import code can give has a plain version (never the generic fallback).
import { describe, expect, it } from 'vitest';
import { GENERIC_LINE, officerLine } from '../../src/modules/superadmin/officer-lines.js';
import type { LineSource } from '../../src/modules/superadmin/officer-lines.js';

const KNOWN: readonly [LineSource, string][] = [
  ['geography', '[row 5] "PollingStationNumber" is empty'],
  ['geography', '[row 6] "WardNumber" must be a whole number >= 1, got "x"'],
  ['geography', '[row 2] District must be Churu, got "EXAMPLE Churu"'],
  [
    'geography',
    '[rows 3, 4] Booth 7 of CHURU PANCHAYAT SAMITI has conflicting PS ward numbers: 1 (row 3), 2 (row 4). Correct the source file or add an approved entry to the fixes file.',
  ],
  ['geography', 'Booths: found 3, expected 1359. Check against the official numbers.'],
  [
    'geography',
    'No Hindi name for "BIDASAR PANCHAYAT SAMITI"; the English name is stored instead.',
  ],
  ['geography', 'PS names file: "X PS" is not a Panchayat Samiti in the data file.'],
  ['geography', 'PS names file: Hindi name "चूरू" is used for A and B.'],
  [
    'geography',
    'PS names file must be a JSON object: { "<English PS name>": "<Hindi name>", ... }.',
  ],
  ['geography', 'Fixes file entry #2: booth 9 of "CHURU" is not in the data file.'],
  ['geography', 'Fixes file entry #1: "approved_on" must be a real date written as YYYY-MM-DD.'],
  ['geography', 'Fixes file must be a JSON list ([ ... ]) of fix objects.'],
  ['geography', 'Cannot read file "/x/geography.xlsx": boom'],
  [
    'geography',
    'No sheet has all required columns (District, PanchayatSamiti). Sheet1: missing X.',
  ],
  ['geography', 'Sheet "S" has the column(s) District more than once.'],
  [
    'geography',
    'Panchayat Samiti "SUJANGARH" is in the database with user accounts but not in the file; it cannot be removed.',
  ],
  ['voters', 'Unknown booth: CHURU PANCHAYAT SAMITI has no booth 99'],
  ['voters', 'Missing booth: booth 4 of CHURU is not in the file'],
  ['voters', '[rows 2, 3] The same booth appears more than once'],
  ['voters', '[row 4] voters_total 10 does not equal male 5 + female 4 + other 0 = 9'],
  [
    'voters',
    'The file has 10 booths (PanchayatSamiti + PollingStationNumber); expected exactly 1359',
  ],
  ['voters', 'Total_Elector grand total 5 is not the expected 1248368'],
  ['voters', 'Total_Elector grand total 5 does not equal SUM(Sheet3.Voters) 6'],
  ['voters', 'The file has no sheet "Sheet3" to cross-check'],
  ['voters', 'Unknown Panchayat Samiti "XYZ"'],
  ['voters', 'Stopped; nothing was written. Cause: ER_X: secret sql detail'],
  ['dm', 'That is not a valid email address.'],
  ['dm', 'Another account already has this email.'],
  ['dm', 'No active DM account.'],
];

describe('officer lines', () => {
  it.each(KNOWN)('%s: %s', (source, english) => {
    const line = officerLine(source, english);
    expect(line).not.toContain(GENERIC_LINE);
    expect(line).toMatch(/[ऀ-ॿ]/);
    expect(line).not.toMatch(/ER_|sql|\/x\//i);
  });

  it('keeps the row number and never leaks unknown text', () => {
    expect(officerLine('voters', '[row 4] The same booth appears more than once')).toMatch(
      /^Voters file · Row 4: /,
    );
    expect(officerLine('voters', 'SELECT * FROM booth exploded')).toContain(GENERIC_LINE);
    expect(officerLine('voters', 'SELECT * FROM booth exploded')).not.toContain('SELECT');
  });
});
