// "विवरण सुधारें" (Nov 2026): after the ballot lock the ward's own RO may correct EVERY candidate
// detail — name, party, gender, category, date of birth / age, education, mobile, address,
// occupation — with the same machinery as the old name-only correction (reason, own password,
// compare-and-set, one transaction, append-only history, audit row).
// The ballot order, adding / removing a candidate and NOTA stay frozen (candidate-name.test.ts).
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { PASSWORD, adminApp, apiClient, auditOf, buildAdminWorld } from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;

const REASON = 'नामांकन पत्र के अनुसार विवरण ठीक किया';
const SA = 'super_admin_d1';

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
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: PASSWORD });
  app = adminApp(pool);
});

const path = (wardId: number, candidateId: number) =>
  `/api/candidates/wards/${wardId}/candidates/${candidateId}/details`;

const body = (extra: Record<string, unknown>, currentName = 'ए') => ({
  currentName,
  reason: REASON,
  password: PASSWORD,
  ...extra,
});

const codeOf = (res: { body: unknown }) => (res.body as { error?: string }).error;

async function candidateRow(id: number): Promise<RowDataPacket> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT name_hindi, party_id, gender, candidate_category,
            DATE_FORMAT(dob, '%Y-%m-%d') AS dob, age_stated, education, mobile, address, occupation,
            ballot_position, is_nota
       FROM candidate WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('candidate gone');
  return row;
}

async function history() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM candidate_name_change ORDER BY id',
  );
  return rows;
}

const changesOf = (b: unknown) => (b as { changes: Record<string, unknown>[] }).changes;

describe('every editable detail', () => {
  /** field -> [request body, the column, the value stored, the text the history keeps]. */
  const CASES: [string, Record<string, unknown>, string, unknown, string][] = [
    ['NAME', { newName: 'ए शर्मा' }, 'name_hindi', 'ए शर्मा', 'ए शर्मा'],
    ['GENDER', { gender: 'F' }, 'gender', 'F', 'महिला'],
    ['CANDIDATE_CATEGORY', { candidateCategory: 'OBC' }, 'candidate_category', 'OBC', 'OBC'],
    ['DOB', { dob: '15/05/1980' }, 'dob', '1980-05-15', '1980-05-15'],
    ['AGE_STATED', { ageStated: 44 }, 'age_stated', 44, '44'],
    ['EDUCATION', { education: 'GRADUATE' }, 'education', 'GRADUATE', 'GRADUATE'],
    ['MOBILE', { mobile: '9876543210' }, 'mobile', '9876543210', '9876543210'],
    ['ADDRESS', { address: 'वार्ड 4, चूरू' }, 'address', 'वार्ड 4, चूरू', 'वार्ड 4, चूरू'],
    ['OCCUPATION', { occupation: 'कृषि' }, 'occupation', 'कृषि', 'कृषि'],
  ];

  for (const [field, patch, column, stored, text] of CASES) {
    it(`${field}: changes the candidate and is recorded as one history row`, async () => {
      const ro = await apiClient(app, 'ro_ps1_x1');
      const res = await ro.post(path(w.psW1, w.c.A), body(patch));
      expect(res.status).toBe(200);
      expect(changesOf(res.body)).toHaveLength(1);
      expect(changesOf(res.body)[0]).toMatchObject({ field, newValue: text });

      const row = await candidateRow(w.c.A);
      expect(row[column]).toBe(stored);
      // The ballot position and NOTA never move.
      expect(Number(row.ballot_position)).toBe(1);
      expect(Number(row.is_nota)).toBe(0);

      const rows = await history();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ward_id: w.psW1,
        candidate_id: w.c.A,
        ballot_position: 1,
        field,
        new_value: text,
        reason: REASON,
        changed_by_role: 'PS_RO',
      });
      // Only a NAME row fills the two name columns (every other field leaves them NULL).
      expect(rows[0]?.new_name_hindi).toBe(field === 'NAME' ? text : null);
    });
  }

  it('several fields at once: one row per changed field, one audit row, same transaction', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      path(w.psW1, w.c.A),
      body({ newName: 'ए शर्मा', gender: 'F', mobile: '9876543210', occupation: 'कृषि' }),
    );
    expect(res.status).toBe(200);
    expect((changesOf(res.body) as { field: string }[]).map((c) => c.field)).toEqual([
      'NAME',
      'GENDER',
      'MOBILE',
      'OCCUPATION',
    ]);
    const rows = await history();
    expect(rows.map((r) => String(r.field))).toEqual(['NAME', 'GENDER', 'MOBILE', 'OCCUPATION']);
    expect(new Set(rows.map((r) => String(r.reason)))).toEqual(new Set([REASON]));

    const audit = await auditOf(pool, 'CANDIDATE_DETAILS_CORRECTED');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: REASON });
    const newValue = audit[0]?.new_value as Record<string, unknown>;
    expect(newValue.fields).toEqual(['NAME', 'GENDER', 'MOBILE', 'OCCUPATION']);
    // The audit log never carries the whole mobile number.
    expect(newValue.MOBILE).toBe('****3210');
    expect(JSON.stringify(audit[0]?.new_value)).not.toContain('9876543210');
  });

  it('sending the same values again: 409 NO_CHANGE, nothing written', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ gender: 'M', newName: 'ए' }));
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('NO_CHANGE');
    expect(await history()).toHaveLength(0);
  });

  it('a bad value for each field: 400 with its own code, nothing written', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const bad: [Record<string, unknown>, string][] = [
      [{ gender: 'X' }, 'GENDER_INVALID'],
      [{ candidateCategory: 'कुछ और' }, 'CANDIDATE_CATEGORY_INVALID'],
      [{ dob: '31/02/1980' }, 'DOB_INVALID'],
      [{ ageStated: 7 }, 'AGE_INVALID'],
      [{ education: 'कुछ और' }, 'EDUCATION_INVALID'],
      [{ mobile: '12345' }, 'MOBILE_INVALID'],
      [{ address: 'क'.repeat(301) }, 'ADDRESS_TOO_LONG'],
      [{ occupation: 'क'.repeat(101) }, 'OCCUPATION_TOO_LONG'],
    ];
    for (const [patch, code] of bad) {
      const res = await ro.post(path(w.psW1, w.c.A), body(patch));
      expect([400, 422]).toContain(res.status);
      if (res.status === 400) expect(codeOf(res)).toBe(code);
    }
    expect(await history()).toHaveLength(0);
  });

  it('a wrong password and a short reason are still refused, for any field', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const wrong = await ro.post(
      path(w.psW1, w.c.A),
      body({ gender: 'F', password: 'not-my-password' }),
    );
    expect(wrong.status).toBe(401);
    const short = await ro.post(path(w.psW1, w.c.A), body({ gender: 'F', reason: 'छोटा' }));
    expect(short.status).toBe(400);
    expect(String((await candidateRow(w.c.A)).gender)).toBe('M');
    expect(await history()).toHaveLength(0);
  });

  it('the old /name path keeps working and may now carry other details too', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      `/api/candidates/wards/${w.psW1}/candidates/${w.c.A}/name`,
      body({ newName: 'ए शर्मा', education: 'SECONDARY' }),
    );
    expect(res.status).toBe(200);
    expect(String((await candidateRow(w.c.A)).education)).toBe('SECONDARY');
  });
});

