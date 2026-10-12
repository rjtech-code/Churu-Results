// Party list rules, shared by `npm run import:parties` and the DM's "पार्टी सूची" page.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { requireText } from './cells.js';
import type { IssueList, PartyField } from './issues.js';
import { matchKey, normalizeText } from './text.js';
import type { SheetRow } from './xlsx.js';

export const PARTY_COLUMNS = ['name_hindi', 'name_english', 'short_name', 'symbol'] as const;

/** Column sizes in the party table. */
const MAX_LENGTH: Readonly<Record<PartyField, number>> = {
  name_hindi: 200,
  name_english: 200,
  short_name: 30,
  symbol: 100,
};

export type PartyInput = Record<PartyField, string> & { rowNumber: number };

export interface PartyRow {
  id: number;
  name_hindi: string;
  name_english: string;
  short_name: string;
  symbol: string;
}

export interface PartyPlan {
  toInsert: PartyInput[];
  /** Short names already in the database with identical values. */
  unchanged: string[];
}

/** Sheet rows -> parties. Rows with an empty cell are reported and skipped. */
export function parsePartyRows(rows: readonly SheetRow[], issues: IssueList): PartyInput[] {
  const parties: PartyInput[] = [];
  for (const row of rows) {
    const before = issues.errors.length;
    const values = PARTY_COLUMNS.map((c) => requireText(row, c, issues));
    if (issues.errors.length !== before) continue;
    const [name_hindi, name_english, short_name, symbol] = values as [
      string,
      string,
      string,
      string,
    ];
    parties.push({ rowNumber: row.rowNumber, name_hindi, name_english, short_name, symbol });
  }
  return parties;
}

/** One party typed into the web form, as a one-row "sheet" (row number 1). */
export function partyFromForm(input: Record<PartyField, string>): PartyInput {
  return {
    rowNumber: 1,
    name_hindi: normalizeText(input.name_hindi),
    name_english: normalizeText(input.name_english),
    short_name: normalizeText(input.short_name),
    symbol: normalizeText(input.symbol),
  };
}

export async function loadParties(db: Pool | PoolConnection): Promise<PartyRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT id, name_hindi, name_english, short_name, symbol FROM party ORDER BY short_name',
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name_hindi: String(r.name_hindi),
    name_english: String(r.name_english),
    short_name: String(r.short_name),
    symbol: String(r.symbol),
  }));
}

/**
 * Every party rule: unique within the file (case-insensitive, like the DB collation), an existing
 * short name must match exactly (changing a party is not supported), and a new party's Hindi or
 * English name must not belong to another party.
 */
export function checkParties(
  parties: readonly PartyInput[],
  existing: readonly PartyRow[],
  issues: IssueList,
): PartyPlan {
  for (const p of parties) {
    for (const field of ['name_hindi', 'name_english', 'short_name', 'symbol'] as const) {
      if (p[field].length > MAX_LENGTH[field])
        issues.error({ code: 'PARTY_TOO_LONG', field, max: MAX_LENGTH[field] }, p.rowNumber);
    }
  }
  for (const field of ['short_name', 'name_hindi', 'name_english'] as const) {
    const groups = new Map<string, number[]>();
    for (const p of parties)
      groups.set(matchKey(p[field]), [...(groups.get(matchKey(p[field])) ?? []), p.rowNumber]);
    for (const [value, rows] of groups) {
      if (rows.length > 1) issues.error({ code: 'PARTY_DUPLICATE_IN_FILE', field, value }, rows);
    }
  }

  const toInsert: PartyInput[] = [];
  const unchanged: string[] = [];
  for (const p of parties) {
    const same = existing.find((e) => matchKey(e.short_name) === matchKey(p.short_name));
    if (same) {
      const differs = PARTY_COLUMNS.filter((f) => same[f] !== p[f]);
      if (differs.length === 0) unchanged.push(p.short_name);
      else
        issues.error(
          { code: 'PARTY_EXISTS_DIFFERENT', shortName: p.short_name, fields: differs },
          p.rowNumber,
        );
      continue;
    }
    for (const field of ['name_hindi', 'name_english'] as const) {
      const clash = existing.find((e) => matchKey(e[field]) === matchKey(p[field]));
      if (clash) {
        issues.error(
          { code: 'PARTY_NAME_TAKEN', field, value: p[field], owner: clash.short_name },
          p.rowNumber,
        );
      }
    }
    toInsert.push(p);
  }
  return { toInsert, unchanged };
}

/** Inserts the planned parties (call only when the check found no errors). */
export async function insertParties(
  conn: PoolConnection,
  toInsert: readonly PartyInput[],
): Promise<void> {
  for (const p of toInsert) {
    await conn.execute(
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      [p.name_hindi, p.name_english, p.short_name, p.symbol],
    );
  }
}
