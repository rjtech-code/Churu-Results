// Which official form a ward may get, from the result engine's view of it. Pure. The route turns a
// refusal into an ApiError; the frontend asks the same rule (GET /api/ward-forms/:wardId), so the
// rule lives only here.
import type { WardResult } from '../result.js';
import { WARD_FORMS } from './templates/registry.js';
import type { WardFormName } from './templates/registry.js';

export type FormRefusal =
  'NOT_DECLARED' | 'WARD_UNOPPOSED' | 'DECLARATION_MISMATCH' | 'TOO_MANY_CANDIDATES';

/** Every refusal is a conflict with the ward's current state. */
export const REFUSAL_STATUS = 409;

const DECLARED = new Set<WardResult['status']>(['DECLARED', 'TIE_RESOLVED']);

/**
 * Null when `form` may be printed for this ward. Uncontested wards get Prarup-7 only (there was no
 * count). A declaration the current votes no longer match is never printed.
 */
export function formRefusal(
  form: WardFormName,
  result: WardResult,
  candidateCount: number,
): FormRefusal | null {
  const spec = WARD_FORMS[form];
  if (result.status === 'UNOPPOSED') {
    if (!spec.forUnopposed) return 'WARD_UNOPPOSED';
  } else if (!DECLARED.has(result.status)) {
    return 'NOT_DECLARED';
  } else if (result.declarationMismatch) {
    return 'DECLARATION_MISMATCH';
  }
  return candidateCount > spec.capacity(result.kind) ? 'TOO_MANY_CANDIDATES' : null;
}