describe('party change', () => {
  it('needs the extra confirmation; the refusal names both parties and says if counting started', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ partyId: w.p1 }));
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('PARTY_CONFIRM_REQUIRED');
    expect(res.body).toMatchObject({ oldParty: 'निर्दलीय', newParty: 'P1', countingStarted: false });
    expect((await candidateRow(w.c.A)).party_id).toBeNull();
    expect(await history()).toHaveLength(0);
  });

  it('with confirmPartyChange: saved, recorded as PARTY with the old and new party', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      path(w.psW1, w.c.A),
      body({ partyId: w.p1, confirmPartyChange: true }),
    );
    expect(res.status).toBe(200);
    expect(Number((await candidateRow(w.c.A)).party_id)).toBe(w.p1);
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: 'PARTY', old_value: 'निर्दलीय', new_value: 'P1' });
    expect(await auditOf(pool, 'CANDIDATE_DETAILS_CORRECTED')).toHaveLength(1);
  });

  it('an unknown party, and a party another candidate of the ward already has: refused', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const unknown = await ro.post(
      path(w.psW1, w.c.A),
      body({ partyId: 999999, confirmPartyChange: true }),
    );
    expect(unknown.status).toBe(400);
    expect(codeOf(unknown)).toBe('PARTY_UNKNOWN');

    await pool.execute('UPDATE candidate SET party_id = ? WHERE id = ?', [w.p1, w.c.B]);
    const taken = await ro.post(
      path(w.psW1, w.c.A),
      body({ partyId: w.p1, confirmPartyChange: true }),
    );
    expect(taken.status).toBe(409);
    expect(codeOf(taken)).toBe('PARTY_TAKEN');
    expect((await candidateRow(w.c.A)).party_id).toBeNull();
  });

  it('counting already started: the refusal says so, and the change is still allowed', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    await pool.execute(
      `INSERT INTO booth_entry (booth_id, ward_id, ballot_for, sheet_total, entered_by)
       VALUES (?, ?, 'PS', 0, ?)`,
      [w.b1, w.psW1, w.users.ro1],
    );
    const warn = await ro.post(path(w.psW1, w.c.A), body({ partyId: w.p2 }));
    expect(warn.status).toBe(409);
    expect(warn.body).toMatchObject({ countingStarted: true });
    const ok = await ro.post(path(w.psW1, w.c.A), body({ partyId: w.p2, confirmPartyChange: true }));
    expect(ok.status).toBe(200);
    expect(Number((await candidateRow(w.c.A)).party_id)).toBe(w.p2);
  });
});

