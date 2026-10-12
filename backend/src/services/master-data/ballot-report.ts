// The printable ballot list for the two-person cross-check, shared by `npm run ballot:report` and the
// DM's "रिपोर्ट (Excel) डाउनलोड करें". Reads only.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { loadPanchayatSamitis, loadWards } from './lookups.js';
import type { WardRow } from './lookups.js';
import type { Cell, SheetSpec } from './xlsx.js';

export const BALLOT_REPORT_HEADERS = [
  'ward_no',
  'ward_id',
  'reservation_category',
  'locked',
  'ballot_position',
  'name_hindi',
  'party',
  'gender',
  'nota',
  'unopposed',
] as const;

/** Excel sheet names: max 31 chars, no []:*?/\ characters, unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name
    .replace(/ PANCHAYAT SAMITI$/i, '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .slice(0, 31)
    .trim();
  let candidate = base;
  for (let i = 2; used.has(candidate.toUpperCase()); i++) candidate = `${base.slice(0, 27)} (${i})`;
  used.add(candidate.toUpperCase());
  return candidate;
}

/**
 * One sheet per Panchayat Samiti (`ps`: all, none, or one PS id) and, when `includeZp`, a ZP sheet.
 * `lines` describes what was included (for the CLI report).
 */
export async function buildBallotReportSheets(
  db: Pool | PoolConnection,
  scope: { ps: 'ALL' | 'NONE' | number; includeZp: boolean },
): Promise<{ sheets: SheetSpec[]; lines: string[] }> {
  const psByName = await loadPanchayatSamitis(db);
  const wards = await loadWards(db);
  const [candidates] = await db.query<RowDataPacket[]>(
    `SELECT c.ward_id, c.ballot_position, c.name_hindi, c.gender, c.is_nota,
            p.short_name, p.name_hindi AS party_hindi
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id
      ORDER BY c.ward_id, c.ballot_position`,
  );
  const byWard = new Map<number, RowDataPacket[]>();
  for (const c of candidates)
    byWard.set(Number(c.ward_id), [...(byWard.get(Number(c.ward_id)) ?? []), c]);

  const rowsFor = (list: WardRow[]): Cell[][] => {
    const rows: Cell[][] = [];
    for (const w of list) {
      const base: Cell[] = [
        w.ward_no,
        w.id,
        w.reservation_category,
        w.is_locked === 1 ? 'LOCKED' : 'open',
      ];
      const cands = byWard.get(w.id) ?? [];
      if (cands.length === 0) rows.push([...base, null, 'NO CANDIDATES', null, null, null, null]);
      for (const c of cands) {
        const nota = Number(c.is_nota) === 1;
        rows.push([
          ...base,
          Number(c.ballot_position),
          String(c.name_hindi),
          nota
            ? null
            : c.short_name === null
              ? 'निर्दलीय (independent)'
              : `${String(c.short_name)} — ${String(c.party_hindi)}`,
          c.gender === null ? null : String(c.gender),
          nota ? 'NOTA' : null,
          w.is_unopposed === 1 ? 'UNOPPOSED' : null,
        ]);
      }
    }
    return rows;
  };

  const sheets: SheetSpec[] = [];
  const lines: string[] = [];
  const used = new Set<string>();
  for (const ps of psByName.values()) {
    if (scope.ps === 'NONE' || (scope.ps !== 'ALL' && ps.id !== scope.ps)) continue;
    const list = wards.filter((w) => w.ward_type === 'PS' && w.panchayat_samiti_id === ps.id);
    sheets.push({
      name: sheetName(ps.name_english, used),
      headers: BALLOT_REPORT_HEADERS,
      rows: rowsFor(list),
    });
    lines.push(`${ps.name_english}: ${list.length} PS wards`);
  }
  if (scope.includeZp) {
    const zp = wards.filter((w) => w.ward_type === 'ZP');
    sheets.push({ name: sheetName('ZP', used), headers: BALLOT_REPORT_HEADERS, rows: rowsFor(zp) });
    lines.push(`ZP: ${zp.length} ZP wards`);
  }
  return { sheets, lines };
}
