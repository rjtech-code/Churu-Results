// Booth numbers: a whole number plus an optional capital-letter suffix ("12", "12A").
// The database keeps them in two columns (booth_no SMALLINT, booth_suffix VARCHAR(2), '' = none);
// everything shown to people or sent by the API is the label, "12A". Order: 12, 12A, 12B, 13.

export interface BoothNo {
  no: number;
  suffix: string;
}

const BOOTH_NO_RE = /^([1-9]\d{0,4})([A-Z]{0,2})$/u;
const MAX_BOOTH_NO = 65_535; // SMALLINT UNSIGNED

/** "12A" / "12" / 12 -> { no, suffix }; null for anything else ("0", "12a", "A12", "12 A", 1.5). */
export function parseBoothNo(value: unknown): BoothNo | null {
  const text =
    typeof value === 'number' ? (Number.isSafeInteger(value) ? String(value) : '') : value;
  if (typeof text !== 'string') return null;
  const match = BOOTH_NO_RE.exec(text.trim());
  if (!match) return null;
  const no = Number(match[1]);
  if (no > MAX_BOOTH_NO) return null;
  return { no, suffix: match[2] ?? '' };
}

/** The label shown everywhere: 12 + 'A' -> "12A". */
export function boothLabel(no: number, suffix: string): string {
  return `${String(no)}${suffix}`;
}

/**
 * Label from a DB row that selected `booth_no` AND `booth_suffix`. Throws when booth_suffix is
 * missing, so a query that forgot the column fails loudly instead of showing "12" for "12A".
 */
export function boothLabelOf(row: Readonly<Record<string, unknown>>): string {
  if (typeof row.booth_suffix !== 'string') {
    throw new Error('internal: booth_suffix was not selected with booth_no');
  }
  return boothLabel(Number(row.booth_no), row.booth_suffix);
}

/** Sort order of two labels or BoothNo values: by number, then suffix ('' first). */
export function compareBoothNo(a: string | BoothNo, b: string | BoothNo): number {
  const pa = typeof a === 'string' ? parseBoothNo(a) : a;
  const pb = typeof b === 'string' ? parseBoothNo(b) : b;
  if (pa === null || pb === null) throw new Error('internal: compareBoothNo on a bad booth number');
  if (pa.no !== pb.no) return pa.no - pb.no;
  return pa.suffix < pb.suffix ? -1 : pa.suffix > pb.suffix ? 1 : 0;
}
