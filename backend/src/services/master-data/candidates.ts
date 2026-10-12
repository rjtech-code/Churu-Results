// Candidate-list rules, shared by `npm run import:candidates`, the DM's Excel upload and the RO's
// candidate form. The same rules everywhere:
//   ballot numbers 1..N, no gaps or repeats; at most one candidate per party per ward (independents
//   exempt); name and gender required; the ward unlocked with no counting entries.
//   NOTA is added automatically at N+1; exactly one candidate = unopposed (no NOTA).
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { optionalText, requireInt, requireText } from './cells.js';
import { wardRef } from './issues.js';
import type { IssueList } from './issues.js';
import { loadPanchayatSamitis, loadWards, wardKey, wardsWithEntries } from './lookups.js';
import type { PsRow, WardRow } from './lookups.js';
import { matchKey } from './text.js';
import type { SheetRow } from './xlsx.js';

export const CANDIDATE_COLUMNS = [
  'panchayat_samiti',
  'election',
  'ward_no',
  'ballot_position',
  'name_hindi',
  'party_short_name',
  'gender',
] as const;
export const OPTIONAL_CANDIDATE_COLUMNS = ['reservation_category'] as const;

/** Label of the NOTA row on every contested ballot. */
export const NOTA_NAME_HINDI = 'इनमें से कोई नहीं';

/** candidate.name_hindi VARCHAR(200); ward.reservation_category VARCHAR(50). */
export const MAX_NAME_LENGTH = 200;
export const MAX_CATEGORY_LENGTH = 50;
/**
 * A ballot must fit the counting sheet (at most 60 rows, NOTA included), so at most 59 candidates.
 * Checked on every path, so a list that could never be counted can never be saved.
 */
export const MAX_CANDIDATES_PER_WARD = 59;

export type Gender = 'M' | 'F' | 'O';
const GENDERS = new Set(['M', 'F', 'O']);

export interface CandidateInput {
  /** Excel row (upload) or form row (RO form). */
  rowNumber: number;
  position: number;
  nameHindi: string;
  partyId: number | null;
  partyShort: string | null;
  gender: Gender;
  category: string | null;
}

export interface CandidateLookups {
  psByName: Map<string, PsRow>;
  wards: WardRow[];
  wardByKey: Map<string, WardRow>;
  partyByShort: Map<string, { id: number; shortName: string }>;
  withEntries: Set<number>;
  /** Real (non-NOTA) candidates per ward today. */
  existingCount: Map<number, number>;
}

export async function loadCandidateLookups(db: Pool | PoolConnection): Promise<CandidateLookups> {
  const psByName = await loadPanchayatSamitis(db);
  const wards = await loadWards(db);
  const wardByKey = new Map(
    wards.map((w) => [wardKey(w.ward_type, w.panchayat_samiti_id, w.ward_no), w]),
  );
  const [partyRows] = await db.query<RowDataPacket[]>('SELECT id, short_name FROM party');
  const partyByShort = new Map(
    partyRows.map((p) => [
      matchKey(String(p.short_name)),
      { id: Number(p.id), shortName: String(p.short_name) },
    ]),
  );
  const withEntries = await wardsWithEntries(db);
  const [countRows] = await db.query<RowDataPacket[]>(
    'SELECT ward_id, COUNT(*) AS n FROM candidate WHERE is_nota = 0 GROUP BY ward_id',
  );
  const existingCount = new Map(countRows.map((r) => [Number(r.ward_id), Number(r.n)]));
  return { psByName, wards, wardByKey, partyByShort, withEntries, existingCount };
}

export interface WardList {
  ward: WardRow;
  rows: CandidateInput[];
}

