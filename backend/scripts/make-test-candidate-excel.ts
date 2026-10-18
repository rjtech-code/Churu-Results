// npm run test-candidate-excel
//
// READ ONLY. Builds an import-ready candidate Excel (the exact columns of import:candidates) from the
// candidates in the database today — same PS, ward, ballot order, name, party, gender and ward
// reservation — and fills the optional detail columns with obviously FAKE test values:
//   dob (~70%) or age only (~30%), ages 25..70 on AGE_REFERENCE_DATE; education cycling through all
//   values; mobiles 90000xxxxx; candidate_category following the seat for SC/ST/OBC seats, on
//   general seats mostly GEN with ~1 in 5 SC/OBC; exactly 3 left blank on purpose (on unopposed
//   general-seat wards first, so the ST Format "missing details" warning shows them).
// Saved as backend/reports/TEST-candidates-<timestamp>.xlsx. Run it BEFORE reset-candidates.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { AGE_REFERENCE_DATE } from '../src/config/election.js';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
} from '../src/services/master-data/candidates.js';
import { EDUCATIONS, ageOn } from '../src/services/master-data/candidate-details.js';
import type { CandidateCategory } from '../src/services/master-data/candidate-details.js';
import { parseReservation } from '../src/services/st-format-common.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { Report, istStamp } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import type { Cell } from './lib/xlsx.js';
import { writeSheet } from './lib/xlsx.js';

export const TEST_EXCEL_HEADERS = [...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS] as const;
type Column = (typeof TEST_EXCEL_HEADERS)[number];

export const BLANK_CATEGORY_COUNT = 3;
export const MIN_TEST_AGE = 25;
export const MAX_TEST_AGE = 70;
const DEFAULT_SEED = 20261120;

export interface SourceCandidate {
  wardId: number;
  wardType: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  reservation: string | null;
  isUnopposed: boolean;
  position: number;
  nameHindi: string;
  partyShort: string | null;
  gender: string;
}

