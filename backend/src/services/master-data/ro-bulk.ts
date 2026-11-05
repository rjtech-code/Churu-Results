// "Excel से RO जोड़ें": the rules for one sheet of new RO accounts (pure, no database).
// Each row becomes NEW (an account will be created), EXISTS (the seat or the mobile number already
// belongs to an RO account: skipped, never overwritten) or ERROR (with simple Hindi reasons).
// The account rules themselves (name, mobile, one account per seat) are the existing ones.
import { MAX_FULL_NAME_LENGTH, PHONE_ERROR, normalizePhone } from './accounts.js';
import type { Role } from './accounts.js';
import { psHi } from './issues-hi.js';
import type { PsRow } from './lookups.js';
import { matchKey, normalizeText } from './text.js';
import type { SheetRow } from './xlsx.js';

export const RO_BULK_COLUMNS = ['election', 'panchayat_samiti', 'full_name', 'mobile'] as const;
type RoBulkColumn = (typeof RO_BULK_COLUMNS)[number];
export const RO_BULK_SHEET = 'ro_list';
/** Data rows in one file. Only 14 seats exist, so a real file is far smaller. */
export const RO_BULK_MAX_ROWS = 200;

export const RO_BULK_COLUMN_NOTES: Readonly<Record<RoBulkColumn, string>> = {
  election: 'PS या ZP',
  panchayat_samiti: 'Panchayat Samiti का नाम (English या Hindi); ZP के लिए खाली',
  full_name: 'RO का नाम',
  mobile: '10 अंकों का मोबाइल नंबर',
};

export type RoRowStatus = 'NEW' | 'EXISTS' | 'ERROR';

export interface RoBulkRow {
  rowNumber: number;
  status: RoRowStatus;
  /** "PS:<id>" or "ZP" once the seat is known. */
  seat: string | null;
  /** "चूरू पंचायत समिति" / "ज़िला परिषद", as on the RO list page. */
  seatLabel: string | null;
  fullName: string | null;
  phone: string | null;
  /** Why the row is ERROR or EXISTS (Hindi). Empty for NEW. */
  reasons: string[];
}

/** What is already in the database (every RO account counts, disabled and replaced ones too). */
export interface ExistingRo {
  role: Role;
  psId: number | null;
  phone: string | null;
}

export const EXISTS_TEXT = 'पहले से मौजूद है, छोड़ा गया';
export const ZP_LABEL = 'ज़िला परिषद';

/** "CHURU PANCHAYAT SAMITI", "Churu", "पंचायत समिति चूरू" and "चूरू" all give the same key. */
function psMatchKey(name: string): string {
  return normalizeText(
    matchKey(name)
      .replace(/PANCHAYAT\s+SAMITI/gu, ' ')
      .replace(/पंचायत\s+समिति/gu, ' '),
  );
}

/** Finds the PS by its English or Hindi name (with or without "पंचायत समिति"). */
export function findPs(text: string, psList: readonly PsRow[]): PsRow[] {
  const key = psMatchKey(text);
  if (key === '') return [];
  return psList.filter(
    (ps) => psMatchKey(ps.name_english) === key || psMatchKey(ps.name_hindi) === key,
  );
}

const cellText = (row: SheetRow, column: RoBulkColumn): string | null => {
  const value = row.cells[column] ?? null;
  if (value === null) return null;
  const text = normalizeText(String(value));
  return text === '' ? null : text;
};