/** Excel rows -> candidates grouped by ward. Row problems are reported; such rows are skipped. */
export function parseCandidateSheet(
  rows: readonly SheetRow[],
  lk: CandidateLookups,
  issues: IssueList,
): Map<number, WardList> {
  const byWard = new Map<number, WardList>();
  for (const row of rows) {
    if (row.allText.some((t) => /EXAMPLE/i.test(t))) {
      issues.error({ code: 'EXAMPLE_ROW' }, row.rowNumber);
      continue;
    }
    const before = issues.errors.length;
    const election = requireText(row, 'election', issues)?.toUpperCase() ?? null;
    const wardNo = requireInt(row, 'ward_no', issues, 1);
    const position = requireInt(row, 'ballot_position', issues, 1);
    const nameHindi = requireText(row, 'name_hindi', issues);
    const gender = requireText(row, 'gender', issues)?.toUpperCase() ?? null;
    const partyShort = optionalText(row, 'party_short_name');
    const category = optionalText(row, 'reservation_category');
    const psName = optionalText(row, 'panchayat_samiti');

    if (election !== null && election !== 'PS' && election !== 'ZP') {
      issues.error({ code: 'ELECTION_INVALID', value: election }, row.rowNumber);
    }
    if (gender !== null && !GENDERS.has(gender)) {
      issues.error({ code: 'GENDER_INVALID', value: gender }, row.rowNumber);
    }
    if (nameHindi !== null && nameHindi.length > MAX_NAME_LENGTH) {
      issues.error({ code: 'NAME_TOO_LONG', max: MAX_NAME_LENGTH }, row.rowNumber);
    }
    let partyId: number | null = null;
    if (partyShort !== null) {
      partyId = lk.partyByShort.get(matchKey(partyShort))?.id ?? null;
      if (partyId === null)
        issues.error({ code: 'PARTY_UNKNOWN', value: partyShort }, row.rowNumber);
    }

    let ward: WardRow | undefined;
    if (election === 'PS' && wardNo !== null) {
      if (psName === null) {
        issues.error({ code: 'PS_REQUIRED' }, row.rowNumber);
      } else {
        const ps = lk.psByName.get(matchKey(psName));
        if (!ps) issues.error({ code: 'PS_UNKNOWN', value: psName }, row.rowNumber);
        else {
          ward = lk.wardByKey.get(wardKey('PS', ps.id, wardNo));
          if (!ward)
            issues.error(
              {
                code: 'PS_WARD_UNKNOWN',
                psName: ps.name_english,
                psNameHindi: ps.name_hindi,
                wardNo,
              },
              row.rowNumber,
            );
        }
      }
    } else if (election === 'ZP' && wardNo !== null) {
      if (psName !== null) issues.warn({ code: 'ZP_PS_IGNORED' }, row.rowNumber);
      ward = lk.wardByKey.get(wardKey('ZP', null, wardNo));
      if (!ward) issues.error({ code: 'ZP_WARD_UNKNOWN', wardNo }, row.rowNumber);
    }

    if (
      issues.errors.length !== before ||
      !ward ||
      position === null ||
      nameHindi === null ||
      gender === null
    ) {
      continue;
    }
    const group = byWard.get(ward.id) ?? { ward, rows: [] };
    group.rows.push({
      rowNumber: row.rowNumber,
      position,
      nameHindi,
      partyId,
      partyShort,
      gender: gender as Gender,
      category,
    });
    byWard.set(ward.id, group);
  }
  return byWard;
}

/**
 * The per-ward rules. `checkCategory` is true for Excel lists (the category column must agree on
 * every row); the RO form has no category (the DM sets it on the "बूथ / वार्ड" page).
 */
