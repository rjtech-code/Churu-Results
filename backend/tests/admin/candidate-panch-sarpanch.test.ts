// "क्या पूर्व में पंच या सरपंच का पद धारित किया है" (Prarup-7 column (च)): the Excel import, the DM's
// details edit, the two-person cross-check report — and the proof that adding it changed nothing
// about counting.
//
// Three states and no more: हाँ (YES), नहीं (NO) and "not recorded" (NULL, printed blank). A value
// the system does not recognise is an error naming the row and what was typed; it is never guessed.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BALLOT_REPORT_HEADERS } from '../../src/services/master-data/ballot-report.js';
import {
  HELD_PANCH_SARPANCH_HI,
  parseHeldPanchSarpanch,
} from '../../src/services/master-data/candidate-details.js';
import { readReportData } from '../../src/modules/reports/reports.data.js';
import { buildReport } from '../../src/services/reports.js';
import { clientFor, countingApp, psW1Sheet } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  CANDIDATE_HEADERS,
  PASSWORD,
  PS1_NAME,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  countRows,
  masterSnapshot,
  xlsxBase64,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;

const HEADERS = [...CANDIDATE_HEADERS, 'held_panch_sarpanch'];

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildAdminWorld(pool);
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

async function stored(wardId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ballot_position AS pos, held_panch_sarpanch AS held
       FROM candidate WHERE ward_id = ? AND is_nota = 0 ORDER BY ballot_position`,
    [wardId],
  );
  return rows.map((r) => ({ pos: Number(r.pos), held: r.held === null ? null : String(r.held) }));
}

const save = async (headers: readonly string[], rows: (string | number | null)[][]) =>
  dm.post('/api/admin/candidates/save', {
    fileName: 'c.xlsx',
    fileBase64: await xlsxBase64(headers, rows),
    password: PASSWORD,
  });

describe('the schema change itself', () => {
  it('candidate.held_panch_sarpanch is a nullable ENUM, NULL for every candidate that already exists', async () => {
    const [cols] = await pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate'
          AND COLUMN_NAME = 'held_panch_sarpanch'`,
    );
    expect(cols[0]).toMatchObject({ type: "enum('YES','NO')", nullable: 'YES', def: null });
    // The world's candidates were inserted before this field existed as far as they know.
    expect(await countRows(pool, 'SELECT COUNT(*) AS n FROM candidate')).toBeGreaterThan(0);
    expect(
      await countRows(
        pool,
        'SELECT COUNT(*) AS n FROM candidate WHERE held_panch_sarpanch IS NOT NULL',
      ),
    ).toBe(0);
  });

  it('the correction history ENUM carries the new field, so a correction of it can be recorded', async () => {
    const [cols] = await pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_name_change'
          AND COLUMN_NAME = 'field'`,
    );
    expect(String(cols[0]?.type)).toContain("'HELD_PANCH_SARPANCH'");
  });
});

describe('parsing: two values, the spellings officers type, nothing else', () => {
  it('accepts हाँ / नहीं and the obvious variants, in any case and with stray spaces', () => {
    for (const yes of ['हाँ', 'हां', 'Yes', 'yes', 'YES', 'Y', ' y ']) {
      expect(parseHeldPanchSarpanch(yes), yes).toBe('YES');
    }
    for (const no of ['नहीं', 'नही', 'No', 'no', 'NO', 'N', ' n ']) {
      expect(parseHeldPanchSarpanch(no), no).toBe('NO');
    }
  });

  it('refuses anything else — including values that LOOK like an answer', () => {
    for (const bad of ['TRUE', 'FALSE', '1', '0', 'हाँ/नहीं', 'ha', 'नहि', 'maybe', '-']) {
      expect(parseHeldPanchSarpanch(bad), bad).toBeNull();
    }
  });
});

describe('the Excel import', () => {
  it('imports हाँ and नहीं (and the variants); a blank cell stays "not recorded"', async () => {
    const res = await save(HEADERS, [
      [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, 'हाँ'],
      [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, 'नहीं'],
      [PS1_NAME, 'PS', 5, 3, 'मोहन', null, 'M', null, 'Yes'],
      [PS1_NAME, 'PS', 5, 4, 'गीता', null, 'F', null, null],
    ]);
    expect(res.status).toBe(200);
    expect(await stored(w.psW5)).toEqual([
      { pos: 1, held: 'YES' },
      { pos: 2, held: 'NO' },
      { pos: 3, held: 'YES' },
      { pos: 4, held: null },
    ]);
  });

  it('a file without the column still imports: every candidate is "not recorded"', async () => {
    expect(
      (await save(CANDIDATE_HEADERS, [[PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य']])).status,
    ).toBe(200);
    expect(await stored(w.psW5)).toEqual([{ pos: 1, held: null }]);
  });

  it('a value it does not know: a row error naming the value, and NOTHING is saved', async () => {
    const before = await masterSnapshot(pool);
    const fileBase64 = await xlsxBase64(HEADERS, [
      [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, 'हाँ'],
      [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, 'शायद'],
    ]);
    const check = await dm.post('/api/admin/candidates/check', { fileName: 'c.xlsx', fileBase64 });
    expect((check.body as { ok: boolean }).ok).toBe(false);
    expect((check.body as { errors: { rows: number[]; message: string }[] }).errors).toEqual([
      {
        rows: [3],
        message:
          'पंक्ति 3: "पंच/सरपंच" में हाँ या नहीं लिखें, लिखा है "शायद" — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
      },
    ]);
    expect(
      (
        await dm.post('/api/admin/candidates/save', {
          fileName: 'c.xlsx',
          fileBase64,
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(await masterSnapshot(pool)).toBe(before);
  });
});

describe('the DM details edit', () => {
  /** The DM edit works on an UNLOCKED ward's candidate (the locked ones go through the RO flow). */
  async function candidateOfWard5(): Promise<string> {
    expect(
      (await save(CANDIDATE_HEADERS, [[PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य']])).status,
    ).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM candidate WHERE ward_id = ? AND is_nota = 0',
      [w.psW5],
    );
    return `/api/admin/candidates/${String(Number(rows[0]?.id))}/details`;
  }

  const held = async (path: string) => {
    const id = Number(path.split('/')[4]);
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT held_panch_sarpanch AS held FROM candidate WHERE id = ?',
      [id],
    );
    return rows[0]?.held === null || rows[0]?.held === undefined ? null : String(rows[0].held);
  };

  it('sets and clears it, and the audit keeps the old and the new value', async () => {
    const path = await candidateOfWard5();
    expect((await dm.post(path, { heldPanchSarpanch: 'हाँ' })).status).toBe(200);
    expect(await held(path)).toBe('YES');

    const audit = await auditOf(pool, 'CANDIDATE_DETAILS_CHANGED');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.old_value).toMatchObject({ held_panch_sarpanch: null });
    expect(audit[0]?.new_value).toMatchObject({ held_panch_sarpanch: 'YES' });

    expect((await dm.post(path, { heldPanchSarpanch: null })).status).toBe(200);
    expect(await held(path)).toBeNull();
  });

  it('a value it does not know is refused and the stored value does not change', async () => {
    const path = await candidateOfWard5();
    expect((await dm.post(path, { heldPanchSarpanch: 'नहीं' })).status).toBe(200);
    const before = await masterSnapshot(pool);
    expect((await dm.post(path, { heldPanchSarpanch: 'शायद' })).status).toBe(400);
    expect(await held(path)).toBe('NO');
    expect(await masterSnapshot(pool)).toBe(before);
  });
});

describe('the two-person cross-check report', () => {
  it('has the column, with हाँ / नहीं and a blank cell when it is not recorded', async () => {
    expect(
      (
        await save(HEADERS, [
          [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, 'हाँ'],
          [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, 'नहीं'],
          [PS1_NAME, 'PS', 5, 3, 'मोहन', null, 'M', null, null],
        ])
      ).status,
    ).toBe(200);

    expect(BALLOT_REPORT_HEADERS).toContain('panch_sarpanch');
    const column = BALLOT_REPORT_HEADERS.indexOf('panch_sarpanch');
    const { buildBallotReportSheets } =
      await import('../../src/services/master-data/ballot-report.js');
    const { sheets } = await buildBallotReportSheets(pool, { ps: 'ALL', includeZp: false });
    const ward5 = sheets
      .flatMap((s) => s.rows)
      .filter((r) => r[0] === 5 && typeof r[5] === 'string' && r[5] !== 'NO CANDIDATES');
    expect(ward5.map((r) => r[column])).toEqual([
      HELD_PANCH_SARPANCH_HI.YES,
      HELD_PANCH_SARPANCH_HI.NO,
      null,
      // NOTA is a ballot row, not a person: its cell stays empty.
      null,
    ]);
  });
});

/**
 * The point of this whole change: it adds a printed detail, and NOTHING about counting. One ward is
 * counted, every counting row and the built report are photographed, the new field is then set
 * through both paths that can write it, and the photograph must be identical.
 */
describe('counting is untouched', () => {
  /** Every row counting is made of, plus the report the DM reads, as one string. */
  async function countingPhoto(): Promise<string> {
    const parts: unknown[] = [];
    for (const sql of [
      'SELECT * FROM booth_entry ORDER BY id',
      'SELECT * FROM booth_entry_vote ORDER BY entry_id, candidate_id',
      'SELECT * FROM postal_entry ORDER BY id',
      'SELECT * FROM ward_declarations ORDER BY id',
      'SELECT id, is_locked, is_unopposed FROM ward ORDER BY id',
    ]) {
      const [rows] = await pool.query<RowDataPacket[]>(sql);
      parts.push(rows);
    }
    // The numbers and the ward status as the reports show them (one fixed `now`, so only data moves).
    const report = buildReport(await readReportData(pool), {
      now: new Date('2026-11-20T12:00:00Z'),
    });
    parts.push(report.sections, report.alarms);
    return JSON.stringify(parts);
  }

  it('entering, the ward status and every report number stay exactly as they were', async () => {
    // A counted ward, and a candidate list that already exists: the photo below is of THIS state.
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    expect((await ro.post('/entries', psW1Sheet(w, w.b1, 300, 200, 10))).status).toBe(201);
    const list: (string | number | null)[][] = [
      [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, null],
      [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, null],
    ];
    expect((await save(HEADERS, list)).status).toBe(200);

    const before = await countingPhoto();

    // Now the ONLY thing that changes anywhere is this new detail, by each path that writes it:
    // 1. the RO's correction on the LOCKED, counted ward,
    const correction = await (
      await apiClient(app, 'ro_ps1_x1')
    ).post(`/api/candidates/wards/${w.psW1}/candidates/${w.c.A}/details`, {
      currentName: 'ए',
      reason: 'नामांकन पत्र के अनुसार पंच/सरपंच विवरण भरा',
      password: PASSWORD,
      heldPanchSarpanch: 'हाँ',
    });
    expect(correction.status).toBe(200);
    // 2. the same candidate list imported again, with the column filled this time.
    expect(
      (
        await save(HEADERS, [
          [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, 'हाँ'],
          [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, 'नहीं'],
        ])
      ).status,
    ).toBe(200);

    expect(await countingPhoto()).toBe(before);
    // The detail really was written, so the photo above is a proof and not a coincidence.
    const [row] = await pool.execute<RowDataPacket[]>(
      'SELECT held_panch_sarpanch AS held FROM candidate WHERE id = ?',
      [w.c.A],
    );
    expect(String(row[0]?.held)).toBe('YES');
    expect(await stored(w.psW5)).toEqual([
      { pos: 1, held: 'YES' },
      { pos: 2, held: 'NO' },
    ]);
  });
});