/** Small deterministic PRNG (mulberry32): the same database always gives the same file. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A DD/MM/YYYY date of birth that is exactly `age` years old on AGE_REFERENCE_DATE. */
function dobForAge(age: number, daysBefore: number): string {
  const [y, m, d] = AGE_REFERENCE_DATE.split('-').map(Number);
  const t = new Date(Date.UTC((y ?? 0) - age, (m ?? 1) - 1, d ?? 1));
  t.setUTCDate(t.getUTCDate() - daysBefore);
  const iso = `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  if (ageOn(iso) !== age) throw new Error(`internal: dob ${iso} is not age ${age}`);
  return `${pad2(t.getUTCDate())}/${pad2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** The seat's category when it is SC/ST/OBC; null for a general or unreadable reservation. */
const reservedCategory = (c: SourceCandidate): CandidateCategory | null => {
  const r = parseReservation(c.reservation);
  return r !== null && r.category !== 'GEN' ? r.category : null;
};

/**
 * Picks the rows whose category is left blank: unopposed general-seat wards first, then other
 * general-seat candidates, then anyone (a blank on a reserved seat is filled from the seat).
 */
function pickBlankRows(cands: readonly SourceCandidate[]): number[] {
  const all = cands.map((c, i) => ({
    i,
    unopposed: c.isUnopposed,
    general: reservedCategory(c) === null,
  }));
  const ordered = [
    ...all.filter((x) => x.unopposed && x.general),
    ...all.filter((x) => !x.unopposed && x.general),
    ...all.filter((x) => !x.general),
  ];
  return ordered.slice(0, BLANK_CATEGORY_COUNT).map((x) => x.i);
}

export function buildTestRows(
  cands: readonly SourceCandidate[],
  seed = DEFAULT_SEED,
): { rows: Record<Column, Cell>[]; blankRows: number[] } {
  const random = makeRandom(seed);
  const blank = new Set(pickBlankRows(cands));
  const rows = cands.map((c, i): Record<Column, Cell> => {
    const age = MIN_TEST_AGE + Math.floor(random() * (MAX_TEST_AGE - MIN_TEST_AGE + 1));
    const withDob = random() < 0.7;
    const daysBefore = 1 + Math.floor(random() * 360);
    const mixRoll = random();
    const scOrObc = random() < 0.5 ? 'SC' : 'OBC';
    const seat = reservedCategory(c);
    let category: CandidateCategory | null;
    if (blank.has(i)) category = null;
    else if (seat !== null) category = seat;
    else category = mixRoll < 0.2 ? scOrObc : 'GEN';
    return {
      panchayat_samiti: c.wardType === 'PS' ? c.psName : null,
      election: c.wardType,
      ward_no: c.wardNo,
      ballot_position: c.position,
      name_hindi: c.nameHindi,
      party_short_name: c.partyShort,
      gender: c.gender,
      reservation_category: c.reservation,
      dob: withDob ? dobForAge(age, daysBefore) : null,
      age: withDob ? null : age,
      education: EDUCATIONS[i % EDUCATIONS.length] ?? null,
      mobile: `90000${String((i + 1) % 100000).padStart(5, '0')}`,
      candidate_category: category,
    };
  });
  return { rows, blankRows: [...blank].sort((a, b) => a - b) };
}

const wardText = (c: SourceCandidate) =>
  c.wardType === 'PS'
    ? `PS ward ${c.wardNo} of ${c.psName ?? '?'} (ward id ${c.wardId})`
    : `ZP ward ${c.wardNo} (ward id ${c.wardId})`;

export interface TestExcelResult extends ScriptResult {
  database: string;
  file: string | null;
  rows: number;
}

export async function runMakeTestCandidateExcel(ctx: ScriptContext): Promise<TestExcelResult> {
  const startedAt = ctx.now();
  const report = new Report('test-candidate-excel', 'read-only');
  let database = '';
  let file: string | null = null;
  let rowCount = 0;
  try {
    const [db] = await ctx.pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    database = String(db[0]?.name ?? '');
    ctx.out(`Database: ${database}`);
    report.line(`Database: ${database}`);

    const [rows] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT w.id AS ward_id, w.ward_type, w.ward_no, w.reservation_category, w.is_unopposed,
              ps.name_english AS ps_name, c.ballot_position, c.name_hindi, p.short_name, c.gender
         FROM candidate c
         JOIN ward w ON w.id = c.ward_id
         LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id
         LEFT JOIN party p ON p.id = c.party_id
        WHERE c.is_nota = 0
        ORDER BY w.ward_type, ps.name_english, w.ward_no, c.ballot_position`,
    );
    const cands: SourceCandidate[] = rows.map((r) => ({
      wardId: Number(r.ward_id),
      wardType: r.ward_type === 'ZP' ? 'ZP' : 'PS',
      wardNo: Number(r.ward_no),
      psName: r.ps_name === null ? null : String(r.ps_name),
      reservation: r.reservation_category === null ? null : String(r.reservation_category),
      isUnopposed: Number(r.is_unopposed) === 1,
      position: Number(r.ballot_position),
      nameHindi: String(r.name_hindi),
      partyShort: r.short_name === null ? null : String(r.short_name),
      gender: String(r.gender),
    }));
    if (cands.length === 0) {
      report.error('There are no candidates in the database: nothing to copy.');
    } else {
      const { rows: built, blankRows } = buildTestRows(cands);
      rowCount = built.length;
      await mkdir(ctx.reportsDir, { recursive: true });
      file = join(ctx.reportsDir, `TEST-candidates-${istStamp(startedAt)}.xlsx`);
      await writeSheet(file, [
        {
          name: 'candidates',
          headers: TEST_EXCEL_HEADERS,
          rows: built.map((r) => TEST_EXCEL_HEADERS.map((h) => r[h])),
        },
      ]);

      const wards = new Set(cands.map((c) => c.wardId));
      const unopposed = new Set(cands.filter((c) => c.isUnopposed).map((c) => c.wardId));
      const tally = (col: Column) => {
        const m = new Map<string, number>();
        for (const r of built) {
          const k = r[col] === null ? '(blank)' : String(r[col]);
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return [...m].map(([k, n]) => `${k}: ${n}`);
      };
      report.line(`Wrote ${rowCount} candidate rows in ${wards.size} ward(s) to ${file}`);
      report.line(`Unopposed wards (exactly one row): ${unopposed.size}`);
      report.line(
        `With dob: ${built.filter((r) => r.dob !== null).length}, age only: ${built.filter((r) => r.age !== null).length}`,
      );
      report.section('education', tally('education'));
      report.section('candidate_category', tally('candidate_category'));
      report.section(
        `candidate_category left BLANK on purpose (${blankRows.length})`,
        cands
          .filter((_, i) => blankRows.includes(i))
          .map((c) => `${wardText(c)}, ballot ${c.position}${c.isUnopposed ? ' (unopposed)' : ''}`),
      );
      report.line('');
      report.line(
        'ALL DETAIL VALUES ARE FAKE TEST DATA. Never use this file for the real election.',
      );
    }
  } catch (err) {
    reportFailure(report, err);
  }
  return {
    ...(await finishReport(ctx, report, startedAt, false)),
    database,
    file,
    rows: rowCount,
  };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  parseCli(argv, {}, 'npm run test-candidate-excel');
  return runMakeTestCandidateExcel(ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
