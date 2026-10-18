// Which template each official ward form uses for a PS ward and for a ZP ward (every form has one
// for each kind).
import { PART2 } from './part2.template.js';
import { PS_LEVEL, ZP_LEVEL } from './prarup7-levels.js';
import { prarup7Template } from './prarup7.template.js';
import type { Part2Template, Prarup7Template } from './types.js';

export const WARD_FORM_NAMES = ['part2', 'prarup7'] as const;
export type WardFormName = (typeof WARD_FORM_NAMES)[number];
export type WardKind = 'PS' | 'ZP';

export const PART2_TEMPLATES: Readonly<Record<WardKind, Part2Template>> = {
  PS: PART2,
  ZP: PART2,
};

export const PRARUP7_TEMPLATES: Readonly<Record<WardKind, Prarup7Template>> = {
  PS: prarup7Template(PS_LEVEL),
  ZP: prarup7Template(ZP_LEVEL),
};

export interface WardFormSpec {
  /** An uncontested ward had no count, so only forms without votes are printed for it. */
  forUnopposed: boolean;
  /** REPORT_EXPORTED audit `section`. */
  auditSection: string;
  /** Start of the downloaded file's name. */
  fileStem: string;
  /** The template's candidate limit for this ward kind (what one page holds). */
  capacity: (kind: WardKind) => number;
}

export const WARD_FORMS: Readonly<Record<WardFormName, WardFormSpec>> = {
  part2: {
    forUnopposed: false,
    auditSection: 'ward-form-part2',
    fileStem: 'Part-II',
    capacity: (kind) => PART2_TEMPLATES[kind].maxCandidates,
  },
  prarup7: {
    forUnopposed: true,
    auditSection: 'ward-form-prarup7',
    fileStem: 'Prarup-7',
    capacity: (kind) => PRARUP7_TEMPLATES[kind].maxCandidates,
  },
};
