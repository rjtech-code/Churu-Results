// The PDF layer (no database): script runs, fitting, and both forms on exactly one page.
import { describe, expect, it } from 'vitest';
import { FormDoesNotFitError, firstFit, scaledSize } from '../../src/services/pdf/fit.js';
import { splitRuns } from '../../src/services/pdf/text-runs.js';
import { mapPart2 } from '../../src/services/ward-forms/map-part2.js';
import { mapPrarup7 } from '../../src/services/ward-forms/map-prarup7.js';
import { renderPart2 } from '../../src/services/ward-forms/render-part2.js';
import { renderPrarup7 } from '../../src/services/ward-forms/render-prarup7.js';
import {
  PART2,
  PART2_MAX_CANDIDATES,
} from '../../src/services/ward-forms/templates/part2.template.js';
import { PRARUP7_MAX_CANDIDATES } from '../../src/services/ward-forms/templates/prarup7.template.js';
import { formSource, pageCount, prarup7For } from './source.js';

/** About as long as the official sample's addresses ("ग्राम पोस्ट- साण्डन, तह.- सुजानगढ़, जिला- चूरू"). */
const ADDRESS = 'ग्राम पोस्ट- साण्डन, वार्ड संख्या 12, तह.- सुजानगढ़, जिला- चूरू';
const FULL = {
  address: ADDRESS,
  candidateCategory: 'OBC' as const,
  education: 'SR_SECONDARY' as const,
  ageStated: 44,
  occupation: 'स्वयं का व्यवसाय',
};

const prarup7 = (o: Parameters<typeof formSource>[0] = {}) => {
  const t = prarup7For(o.kind ?? 'ZP');
  return renderPrarup7(mapPrarup7(formSource(o), t), t);
};
const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

describe('script runs', () => {
  it('splits Hindi from Latin text; spaces stay with their run', () => {
    expect(splitRuns('जिला :- चूरू')).toEqual([
      { script: 'deva', text: 'जिला ' },
      { script: 'latin', text: ':- ' },
      { script: 'deva', text: 'चूरू' },
    ]);
    expect(splitRuns(' 05 से')).toEqual([
      { script: 'latin', text: ' 05 ' },
      { script: 'deva', text: 'से' },
    ]);
    // Conjuncts and matras stay whole (virama, ZWJ).
    expect(splitRuns('क्ष्‍ति')).toEqual([{ script: 'deva', text: 'क्ष्‍ति' }]);
    expect(splitRuns('')).toEqual([]);
  });
});

describe('fitting on one page', () => {
  const steps = [
    { spacing: 1, font: 1 },
    { spacing: 0.5, font: 1 },
    { spacing: 0.5, font: 0.8 },
  ];
  it('takes the first step that fits (spacing before type size)', () => {
    expect(firstFit(steps, (s) => 100 * s.spacing * s.font, 60)).toEqual(steps[1]);
    expect(firstFit(steps, (s) => 100 * s.spacing * s.font, 40)).toEqual(steps[2]);
    expect(firstFit(steps, () => 1000, 40)).toBeNull();
  });
  it('never sets type below the minimum', () => {
    expect(scaledSize(10, { spacing: 1, font: 0.5 }, 7)).toBe(7);
    expect(scaledSize(10, { spacing: 1, font: 0.9 }, 7)).toBe(9);
  });
});

describe('Prarup-7 PDF', () => {
  const cases = (['ZP', 'PS'] as const).flatMap((kind) =>
    [2, 10, PRARUP7_MAX_CANDIDATES].map((n) => [kind, n] as const),
  );
  it.each(cases)('%s ward, %i candidates: one A4 landscape page', async (kind, n) => {
    const pdf = await prarup7({
      kind,
      candidates: n,
      details: Array.from({ length: n }, () => FULL),
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBe(1);
  });
  it.each(['ZP', 'PS'] as const)('%s uncontested ward: one page', async (kind) => {
    expect(pageCount(await prarup7({ kind, unopposed: true, details: [FULL] }))).toBe(1);
  });
  it('text that cannot fit one page is refused, never cut or spilled to a second page', async () => {
    const huge = { ...FULL, address: `${ADDRESS} `.repeat(6) };
    await expect(
      prarup7({
        candidates: PRARUP7_MAX_CANDIDATES,
        details: Array.from({ length: PRARUP7_MAX_CANDIDATES }, () => huge),
      }),
    ).rejects.toBeInstanceOf(FormDoesNotFitError);
  });
});

describe('Part-II PDF', () => {
  it.each([2, 10, PART2_MAX_CANDIDATES])('%i candidates: one A4 page', async (n) => {
    const pdf = await renderPart2(mapPart2(formSource({ candidates: n }), PART2), PART2);
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBe(1);
  });
});
