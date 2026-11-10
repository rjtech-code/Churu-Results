// Pure rules for "नाम सुधारें": the name-only correction of a candidate after the ballot is locked.
// Only the name changes (candidate.name_hindi, the one and only name column); party, symbol, order,
// gender, details, NOTA and the list itself stay frozen by the lock.
import { MAX_NAME_LENGTH } from './master-data/candidates.js';
import { normalizeText } from './master-data/text.js';

export { MAX_NAME_LENGTH };

/**
 * Characters never allowed in a name: control characters (also tab / new line: a name is one line),
 * lone surrogates, zero-width space, word joiner and invisible operators, BOM, the direction marks and
 * the bidi embedding / override / isolate controls (they can make a name display differently from
 * what is stored). ZWNJ (U+200C) and ZWJ (U+200D) stay allowed: Hindi spelling uses them.
 */
const FORBIDDEN = /[\p{Cc}\p{Cs}​‎‏‪-‮⁠-⁤⁦-⁩﻿]/u;

export type NameProblem = 'NAME_EMPTY' | 'NAME_TOO_LONG' | 'NAME_INVALID_CHARS' | 'NAME_UNCHANGED';

export type NameCheck = { ok: true; name: string } | { ok: false; problem: NameProblem };

/**
 * Checks a typed new name against the current one. The name is stored normalized (NFC, inner
 * whitespace collapsed, trimmed), exactly like the importer and the RO list form store it, so "the
 * same name with an extra space" is NOT a change.
 */
export function checkNewName(typed: string, current: string): NameCheck {
  if (FORBIDDEN.test(typed)) return { ok: false, problem: 'NAME_INVALID_CHARS' };
  const name = normalizeText(typed);
  if (name === '') return { ok: false, problem: 'NAME_EMPTY' };
  // .length counts UTF-16 units, never fewer than MySQL's characters: the column always fits.
  if (name.length > MAX_NAME_LENGTH) return { ok: false, problem: 'NAME_TOO_LONG' };
  if (name === normalizeText(current)) return { ok: false, problem: 'NAME_UNCHANGED' };
  return { ok: true, name };
}
