// Pure rules for "विवरण सुधारें": the correction of a candidate's details after the ballot is locked.
//
// EDITABLE after the lock: name, party, gender, the candidate's own category, date of birth / stated
// age, education, mobile, address, occupation.
// FROZEN for ever: the ballot position (क्रम), adding or removing a candidate, and NOTA. A request
// that carries one of those keys is refused with FIELD_FROZEN (the field is named in the message).
//
// Every change becomes one history row: { field, oldValue, newValue } as text, so the DM's history
// page and CSV say exactly which detail changed.
import { checkNewName } from './candidate-name.js';
import {
  CANDIDATE_CATEGORIES,
  EDUCATIONS,
  MAX_ADDRESS_LENGTH,
  MAX_OCCUPATION_LENGTH,
  MAX_AGE,
  MIN_AGE,
  parseCandidateCategory,
  parseDob,
  parseEducation,
} from './master-data/candidate-details.js';
import type {
  CandidateCategory,
  CandidateDetails,
  Education,
} from './master-data/candidate-details.js';
import { normalizePhone } from './master-data/accounts.js';
import { normalizeText } from './master-data/text.js';

export const CORRECTABLE_FIELDS = [
  'NAME',
  'PARTY',
  'GENDER',
  'CANDIDATE_CATEGORY',
  'DOB',
  'AGE_STATED',
  'EDUCATION',
  'MOBILE',
  'ADDRESS',
  'OCCUPATION',
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/** Hindi label of each detail, for the confirm step, the history page and the CSV. */
export const FIELD_HI: Readonly<Record<CorrectableField, string>> = {
  NAME: 'नाम',
  PARTY: 'पार्टी',
  GENDER: 'लिंग',
  CANDIDATE_CATEGORY: 'वर्ग (श्रेणी)',
  DOB: 'जन्म तिथि',
  AGE_STATED: 'उम्र',
  EDUCATION: 'शिक्षा',
  MOBILE: 'मोबाइल',
  ADDRESS: 'पता',
  OCCUPATION: 'व्यवसाय',
};

/**
 * Body keys that can never be corrected after the lock. The key the RO (or a hand-made request)
 * sent is named back, so the message is clear instead of a bare "strict" rejection.
 */
export const FROZEN_FIELD_KEYS: Readonly<Record<string, string>> = {
  ballotPosition: 'मतपत्र क्रम',
  ballotNo: 'मतपत्र क्रम',
  position: 'मतपत्र क्रम',
  order: 'मतपत्र क्रम',
  isNota: 'नोटा',
  nota: 'नोटा',
  candidates: 'उम्मीदवार जोड़ना / हटाना',
  add: 'उम्मीदवार जोड़ना',
  remove: 'उम्मीदवार हटाना',
  delete: 'उम्मीदवार हटाना',
  symbol: 'चुनाव चिह्न',
};

export type Gender = 'M' | 'F' | 'O';
const GENDER_HI: Readonly<Record<Gender, string>> = { M: 'पुरुष', F: 'महिला', O: 'अन्य' };

/** Everything a correction may touch, as it is stored. */
export interface CandidateFields extends CandidateDetails {
  name: string;
  /** null = निर्दलीय (independent). */
  partyId: number | null;
  partyShort: string | null;
  gender: Gender;
}

/** The patch a request sends: a key left out means "unchanged". */
export interface CandidatePatch {
  newName?: string | undefined;
  partyId?: number | null | undefined;
  gender?: string | undefined;
  candidateCategory?: string | null | undefined;
  dob?: string | null | undefined;
  ageStated?: number | null | undefined;
  education?: string | null | undefined;
  mobile?: string | null | undefined;
  address?: string | null | undefined;
  occupation?: string | null | undefined;
}

export interface FieldChange {
  field: CorrectableField;
  /** Text for the history row (null only when the detail was empty before). */
  oldValue: string | null;
  newValue: string | null;
}

/** The new stored values, plus one FieldChange per field that really changed. */
export interface DiffResult {
  next: CandidateFields;
  changes: FieldChange[];
}

export type FieldProblem =
  | { problem: string; field?: CorrectableField; max?: number }
  | { problem: 'PARTY_UNKNOWN'; field: 'PARTY' };

export class FieldError extends Error {
  constructor(
    readonly code: string,
    readonly field?: CorrectableField,
  ) {
    super(code);
    this.name = 'FieldError';
  }
}

const blank = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = normalizeText(v);
  return t === '' ? null : t;
};

/** The party as the history shows it: the short name, or निर्दलीय when there is none. */
export const partyText = (shortName: string | null): string => shortName ?? 'निर्दलीय';