describe('permissions are unchanged', () => {
  it('PS_RO own PS only, ZP_RO ZP wards only, DM and Super Admin 403', async () => {
    const cases: [string, number, number, number][] = [
      ['ro_ps1_x1', w.psW1, w.c.A, 200], // own PS ward
      ['ro_ps1_x1', w.zW1, w.c.E, 403], // ZP ward: never
      ['ro_ps2_x2', w.psW1, w.c.A, 403], // another PS
      ['zp_ro_x3', w.psW1, w.c.A, 403], // PS ward: never
      ['dm_x4', w.psW1, w.c.A, 403],
      [SA, w.psW1, w.c.A, 403],
    ];
    for (const [username, wardId, candidateId, status] of cases) {
      const client: ApiClient = await apiClient(app, username);
      const name = candidateId === w.c.E ? 'ई' : 'ए';
      const res = await client.post(path(wardId, candidateId), body({ gender: 'F' }, name));
      expect(res.status, username).toBe(status);
    }
    const zp = await apiClient(app, 'zp_ro_x3');
    expect((await zp.post(path(w.zW1, w.c.E), body({ gender: 'F' }, 'ई'))).status).toBe(200);
  });
});

describe('concurrent edits', () => {
  it('a stale name: 409 NAME_CHANGED_MEANWHILE for a detail change too; nothing written', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body({ newName: 'ए नया' }))).status).toBe(200);
    const stale = await ro.post(path(w.psW1, w.c.A), body({ gender: 'F' }, 'ए'));
    expect(stale.status).toBe(409);
    expect(codeOf(stale)).toBe('NAME_CHANGED_MEANWHILE');
    expect(stale.body).toMatchObject({ currentName: 'ए नया' });
    expect(String((await candidateRow(w.c.A)).gender)).toBe('M');
    expect(await history()).toHaveLength(1);
  });

  it('two detail corrections at the same time: exactly one wins', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const [a, b] = await Promise.all([
      ro.post(path(w.psW1, w.c.A), body({ newName: 'ए एक', gender: 'F' })),
      ro.post(path(w.psW1, w.c.A), body({ newName: 'ए दो', occupation: 'कृषि' })),
    ]);
    const codes = [a.status, b.status].sort((x, y) => x - y);
    expect(codes[0]).toBe(200);
    expect(codes[1]).not.toBe(200);
    expect(['ए एक', 'ए दो']).toContain(String((await candidateRow(w.c.A)).name_hindi));
  });
});

describe('history shows the field (RO, DM page and CSV)', () => {
  it('the field name and both values, in the JSON and in the DM CSV', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect(
      (await ro.post(path(w.psW1, w.c.A), body({ mobile: '9876543210', gender: 'F' }))).status,
    ).toBe(200);

    const own = await ro.get(`/api/candidates/wards/${w.psW1}/name-changes`);
    const fields = (changesOf(own.body) as { field: string; fieldLabel: string }[]).map((c) => [
      c.field,
      c.fieldLabel,
    ]);
    expect(fields).toContainEqual(['MOBILE', 'मोबाइल']);
    expect(fields).toContainEqual(['GENDER', 'लिंग']);
    // Newest first: both rows share the timestamp, so the last one written (MOBILE) comes first.
    const byField = new Map(
      (changesOf(own.body) as { field: string; oldValue: unknown; newValue: unknown }[]).map((c) => [
        c.field,
        c,
      ]),
    );
    expect(byField.get('GENDER')).toMatchObject({ oldValue: 'पुरुष', newValue: 'महिला' });
    expect(byField.get('MOBILE')).toMatchObject({ oldValue: null, newValue: '9876543210' });

    const dm = await apiClient(app, 'dm_x4');
    const all = await dm.get('/api/admin/candidate-name-changes');
    expect(changesOf(all.body)).toHaveLength(2);
    const csv = await dm.get('/api/admin/candidate-name-changes.csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('क्या बदला');
    expect(csv.text).toContain('"मोबाइल"');
    expect(csv.text).toContain('"लिंग"');
    expect(csv.text).toContain('"9876543210"');
  });

  it('a name row written the old way (no field, no values) still reads as a NAME change', async () => {
    // The table is append-only, so the pre-migration shape is inserted directly here.
    await pool.execute(
      `INSERT INTO candidate_name_change
         (ward_id, candidate_id, ballot_position, field, old_name_hindi, new_name_hindi, reason,
          changed_by, changed_by_name, changed_by_role)
       VALUES (?, ?, 1, 'NAME', 'ए', 'ए पुराना', ?, ?, 'RO One', 'PS_RO')`,
      [w.psW1, w.c.A, REASON, w.users.ro1],
    );
    const dm = await apiClient(app, 'dm_x4');
    const all = await dm.get('/api/admin/candidate-name-changes');
    expect(changesOf(all.body)[0]).toMatchObject({
      field: 'NAME',
      fieldLabel: 'नाम',
      oldValue: 'ए',
      newValue: 'ए पुराना',
      oldName: 'ए',
      newName: 'ए पुराना',
    });
    const csv = await dm.get('/api/admin/candidate-name-changes.csv');
    expect(csv.text).toContain('"नाम"');
  });

  it('a non-name correction counts for the reset-candidates guard too', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    expect((await ro.post(path(w.psW1, w.c.A), body({ occupation: 'कृषि' }))).status).toBe(200);
    // The guard (services/setup/reset-candidates.ts) refuses while this table has ANY row.
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM candidate_name_change',
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
