// Optional candidate details for the ST Format returns (F15, F18, F19, F19A): date of birth (or the
// stated age), education and mobile. One set of rules for the Excel import, the RO form and the
// DM's details edit. Private: only the DM and the ward's own RO ever see them (never public screens,
// the public API or the existing reports).
import type { RowDataPacket } from 'mysql2/promise';
import { AGE_REFERENCE_DATE } from '../../config/election.js';
import { normalizePhone, phoneLast4 } from './accounts.js';
import type { IssueList } from './issues.js';
import { normalizeText } from './text.js';

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

const EDUCATION_EN: Readonly<Record<Education, string>> = {
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

/** "Illiterate, Literate, …" for the English (CLI) messages. */
export const EDUCATION_NAMES_EN = EDUCATIONS.map((e) => EDUCATION_EN[e]).join(', ');

/** Sanity range only (not the legal minimum age, which the system does not enforce). */
export const MIN_AGE = 18;
export const MAX_AGE = 120;

export interface CandidateDetails {
  /** YYYY-MM-DD. When set, age_stated is NULL. */
  dob: string | null;
  ageStated: number | null;
  education: Education | null;
  /** 10 digits, 6-9 first. */
  mobile: string | null;
}

export const NO_DETAILS: CandidateDetails = {
  dob: null,
  ageStated: null,
  education: null,
  mobile: null,
};

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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a real calendar date, else null. */
function calendarDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y)}-${pad2(m)}-${pad2(d)}`;
}

function ymd(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Whole years completed on `on` (both YYYY-MM-DD). */
export function ageOn(dob: string, on: string = AGE_REFERENCE_DATE): number {
  const [by, bm, bd] = ymd(dob);
  const [oy, om, od] = ymd(on);
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
}

/** The candidate's age on AGE_REFERENCE_DATE: from the date of birth if known, else the stated age. */
export function candidateAge(c: Pick<CandidateDetails, 'dob' | 'ageStated'>): number | null {
  return c.dob !== null ? ageOn(c.dob) : c.ageStated;
}

const ageInRange = (age: number) => age >= MIN_AGE && age <= MAX_AGE;

/**
 * Date of birth from an Excel cell or a form: DD/MM/YYYY text (also with - or .), YYYY-MM-DD (the
 * form), or an Excel date cell (read as an ISO time at UTC midnight). Null when it is not a real
 * date or the age on AGE_REFERENCE_DATE is outside 18..120.
 */
export function parseDob(value: string | number): string | null {
  if (typeof value === 'number') return null;
  const text = value.trim();
  let date: string | null = null;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(text);
  if (dmy) date = calendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  else if (iso) date = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return date !== null && ageInRange(ageOn(date)) ? date : null;
}

export function parseAge(value: string | number): number | null {
  const text = String(value).trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const age = Number(text);
  return ageInRange(age) ? age : null;
}

/** DD/MM/YYYY for messages (an Excel date cell arrives as an ISO time). */
function shownValue(value: string | number): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(String(value));
  return iso ? `${iso[3] ?? ''}/${iso[2] ?? ''}/${iso[1] ?? ''}` : String(value);
}

export interface RawDetails {
  dob: string | number | null;
  age: string | number | null;
  education: string | number | null;
  mobile: string | number | null;
}

/**
 * Checks the raw values (null = empty). Both a date of birth and an age: the date of birth is kept
 * and the age ignored. Each wrong value is reported for `rowNumber`; then the result is null.
 */
export function checkDetails(
  raw: RawDetails,
  rowNumber: number,
  issues: IssueList,
): CandidateDetails | null {
  const before = issues.errors.length;
  const out: CandidateDetails = { ...NO_DETAILS };
  if (raw.dob !== null) {
    out.dob = parseDob(raw.dob);
    if (out.dob === null)
      issues.error({ code: 'DOB_INVALID', value: shownValue(raw.dob) }, rowNumber);
  } else if (raw.age !== null) {
    out.ageStated = parseAge(raw.age);
    if (out.ageStated === null)
      issues.error({ code: 'AGE_INVALID', value: String(raw.age) }, rowNumber);
  }
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
  return issues.errors.length === before ? out : null;
}

/** The details as a form sends them (null, '' or left out = empty). */
export interface FormDetails {
  dob?: string | null | undefined;
  ageStated?: number | null | undefined;
  education?: string | null | undefined;
  mobile?: string | null | undefined;
}

const blank = (v: string | null | undefined) =>
  v === undefined || v === null || v.trim() === '' ? null : v;

export const formDetails = (f: FormDetails): RawDetails => ({
  dob: blank(f.dob),
  age: f.ageStated ?? null,
  education: blank(f.education),
  mobile: blank(f.mobile),
});

export const sameDetails = (a: CandidateDetails, b: CandidateDetails): boolean =>
  a.dob === b.dob &&
  a.ageStated === b.ageStated &&
  a.education === b.education &&
  a.mobile === b.mobile;

/** For the audit log: never the whole mobile number. */
export const detailsForAudit = (d: CandidateDetails) => ({
  dob: d.dob,
  age_stated: d.ageStated,
  education: d.education,
  mobile_last4: phoneLast4(d.mobile),
});

/** A DB row's columns (dob read with DATE_FORMAT '%Y-%m-%d'). */
export function detailsFromRow(r: RowDataPacket): CandidateDetails {
  return {
    dob: r.dob === null ? null : String(r.dob),
    ageStated: r.age_stated === null ? null : Number(r.age_stated),
    education: r.education === null ? null : (String(r.education) as Education),
    mobile: r.mobile === null ? null : String(r.mobile),
  };
}
