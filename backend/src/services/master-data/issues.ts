// Master-data problems as data, not text. The rules (parties.ts, candidates.ts, cells.ts) report
// Issues; the CLI renders them in English (issues-en.ts, the exact Part 2 report text) and the web
// in simple Hindi (issues-hi.ts). One rule, two languages, never two copies of the rule.

/** The ward an issue is about, with both English (CLI) and Hindi (web) names. */
export interface WardRef {
  id: number;
  type: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  psNameHindi: string | null;
}

export type PartyField = 'name_hindi' | 'name_english' | 'short_name' | 'symbol';

export type IssueBody =
  // Cells (any sheet)
  | { code: 'CELL_EMPTY'; column: string }
  | { code: 'CELL_NOT_INT'; column: string; min: 0 | 1; value: string }
  // Parties
  | { code: 'PARTY_DUPLICATE_IN_FILE'; field: PartyField; value: string }
  | { code: 'PARTY_EXISTS_DIFFERENT'; shortName: string; fields: PartyField[] }
  | { code: 'PARTY_NAME_TAKEN'; field: PartyField; value: string; owner: string }
  | { code: 'PARTY_TOO_LONG'; field: PartyField; max: number }
  // Candidate rows
  | { code: 'EXAMPLE_ROW' }
  | { code: 'ELECTION_INVALID'; value: string }
  | { code: 'GENDER_INVALID'; value: string }
  | { code: 'PARTY_UNKNOWN'; value: string }
  | { code: 'PS_REQUIRED' }
  | { code: 'PS_UNKNOWN'; value: string }
  | { code: 'PS_WARD_UNKNOWN'; psName: string; psNameHindi: string; wardNo: number }
  | { code: 'ZP_WARD_UNKNOWN'; wardNo: number }
  | { code: 'ZP_PS_IGNORED' }
  | { code: 'NAME_TOO_LONG'; max: number }
  | { code: 'DOB_INVALID'; value: string }
  | { code: 'AGE_INVALID'; value: string }
  | { code: 'EDUCATION_INVALID'; value: string }
  | { code: 'MOBILE_INVALID'; value: string }
  // Per-ward candidate rules
  | { code: 'WARD_LOCKED'; ward: WardRef }
  | { code: 'WARD_HAS_ENTRIES'; ward: WardRef }
  | { code: 'POSITION_REPEATED'; ward: WardRef; position: number }
  | { code: 'POSITION_GAPS'; ward: WardRef; count: number; found: number[] }
  | { code: 'PARTY_TWICE'; ward: WardRef; party: string }
  | { code: 'CATEGORY_MIXED'; ward: WardRef; categories: string[] }
  | { code: 'TOO_MANY_CANDIDATES'; ward: WardRef; max: number };

export type IssueCode = IssueBody['code'];

/** One problem; `rows` are Excel row numbers (or form row numbers), may be empty. */
export type Issue = IssueBody & { rows: number[] };

/** Collects errors (block the save) and warnings (shown, never block). */
export class IssueList {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];

  error(body: IssueBody, rows: number | readonly number[] = []): void {
    this.errors.push({ ...body, rows: typeof rows === 'number' ? [rows] : [...rows] });
  }

  warn(body: IssueBody, rows: number | readonly number[] = []): void {
    this.warnings.push({ ...body, rows: typeof rows === 'number' ? [rows] : [...rows] });
  }

  isOk(): boolean {
    return this.errors.length === 0;
  }
}

export function wardRef(w: {
  id: number;
  ward_type: 'PS' | 'ZP';
  ward_no: number;
  ps_name: string | null;
  ps_name_hindi: string | null;
}): WardRef {
  return {
    id: w.id,
    type: w.ward_type,
    wardNo: w.ward_no,
    psName: w.ps_name,
    psNameHindi: w.ps_name_hindi,
  };
}
