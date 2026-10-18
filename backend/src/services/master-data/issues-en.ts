// English text of every master-data issue: exactly the Part 2 CLI report wording.
import { AGE_REFERENCE_DATE } from '../../config/election.js';
import { EDUCATION_NAMES_EN, MAX_AGE, MIN_AGE } from './candidate-details.js';
import type { Issue, IssueBody, WardRef } from './issues.js';

/** "PS ward 3 of CHURU PANCHAYAT SAMITI (ward id 12)" / "ZP ward 3 (ward id 40)". */
export function wardLabelEn(w: WardRef): string {
  return w.type === 'PS'
    ? `PS ward ${w.wardNo} of ${w.psName ?? '?'} (ward id ${w.id})`
    : `ZP ward ${w.wardNo} (ward id ${w.id})`;
}

export function issueTextEn(issue: IssueBody): string {
  switch (issue.code) {
    case 'CELL_EMPTY':
      return `"${issue.column}" is empty`;
    case 'CELL_NOT_INT': {
      const rule = issue.min === 1 ? 'a whole number greater than 0' : 'a whole number (0 or more)';
      return `"${issue.column}" must be ${rule}, got "${issue.value}"`;
    }
    case 'PARTY_DUPLICATE_IN_FILE':
      return `${issue.field} "${issue.value}" appears more than once in the file`;
    case 'PARTY_EXISTS_DIFFERENT':
      return `Party "${issue.shortName}" already exists with different ${issue.fields.join(', ')}; changing an existing party is not supported`;
    case 'PARTY_NAME_TAKEN':
      return `${issue.field} "${issue.value}" already belongs to party "${issue.owner}" in the database`;
    case 'PARTY_TOO_LONG':
      return `${issue.field} must be at most ${issue.max} characters`;
    case 'EXAMPLE_ROW':
      return 'This row is a template EXAMPLE row; delete it before importing';
    case 'ELECTION_INVALID':
      return `"election" must be PS or ZP, got "${issue.value}"`;
    case 'GENDER_INVALID':
      return `"gender" must be M, F or O, got "${issue.value}"`;
    case 'DOB_INVALID':
      return `"dob" must be a real date DD/MM/YYYY (age ${String(MIN_AGE)} to ${String(MAX_AGE)} on ${AGE_REFERENCE_DATE}), got "${issue.value}"`;
    case 'AGE_INVALID':
      return `"age" must be a whole number from ${String(MIN_AGE)} to ${String(MAX_AGE)}, got "${issue.value}"`;
    case 'EDUCATION_INVALID':
      return `"education" must be one of ${EDUCATION_NAMES_EN}, got "${issue.value}"`;
    case 'MOBILE_INVALID':
      return `"mobile" must be a 10-digit mobile number starting with 6-9, got "${issue.value}"`;
    case 'CANDIDATE_CATEGORY_INVALID':
      return `"candidate_category" must be GEN, SC, ST or OBC (or the Hindi name), got "${issue.value}"`;
    case 'DETAIL_TOO_LONG':
      return `"${issue.column}" must be at most ${issue.max} characters`;
    case 'PARTY_UNKNOWN':
      return `Unknown party short name "${issue.value}"`;
    case 'PS_REQUIRED':
      return '"panchayat_samiti" is required for PS rows';
    case 'PS_UNKNOWN':
      return `Unknown Panchayat Samiti "${issue.value}"`;
    case 'PS_WARD_UNKNOWN':
      return `${issue.psName} has no PS ward ${issue.wardNo}`;
    case 'ZP_WARD_UNKNOWN':
      return `ZP ward ${issue.wardNo} does not exist`;
    case 'ZP_PS_IGNORED':
      return '"panchayat_samiti" is ignored for ZP rows (ZP wards are district-wide)';
    case 'NAME_TOO_LONG':
      return `"name_hindi" must be at most ${issue.max} characters`;
    case 'WARD_LOCKED':
      return `${wardLabelEn(issue.ward)}: the ballot is LOCKED; its candidates cannot be changed`;
    case 'WARD_HAS_ENTRIES':
      return `${wardLabelEn(issue.ward)}: counting entries already exist; its candidates cannot be changed`;
    case 'POSITION_REPEATED':
      return `${wardLabelEn(issue.ward)}: ballot_position ${issue.position} is used more than once`;
    case 'POSITION_GAPS':
      return `${wardLabelEn(issue.ward)}: ballot positions must be 1..${issue.count} with no gaps; found ${issue.found.join(', ')}`;
    case 'PARTY_TWICE':
      return `${wardLabelEn(issue.ward)}: party "${issue.party}" has more than one candidate`;
    case 'CATEGORY_MIXED':
      return `${wardLabelEn(issue.ward)}: reservation_category must be the same on every row of the ward; found ${issue.categories
        .map((c) => (c === '' ? '(empty)' : `"${c}"`))
        .join(', ')}`;
    case 'TOO_MANY_CANDIDATES':
      return `${wardLabelEn(issue.ward)}: at most ${issue.max} candidates per ward`;
  }
}

/** Adds every issue to a CLI Report, with its row numbers. */
export function reportIssues(
  report: {
    error: (message: string, rows?: readonly number[]) => void;
    warn: (message: string, rows?: readonly number[]) => void;
  },
  issues: { errors: readonly Issue[]; warnings: readonly Issue[] },
): void {
  for (const i of issues.errors)
    report.error(issueTextEn(i), i.rows.length > 0 ? i.rows : undefined);
  for (const i of issues.warnings)
    report.warn(issueTextEn(i), i.rows.length > 0 ? i.rows : undefined);
}