/** Reads and checks one row on its own (no duplicate / existing checks yet). */
function readRow(row: SheetRow, psList: readonly PsRow[]): RoBulkRow {
  const out: RoBulkRow = {
    rowNumber: row.rowNumber,
    status: 'ERROR',
    seat: null,
    seatLabel: null,
    fullName: null,
    phone: null,
    reasons: [],
  };
  if (row.allText.some((t) => t.toUpperCase().includes('EXAMPLE'))) {
    out.reasons.push('यह उदाहरण (EXAMPLE) वाली पंक्ति है — इसे Excel से हटाएँ');
    return out;
  }

  const election = cellText(row, 'election')?.toUpperCase() ?? null;
  const psText = cellText(row, 'panchayat_samiti');
  if (election === null) out.reasons.push('"चुनाव (PS / ZP)" खाली है');
  else if (election === 'ZP') {
    if (psText !== null)
      out.reasons.push('ज़िला परिषद (ZP) के RO के लिए "पंचायत समिति" खाली छोड़ें');
    else {
      out.seat = 'ZP';
      out.seatLabel = ZP_LABEL;
    }
  } else if (election === 'PS') {
    if (psText === null) out.reasons.push('"पंचायत समिति" खाली है');
    else {
      const found = findPs(psText, psList);
      const ps = found[0];
      if (ps === undefined || found.length > 1)
        out.reasons.push(`पंचायत समिति "${psText}" का नाम सूची से मेल नहीं खाता — सही नाम लिखें`);
      else {
        out.seat = `PS:${ps.id}`;
        out.seatLabel = psHi(ps.name_hindi);
      }
    }
  } else out.reasons.push(`"चुनाव (PS / ZP)" में PS या ZP लिखें, लिखा है "${election}"`);

  const fullName = cellText(row, 'full_name');
  if (fullName === null) out.reasons.push('"RO का नाम" खाली है');
  else if (fullName.length < 2 || fullName.length > MAX_FULL_NAME_LENGTH)
    out.reasons.push(`"RO का नाम" 2 से ${MAX_FULL_NAME_LENGTH} अक्षरों का होना चाहिए`);
  else out.fullName = fullName;

  const mobile = cellText(row, 'mobile');
  if (mobile === null) out.reasons.push('"मोबाइल" खाली है');
  else {
    const phone = normalizePhone(mobile);
    if (phone === null) out.reasons.push(`${PHONE_ERROR} (लिखा है "${mobile}")`);
    else out.phone = phone;
  }

  if (out.reasons.length === 0) out.status = 'NEW';
  return out;
}

const seatOf = (a: ExistingRo): string => (a.role === 'ZP_RO' ? 'ZP' : `PS:${String(a.psId ?? 0)}`);

/**
 * Every row with its status. Order of the checks: the row itself, then "already in the database"
 * (skip), then the same seat or mobile number twice in the file (error for every such row).
 */
export function checkRoRows(
  rows: readonly SheetRow[],
  psList: readonly PsRow[],
  existing: readonly ExistingRo[],
): RoBulkRow[] {
  const takenSeats = new Set(existing.map(seatOf));
  const takenPhones = new Set(existing.flatMap((a) => (a.phone === null ? [] : [a.phone])));
  const checked = rows.map((r) => readRow(r, psList));

  for (const row of checked) {
    if (row.status !== 'NEW') continue;
    if (row.seat !== null && takenSeats.has(row.seat)) {
      row.status = 'EXISTS';
      row.reasons.push(`${EXISTS_TEXT} — इस पद का RO खाता पहले से बना है`);
    } else if (row.phone !== null && takenPhones.has(row.phone)) {
      row.status = 'EXISTS';
      row.reasons.push(`${EXISTS_TEXT} — यह मोबाइल नंबर पहले से किसी RO खाते में है`);
    }
  }

  const fresh = checked.filter((r) => r.status === 'NEW');
  const repeated = (key: (r: RoBulkRow) => string | null, what: string) => {
    const byKey = new Map<string, RoBulkRow[]>();
    for (const r of fresh) {
      const k = key(r);
      if (k !== null) byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const list = group.map((r) => r.rowNumber).join(', ');
      for (const r of group) {
        r.status = 'ERROR';
        r.reasons.push(`${what} फ़ाइल में एक से अधिक बार है (पंक्ति ${list})`);
      }
    }
  };
  repeated((r) => r.seat, 'यह पद');
  repeated((r) => r.phone, 'यह मोबाइल नंबर');
  return checked;
}

export interface RoBulkTotals {
  total: number;
  create: number;
  exists: number;
  errors: number;
}

export function roBulkTotals(rows: readonly RoBulkRow[]): RoBulkTotals {
  const count = (s: RoRowStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    create: count('NEW'),
    exists: count('EXISTS'),
    errors: count('ERROR'),
  };
}
