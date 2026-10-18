// Optional candidate details for the ST Format returns (F15-F19A) and Prarup-7: date of birth (or
// the stated age), education, mobile, the candidate's own social category, address and occupation.
// One set of rules for the Excel import, the RO form and the DM's details edit. Private: only the DM
// and the ward's own RO ever see them (never public screens, the public API or the existing reports).
import type { RowDataPacket } from 'mysql2/promise';
import { normalizePhone, phoneLast4 } from './accounts.js';
import { parseAge, parseDob, shownDob } from './candidate-age.js';
import type { IssueList } from './issues.js';
import { normalizeText } from './text.js';

export { MAX_AGE, MIN_AGE, ageOn, candidateAge, parseAge, parseDob } from './candidate-age.js';

export const EDUCATIONS = [
  'ILLITERATE',
  'LITERATE',
  'PRIMARY',
  'UPPER_PRIMARY',
  'SECONDARY',
  'SR_SECONDARY',
  'GRADUATE',
  'POST_GRADUATE',
  'PROFESSIONAL',
] as const;
export type Education = (typeof EDUCATIONS)[number];

export const EDUCATION_HI: Readonly<Record<Education, string>> = {
  ILLITERATE: 'निरक्षर',
  LITERATE: 'साक्षर',
  PRIMARY: 'प्राथमिक',
  UPPER_PRIMARY: 'उच्च प्राथमिक',
  SECONDARY: 'माध्यमिक',
  SR_SECONDARY: 'उच्च माध्यमिक',
  GRADUATE: 'स्नातक',
  POST_GRADUATE: 'स्नातकोत्तर',
  PROFESSIONAL: 'व्यावसायिक',
};

export const EDUCATION_EN: Readonly<Record<Education, string>> = {
  ILLITERATE: 'Illiterate',
  LITERATE: 'Literate',
  PRIMARY: 'Primary',
  UPPER_PRIMARY: 'Upper Primary',
  SECONDARY: 'Secondary',
  SR_SECONDARY: 'Sr. Secondary',
  GRADUATE: 'Graduate',
  POST_GRADUATE: 'Post Graduate',
  PROFESSIONAL: 'Professional',
};

/** The candidate's own social category (not the ward's reservation). */
export const CANDIDATE_CATEGORIES = ['GEN', 'SC', 'ST', 'OBC'] as const;
export type CandidateCategory = (typeof CANDIDATE_CATEGORIES)[number];

/** Hindi names, accepted as input only: always saved and shown as GEN/SC/ST/OBC. */
export const CANDIDATE_CATEGORY_HI: Readonly<Record<CandidateCategory, string>> = {
  GEN: 'सामान्य',
  SC: 'अनुसूचित जाति',
  ST: 'अनुसूचित जनजाति',
  OBC: 'अन्य पिछड़ा वर्ग',
};

/** "Illiterate, Literate, …" for the English (CLI) messages. */
export const EDUCATION_NAMES_EN = EDUCATIONS.map((e) => EDUCATION_EN[e]).join(', ');

/** candidate.address VARCHAR(300), candidate.occupation VARCHAR(100). */
export const MAX_ADDRESS_LENGTH = 300;
export const MAX_OCCUPATION_LENGTH = 100;

export interface CandidateDetails {
  /** YYYY-MM-DD. When set, age_stated is NULL. */
  dob: string | null;
  ageStated: number | null;
  education: Education | null;
  /** 10 digits, 6-9 first. */
  mobile: string | null;
  candidateCategory: CandidateCategory | null;
  /** Free text (Hindi allowed), normalized. */
  address: string | null;
  occupation: string | null;
}

export const NO_DETAILS: CandidateDetails = {
  dob: null,
  ageStated: null,
  education: null,
  mobile: null,
  candidateCategory: null,
  address: null,
  occupation: null,
};

/**
 * The detail columns of `candidate c`, in the shape detailsFromRow reads. Fixed SQL text (no input),
 * shared by every read of the details so a new detail is added in one place.
 */
export const DETAIL_COLUMNS_SQL = `DATE_FORMAT(c.dob, '%Y-%m-%d') AS dob, c.age_stated, c.education,
            c.mobile, c.candidate_category, c.address, c.occupation`;

// "Sr. Secondary", "sr secondary", "SR_SECONDARY" and "उच्च माध्यमिक" all match.
const educationKey = (text: string) =>
  normalizeText(text)
    .toLowerCase()
    .replace(/[.\s_-]+/gu, '');
const EDUCATION_BY_KEY = new Map<string, Education>(
  EDUCATIONS.flatMap((e) => [
    [educationKey(e), e],
    [educationKey(EDUCATION_EN[e]), e],
    [educationKey(EDUCATION_HI[e]), e],
  ]),
);

export function parseEducation(raw: string): Education | null {
  return EDUCATION_BY_KEY.get(educationKey(raw)) ?? null;
}

// "GEN", "general", "सामान्य", "अनुसूचित जाति" … (same matching as education).
const CATEGORY_BY_KEY = new Map<string, CandidateCategory>(
  CANDIDATE_CATEGORIES.flatMap((c) => [
    [educationKey(c), c],
    [educationKey(CANDIDATE_CATEGORY_HI[c]), c],
  ]),
);
CATEGORY_BY_KEY.set(educationKey('General'), 'GEN');

