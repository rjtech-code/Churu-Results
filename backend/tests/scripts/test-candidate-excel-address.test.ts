// npm run test-candidate-excel: the fake address and occupation columns (Prarup-7 test data).
import { describe, expect, it } from 'vitest';
import {
  BLANK_CATEGORY_COUNT,
  TEST_OCCUPATIONS,
  buildTestRows,
} from '../../scripts/make-test-candidate-excel.js';
import type { SourceCandidate } from '../../scripts/make-test-candidate-excel.js';
import { checkDetails } from '../../src/services/master-data/candidate-details.js';
import { IssueList } from '../../src/services/master-data/issues.js';

const cands: SourceCandidate[] = Array.from({ length: 40 }, (_, i) => ({
  wardId: i + 1,
  wardType: i % 2 === 0 ? 'PS' : 'ZP',
  wardNo: i + 1,
  psName: 'ALPHA PANCHAYAT SAMITI',
  reservation: 'सामान्य',
  isUnopposed: i % 10 === 0,
  position: 1,
  nameHindi: `नाम ${String(i)}`,
  partyShort: null,
  gender: 'F',
}));

describe('test candidate Excel: address and occupation', () => {
  it('obviously fake TEST addresses and listed occupations, blank on the same rows as the category', () => {
    const { rows, blankRows } = buildTestRows(cands);
    expect(blankRows).toHaveLength(BLANK_CATEGORY_COUNT);
    rows.forEach((r, i) => {
      if (blankRows.includes(i)) {
        expect([r.address, r.occupation]).toEqual([null, null]);
      } else {
        expect(String(r.address)).toMatch(/^TEST पता /);
        expect(TEST_OCCUPATIONS).toContain(r.occupation);
      }
    });
  });

  it('every generated value passes the import rules', () => {
    const issues = new IssueList();
    for (const r of buildTestRows(cands).rows) {
      checkDetails(
        {
          dob: r.dob,
          age: r.age,
          education: r.education,
          mobile: r.mobile,
          candidateCategory: r.candidate_category,
          address: r.address,
          occupation: r.occupation,
        },
        1,
        issues,
      );
    }
    expect(issues.errors).toEqual([]);
  });
});