export function checkWardList(
  ward: WardRow,
  rows: readonly CandidateInput[],
  hasEntries: boolean,
  checkCategory: boolean,
  issues: IssueList,
): void {
  const ref = wardRef(ward);
  const allRows = rows.map((r) => r.rowNumber);
  if (ward.is_locked === 1) issues.error({ code: 'WARD_LOCKED', ward: ref }, allRows);
  if (hasEntries) issues.error({ code: 'WARD_HAS_ENTRIES', ward: ref }, allRows);
  if (rows.length > MAX_CANDIDATES_PER_WARD) {
    issues.error({ code: 'TOO_MANY_CANDIDATES', ward: ref, max: MAX_CANDIDATES_PER_WARD }, allRows);
  }

  const positions = new Map<number, number[]>();
  for (const r of rows)
    positions.set(r.position, [...(positions.get(r.position) ?? []), r.rowNumber]);
  for (const [position, rowNums] of positions) {
    if (rowNums.length > 1)
      issues.error({ code: 'POSITION_REPEATED', ward: ref, position }, rowNums);
  }
  const sorted = [...positions.keys()].sort((a, b) => a - b);
  if (sorted.some((pos, i) => pos !== i + 1)) {
    issues.error({ code: 'POSITION_GAPS', ward: ref, count: rows.length, found: sorted }, allRows);
  }

  const parties = new Map<number, CandidateInput[]>();
  for (const r of rows) {
    if (r.partyId !== null) parties.set(r.partyId, [...(parties.get(r.partyId) ?? []), r]);
  }
  for (const list of parties.values()) {
    if (list.length > 1) {
      issues.error(
        { code: 'PARTY_TWICE', ward: ref, party: list[0]?.partyShort ?? '' },
        list.map((r) => r.rowNumber),
      );
    }
  }

  if (checkCategory) {
    const categories = new Set(rows.map((r) => r.category ?? ''));
    if (categories.size > 1) {
      issues.error({ code: 'CATEGORY_MIXED', ward: ref, categories: [...categories] }, allRows);
    }
  }
}

/**
 * Replaces a ward's whole list: delete, insert in ballot order, NOTA at N+1 unless unopposed.
 * Call only after every check passed, inside the caller's transaction, with the ward row locked.
 * `category`: `{ set: value }` for an Excel list's reservation category, or 'keep' (RO form).
 * Any change clears the "list ready" mark: the new list has to be checked again.
 */
export async function replaceWardCandidates(
  conn: PoolConnection,
  wardId: number,
  rows: readonly CandidateInput[],
  category: { set: string | null } | 'keep',
): Promise<void> {
  await conn.execute('DELETE FROM candidate WHERE ward_id = ?', [wardId]);
  for (const r of [...rows].sort((a, b) => a.position - b.position)) {
    await conn.execute(
      `INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [wardId, r.position, r.nameHindi, r.partyId, r.gender],
    );
  }
  const unopposed = rows.length === 1;
  if (rows.length > 1) {
    await conn.execute(
      `INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota)
       VALUES (?, ?, ?, NULL, NULL, 1)`,
      [wardId, rows.length + 1, NOTA_NAME_HINDI],
    );
  }
  if (category === 'keep') {
    await conn.execute(
      'UPDATE ward SET is_unopposed = ?, candidates_ready_at = NULL, candidates_ready_by = NULL WHERE id = ?',
      [unopposed ? 1 : 0, wardId],
    );
  } else {
    await conn.execute(
      `UPDATE ward SET is_unopposed = ?, reservation_category = ?,
              candidates_ready_at = NULL, candidates_ready_by = NULL WHERE id = ?`,
      [unopposed ? 1 : 0, category.set, wardId],
    );
  }
}

/** The current list of a ward (NOTA excluded), for audit old values and the forms. */
export interface StoredCandidate {
  id: number;
  position: number;
  nameHindi: string;
  partyId: number | null;
  partyShort: string | null;
  gender: Gender;
}

export async function readWardCandidates(
  db: Pool | PoolConnection,
  wardId: number,
): Promise<StoredCandidate[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.ballot_position, c.name_hindi, c.party_id, p.short_name, c.gender
       FROM candidate c LEFT JOIN party p ON p.id = c.party_id
      WHERE c.ward_id = ? AND c.is_nota = 0 ORDER BY c.ballot_position`,
    [wardId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    position: Number(r.ballot_position),
    nameHindi: String(r.name_hindi),
    partyId: r.party_id === null ? null : Number(r.party_id),
    partyShort: r.short_name === null ? null : String(r.short_name),
    gender: String(r.gender) as Gender,
  }));
}
