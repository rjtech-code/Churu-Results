// Fitting a form on one page: try the template's steps in order (less spacing first, then smaller
// type) and keep the first whose content fits. Pure.

/** Multipliers on the template's spacing and font sizes. */
export interface FitStep {
  spacing: number;
  font: number;
}

/** The first step whose measured height is within `available`; null when none fits. */
export function firstFit(
  steps: readonly FitStep[],
  measure: (step: FitStep) => number,
  available: number,
): FitStep | null {
  return steps.find((step) => measure(step) <= available) ?? null;
}

/** A font size scaled by the step, never below `min` (readability floor). */
export const scaledSize = (size: number, step: FitStep, min: number): number =>
  Math.max(min, size * step.font);

/** The page does not hold the form even at the smallest step. */
export class FormDoesNotFitError extends Error {
  override readonly name = 'FormDoesNotFitError';
  constructor(readonly form: string) {
    super(`${form} does not fit on one page`);
  }
}
