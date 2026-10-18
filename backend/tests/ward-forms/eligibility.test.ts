// Which ward gets which official form (pure rule shared by the API and the buttons).
import { describe, expect, it } from 'vitest';
import { formRefusal } from '../../src/services/ward-forms/eligibility.js';
import { PART2_MAX_CANDIDATES } from '../../src/services/ward-forms/templates/part2.template.js';
import { PRARUP7_MAX_CANDIDATES } from '../../src/services/ward-forms/templates/prarup7.template.js';
import { formSource } from './source.js';

const refusal = (form: 'part2' | 'prarup7', o: Parameters<typeof formSource>[0]) => {
  const src = formSource(o);
  return formRefusal(form, src.result, src.candidates.length);
};

describe('ward form eligibility', () => {
  it('a declared ward gets both forms, ZP and PS alike', () => {
    for (const kind of ['ZP', 'PS'] as const) {
      expect(refusal('part2', { kind })).toBeNull();
      expect(refusal('prarup7', { kind })).toBeNull();
    }
  });

  it('an undeclared ward gets no form', () => {
    expect(refusal('part2', { declared: false })).toBe('NOT_DECLARED');
    expect(refusal('prarup7', { declared: false })).toBe('NOT_DECLARED');
  });

  it('an uncontested ward: Prarup-7 only (there was no count for Part-II)', () => {
    expect(refusal('prarup7', { unopposed: true })).toBeNull();
    expect(refusal('part2', { unopposed: true })).toBe('WARD_UNOPPOSED');
  });

  it('a declaration the current votes no longer match is never printed', () => {
    const src = formSource();
    const mismatched = { ...src.result, declarationMismatch: true };
    expect(formRefusal('part2', mismatched, 2)).toBe('DECLARATION_MISMATCH');
    expect(formRefusal('prarup7', mismatched, 2)).toBe('DECLARATION_MISMATCH');
  });

  it('more candidates than one page holds is refused (named limits)', () => {
    const src = formSource();
    expect(formRefusal('prarup7', src.result, PRARUP7_MAX_CANDIDATES)).toBeNull();
    expect(formRefusal('prarup7', src.result, PRARUP7_MAX_CANDIDATES + 1)).toBe(
      'TOO_MANY_CANDIDATES',
    );
    expect(formRefusal('part2', src.result, PART2_MAX_CANDIDATES)).toBeNull();
    expect(formRefusal('part2', src.result, PART2_MAX_CANDIDATES + 1)).toBe('TOO_MANY_CANDIDATES');
  });
});