/** How each field is written into old_value / new_value. */
export function fieldText(field: CorrectableField, f: CandidateFields): string | null {
  switch (field) {
    case 'NAME':
      return f.name;
    case 'PARTY':
      return partyText(f.partyShort);
    case 'GENDER':
      return GENDER_HI[f.gender];
    case 'CANDIDATE_CATEGORY':
      return f.candidateCategory;
    case 'DOB':
      return f.dob;
    case 'AGE_STATED':
      return f.ageStated === null ? null : String(f.ageStated);
    case 'EDUCATION':
      return f.education;
    case 'MOBILE':
      return f.mobile;
    case 'ADDRESS':
      return f.address;
    case 'OCCUPATION':
      return f.occupation;
  }
}

/**
 * Checks a patch against the stored values and returns the new values with one change per field.
 * Throws a FieldError (turned into a Hindi message by the API) for a bad value. The party is only
 * checked for shape here; that the party exists (and is not already used in this ward) is checked
 * against the database by the caller.
 */
export function diffCandidate(
  current: CandidateFields,
  patch: CandidatePatch,
  partyShortOf: (partyId: number | null) => string | null,
): DiffResult {
  const next: CandidateFields = { ...current };

  if (patch.newName !== undefined) {
    const check = checkNewName(patch.newName, current.name);
    // NAME_UNCHANGED is not a problem any more when other fields change: it just is no change.
    if (!check.ok && check.problem !== 'NAME_UNCHANGED') throw new FieldError(check.problem, 'NAME');
    if (check.ok) next.name = check.name;
  }
  if (patch.partyId !== undefined) {
    next.partyId = patch.partyId;
    next.partyShort = partyShortOf(patch.partyId);
  }
  if (patch.gender !== undefined) {
    if (patch.gender !== 'M' && patch.gender !== 'F' && patch.gender !== 'O') {
      throw new FieldError('GENDER_INVALID', 'GENDER');
    }
    next.gender = patch.gender;
  }
  if (patch.candidateCategory !== undefined) {
    const raw = blank(patch.candidateCategory);
    if (raw === null) next.candidateCategory = null;
    else {
      const parsed = parseCandidateCategory(raw);
      if (parsed === null) throw new FieldError('CANDIDATE_CATEGORY_INVALID', 'CANDIDATE_CATEGORY');
      next.candidateCategory = parsed;
    }
  }
  if (patch.dob !== undefined) {
    const raw = blank(patch.dob);
    if (raw === null) next.dob = null;
    else {
      const parsed = parseDob(raw);
      if (parsed === null) throw new FieldError('DOB_INVALID', 'DOB');
      next.dob = parsed;
    }
  }
  if (patch.ageStated !== undefined) {
    const age = patch.ageStated;
    if (age === null) next.ageStated = null;
    else {
      if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) {
        throw new FieldError('AGE_INVALID', 'AGE_STATED');
      }
      next.ageStated = age;
    }
  }
  // Date of birth wins over a stated age, exactly like the import and the list form.
  if (next.dob !== null) next.ageStated = null;
  if (patch.education !== undefined) {
    const raw = blank(patch.education);
    if (raw === null) next.education = null;
    else {
      const parsed = parseEducation(raw);
      if (parsed === null) throw new FieldError('EDUCATION_INVALID', 'EDUCATION');
      next.education = parsed;
    }
  }
  if (patch.mobile !== undefined) {
    const raw = blank(patch.mobile);
    if (raw === null) next.mobile = null;
    else {
      const parsed = normalizePhone(raw);
      if (parsed === null) throw new FieldError('MOBILE_INVALID', 'MOBILE');
      next.mobile = parsed;
    }
  }
  if (patch.address !== undefined) {
    const raw = blank(patch.address);
    if (raw !== null && raw.length > MAX_ADDRESS_LENGTH) {
      throw new FieldError('ADDRESS_TOO_LONG', 'ADDRESS');
    }
    next.address = raw;
  }
  if (patch.occupation !== undefined) {
    const raw = blank(patch.occupation);
    if (raw !== null && raw.length > MAX_OCCUPATION_LENGTH) {
      throw new FieldError('OCCUPATION_TOO_LONG', 'OCCUPATION');
    }
    next.occupation = raw;
  }

  const changes: FieldChange[] = [];
  for (const field of CORRECTABLE_FIELDS) {
    const before = fieldText(field, current);
    const after = fieldText(field, next);
    if (field === 'PARTY' ? current.partyId !== next.partyId : before !== after) {
      changes.push({ field, oldValue: before, newValue: after });
    }
  }
  return { next, changes };
}

export const EDUCATION_VALUES: readonly Education[] = EDUCATIONS;
export const CATEGORY_VALUES: readonly CandidateCategory[] = CANDIDATE_CATEGORIES;