export function parseCandidateCategory(raw: string): CandidateCategory | null {
  return CATEGORY_BY_KEY.get(educationKey(raw)) ?? null;
}

export interface RawDetails {
  dob: string | number | null;
  age: string | number | null;
  education: string | number | null;
  mobile: string | number | null;
  candidateCategory: string | number | null;
  address: string | number | null;
  occupation: string | number | null;
}

type TextDetail = 'address' | 'occupation';
const TEXT_MAX: Readonly<Record<TextDetail, number>> = {
  address: MAX_ADDRESS_LENGTH,
  occupation: MAX_OCCUPATION_LENGTH,
};

/** A free-text detail: normalized, empty = null, too long = an issue (and null). */
function checkText(
  raw: string | number | null,
  column: TextDetail,
  rowNumber: number,
  issues: IssueList,
): string | null {
  if (raw === null) return null;
  const text = normalizeText(String(raw));
  if (text.length > TEXT_MAX[column]) {
    issues.error({ code: 'DETAIL_TOO_LONG', column, max: TEXT_MAX[column] }, rowNumber);
    return null;
  }
  return text === '' ? null : text;
}

/** Date of birth, else the stated age (both given: the date of birth is kept). */
function checkDobOrAge(
  raw: RawDetails,
  out: CandidateDetails,
  rowNumber: number,
  issues: IssueList,
): void {
  if (raw.dob !== null) {
    out.dob = parseDob(raw.dob);
    if (out.dob === null)
      issues.error({ code: 'DOB_INVALID', value: shownDob(raw.dob) }, rowNumber);
  } else if (raw.age !== null) {
    out.ageStated = parseAge(raw.age);
    if (out.ageStated === null)
      issues.error({ code: 'AGE_INVALID', value: String(raw.age) }, rowNumber);
  }
}

/**
 * Checks the raw values (null = empty). Each wrong value is reported for `rowNumber`; then the
 * result is null.
 */
export function checkDetails(
  raw: RawDetails,
  rowNumber: number,
  issues: IssueList,
): CandidateDetails | null {
  const before = issues.errors.length;
  const out: CandidateDetails = { ...NO_DETAILS };
  checkDobOrAge(raw, out, rowNumber, issues);
  if (raw.education !== null) {
    out.education = parseEducation(String(raw.education));
    if (out.education === null)
      issues.error({ code: 'EDUCATION_INVALID', value: String(raw.education) }, rowNumber);
  }
  if (raw.mobile !== null) {
    out.mobile = normalizePhone(String(raw.mobile));
    if (out.mobile === null)
      issues.error({ code: 'MOBILE_INVALID', value: String(raw.mobile) }, rowNumber);
  }
  if (raw.candidateCategory !== null) {
    out.candidateCategory = parseCandidateCategory(String(raw.candidateCategory));
    if (out.candidateCategory === null)
      issues.error(
        { code: 'CANDIDATE_CATEGORY_INVALID', value: String(raw.candidateCategory) },
        rowNumber,
      );
  }
  out.address = checkText(raw.address, 'address', rowNumber, issues);
  out.occupation = checkText(raw.occupation, 'occupation', rowNumber, issues);
  return issues.errors.length === before ? out : null;
}

/** The details as a form sends them (null, '' or left out = empty). */
export interface FormDetails {
  dob?: string | null | undefined;
  ageStated?: number | null | undefined;
  education?: string | null | undefined;
  mobile?: string | null | undefined;
  candidateCategory?: string | null | undefined;
  address?: string | null | undefined;
  occupation?: string | null | undefined;
}

const blank = (v: string | null | undefined) =>
  v === undefined || v === null || v.trim() === '' ? null : v;

export const formDetails = (f: FormDetails): RawDetails => ({
  dob: blank(f.dob),
  age: f.ageStated ?? null,
  education: blank(f.education),
  mobile: blank(f.mobile),
  candidateCategory: blank(f.candidateCategory),
  address: blank(f.address),
  occupation: blank(f.occupation),
});

export const sameDetails = (a: CandidateDetails, b: CandidateDetails): boolean =>
  a.dob === b.dob &&
  a.ageStated === b.ageStated &&
  a.education === b.education &&
  a.mobile === b.mobile &&
  a.candidateCategory === b.candidateCategory &&
  a.address === b.address &&
  a.occupation === b.occupation;

/** For the audit log: never the whole mobile number. */
export const detailsForAudit = (d: CandidateDetails) => ({
  dob: d.dob,
  age_stated: d.ageStated,
  education: d.education,
  mobile_last4: phoneLast4(d.mobile),
  candidate_category: d.candidateCategory,
  address: d.address,
  occupation: d.occupation,
});

/** mysql2 returns VARCHAR and DATE_FORMAT values as strings; anything else is no value. */
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** A DB row read with DETAIL_COLUMNS_SQL. */
export function detailsFromRow(r: RowDataPacket): CandidateDetails {
  return {
    dob: textOrNull(r.dob),
    ageStated: r.age_stated === null ? null : Number(r.age_stated),
    education: r.education === null ? null : (String(r.education) as Education),
    mobile: textOrNull(r.mobile),
    candidateCategory:
      r.candidate_category === null || r.candidate_category === undefined
        ? null
        : (String(r.candidate_category) as CandidateCategory),
    address: textOrNull(r.address),
    occupation: textOrNull(r.occupation),
  };
}
