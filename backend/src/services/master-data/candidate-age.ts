// A candidate's date of birth / stated age: parsing (Excel cell or form) and the age on
// AGE_REFERENCE_DATE. Part of the candidate details (candidate-details.ts re-exports these).
import { AGE_REFERENCE_DATE } from '../../config/election.js';

/** Sanity range only (not the legal minimum age, which the system does not enforce). */
export const MIN_AGE = 18;
export const MAX_AGE = 120;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a real calendar date, else null. */
export function calendarDate(y: number, m: number, d: number): string | null {
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
export function candidateAge(c: { dob: string | null; ageStated: number | null }): number | null {
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
export function shownDob(value: string | number): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(String(value));
  return iso ? `${iso[3] ?? ''}/${iso[2] ?? ''}/${iso[1] ?? ''}` : String(value);
}
