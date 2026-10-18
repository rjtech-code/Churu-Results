// The shape of a form template: every printed word, label map, size and width of one official
// form. A new form or a new version (e.g. the Panchayat Samiti Prarup-7) is a new template object,
// not new code.
import type { CandidateCategory, Education } from '../../master-data/candidate-details.js';
import type { PageSpec } from '../../pdf/document.js';
import type { FitStep } from '../../pdf/fit.js';
import type { LatinFamily, TextStyle } from '../../pdf/fonts.js';

/** Table rules and cell padding, in pt. Padding and row heights shrink with the fit step. */
export interface TableLayout {
  /** Relative column widths (scaled to the table width). */
  widths: readonly number[];
  padX: number;
  padY: number;
  minRowHeight: number;
  lineWidth: number;
}

interface PageTemplate {
  /** The PDF's title (document properties). */
  title: string;
  page: PageSpec;
  latin: LatinFamily;
  /** The most candidates the page holds (a longer list is refused, never cut). */
  maxCandidates: number;
  /** Tried in order until the form fits one page: spacing first, then type size. */
  fitSteps: readonly FitStep[];
  /** No text is set smaller than this, whatever the step. */
  minFontSize: number;
}

export interface Part2Template extends PageTemplate {
  text: {
    rules: string;
    part: string;
    caption: string;
    headers: readonly [string, string, string];
    nota: string;
    total: string;
    tally: string;
    place: string;
    date: string;
    supervisor: string;
    agents: string;
    fullSignature: string;
    /** Numbered agent lines (1. … n.), then dotted lines. */
    agentLines: number;
    dottedLines: number;
    dots: string;
    returningOfficer: string;
    footnote: string;
  };
  style: Record<'rules' | 'part' | 'caption' | 'header' | 'cell' | 'body' | 'footnote', TextStyle>;
  table: TableLayout & { width: number };
  /** Vertical space after each block, in pt (scaled by the fit step). */
  gaps: Record<
    'rules' | 'part' | 'table' | 'tally' | 'place' | 'agents' | 'agentLine' | 'footnote' | 'rule',
    number
  >;
  /** Indent of the agent list and of the Place / Date lines, in pt. */
  indent: number;
  /** Horizontal slots as fractions of the width: the signature column and the agents' heading. */
  slots: { signatureFrom: number; agentsFrom: number; agentsWidth: number };
  /** "1." in the S. No. column. */
  serial: (n: number) => string;
}

/** How printed values are composed, e.g. "1. नाम" and "(पार्टी)". */
export interface Prarup7Formats {
  numbered: (n: number, text: string) => string;
  bracketed: (text: string) => string;
  /** Between the lines of one cell. */
  lineBreak: string;
  /** A header item: its label, then its value. */
  labelled: (label: string, value: string) => string;
  /** Between the names of a list (the header's Panchayat Samitis). */
  listSeparator: string;
  /** A YYYY-MM-DD date as printed. */
  date: (iso: string) => string;
}

/** A value printed in the Prarup-7 header line. */
export type HeaderValue =
  'bodyName' | 'wardCount' | 'panchayatSamitis' | 'district' | 'electionDate';

/** One "label value" item of the header line, starting at `at` (a fraction of the width). */
export interface HeaderItem {
  label: string;
  value: HeaderValue;
  at: number;
}

/**
 * What differs between the Zila Parishad and the Panchayat Samiti Prarup-7: the body's name in the
 * printed words, the rule numbers, the header items and the Returning Officer's block.
 */
export interface Prarup7Level {
  title: string;
  /** In running text ("जिला परिषद सदस्य") and in the formal spelling ("जिला परिषद्"). */
  body: string;
  bodyFormal: string;
  /** Rule numbers as printed; a level that cannot verify them prints a blank to fill by hand. */
  rules: { form: string; uncontested: string; lot: string };
  header: readonly { value: HeaderValue; at: number }[];
  /** Null: the designation line is left blank for hand filling. */
  roDesignation: string | null;
  /** The place below the signature: the district's name, or null (blank). */
  signaturePlace: 'district' | null;
}

export interface Prarup7Template extends PageTemplate {
  /** Where the place below the Returning Officer's signature comes from (null = blank). */
  signaturePlace: Prarup7Level['signaturePlace'];
  text: {
    form: string;
    rules: string;
    heading: string;
    office: string;
    header: readonly HeaderItem[];
    columns: {
      ward: string;
      uncontested: string;
      contested: string;
      particulars: string;
      letters: readonly [string, string, string, string, string, string];
      particularHeads: readonly [string, string, string, string, string, string];
      votes: string;
      rejected: string;
      lot: string;
      remarks: string;
    };
    columnNumbers: readonly string[];
    notaName: string;
    notaNote: string;
    /** Printed where the form shows a dash ("none"). */
    none: string;
    /** क्रम संख्या of the declaration's only row. */
    declarationSerial: string;
    /** PLACEHOLDER.ward is replaced by the padded ward number. */
    declaration: string;
    declarationColumns: readonly [string, string, string, string, string, string, string];
    declarationNumbers: readonly string[];
    /** PLACEHOLDER.name is replaced by the body's name (the district, or the Panchayat Samiti). */
    declarationOffice: string;
    place: string;
    date: string;
    /** The Returning Officer's block; an empty line is left blank for hand filling. */
    signature: readonly string[];
  };
  labels: {
    education: Readonly<Record<Education, string>>;
    /** Column (ख), in words. */
    category: Readonly<Record<CandidateCategory, string>>;
    /** Declaration table "SC/ST/OBC/Gen". */
    declarationCategory: Readonly<Record<CandidateCategory, string>>;
    /** "F/M": any other gender is left blank. */
    gender: Readonly<Record<'M' | 'F', string>>;
    independent: string;
  };
  /** Space kept free at the right of each header slot, in pt. */
  headerGutter: number;
  /** Where the Returning Officer's block starts (a fraction of the width); स्थान / दिनांक before. */
  footerSplit: number;
  formats: Prarup7Formats;
  /** Digits of the ward number in the declaration ("05"). */
  wardNoDigits: number;
  style: Record<
    | 'form'
    | 'rules'
    | 'heading'
    | 'office'
    | 'header'
    | 'columnHead'
    | 'columnNumber'
    | 'cell'
    | 'wardNo'
    | 'declaration'
    | 'declarationCell'
    | 'footer',
    TextStyle
  >;
  table: TableLayout;
  declarationTable: TableLayout;
  gaps: Record<
    | 'form'
    | 'rules'
    | 'heading'
    | 'office'
    | 'header'
    | 'table'
    | 'declaration'
    | 'declarationTable'
    | 'footerLine',
    number
  >;
}
