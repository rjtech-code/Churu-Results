// Regression: "विवरण सुधारें" died with "Check constraint 'chk_candidate_change' is violated"
// whenever a correction changed a value in a way MySQL's utf8mb4_unicode_ci calls "the same":
// a nukta (फारूक → फ़ारूक़), letter case, or stray spacing. JavaScript compares the two values
// exactly (so the service sees a real change and writes a history row), the CHECK compared them with
// the table's case/accent-insensitive, space-padding collation and refused the row — taking the whole
// transaction, and the correction, down with it.
//
// This file also pins what the constraint must keep refusing, proves the blank-value cases (empty
// education / mobile / occupation) were never the problem, and proves the transaction rolls back
// cleanly when the history insert fails.
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { PASSWORD, adminApp, apiClient, buildAdminWorld } from './helpers.js';
import type { AdminWorld } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;

const REASON = 'नामांकन पत्र के अनुसार विवरण ठीक किया';

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
});

const path = (wardId: number, candidateId: number) =>
  `/api/candidates/wards/${wardId}/candidates/${candidateId}/details`;

const body = (extra: Record<string, unknown>, currentName: string) => ({
  currentName,
  reason: REASON,
  password: PASSWORD,
  ...extra,
});

/** Sets one candidate column to a value the import or an older list could have left behind. */
async function store(candidateId: number, column: string, value: string | null): Promise<void> {
  const sql: Readonly<Record<string, string>> = {
    name_hindi: 'UPDATE candidate SET name_hindi = ? WHERE id = ?',
    address: 'UPDATE candidate SET address = ? WHERE id = ?',
    occupation: 'UPDATE candidate SET occupation = ? WHERE id = ?',
    education: 'UPDATE candidate SET education = ? WHERE id = ?',
    mobile: 'UPDATE candidate SET mobile = ? WHERE id = ?',
    party_id: 'UPDATE candidate SET party_id = ? WHERE id = ?',
  };
  const text = sql[column];
  if (text === undefined) throw new Error(`unknown column ${column}`);
  await pool.execute(text, [value, candidateId]);
}

async function candidateRow(id: number): Promise<RowDataPacket> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_hindi, party_id, education, mobile, address, occupation FROM candidate WHERE id = ?',
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('candidate gone');
  return row;
}

async function history(): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT field, old_value, new_value, old_name_hindi, new_name_hindi FROM candidate_name_change ORDER BY id',
  );
  return rows;
}

describe('the collation the history table is compared with', () => {
  it('calls a nukta and a case difference "the same"; the application does not', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 'फारूक' = 'फ़ारूक़' AS nukta, 'Ramesh' = 'RAMESH' AS letter_case,
              'फारूक' COLLATE utf8mb4_bin = 'फ़ारूक़' AS nukta_exact`,
    );
    // This is the whole bug: the ci collation of the table says "same", JavaScript says "changed",
    // so the service writes a history row the old CHECK refused. The exact comparison agrees with
    // the application, which is what the constraint now uses.
    expect(Number(rows[0]?.nukta)).toBe(1);
    expect(Number(rows[0]?.letter_case)).toBe(1);
    expect(Number(rows[0]?.nukta_exact)).toBe(0);
    // The same two strings, exactly as the service compares them.
    const [before, after]: string[] = ['फारूक', 'फ़ारूक़'];
    expect(before === after).toBe(false);
  });
});

describe('a correction MySQL would call "no change"', () => {
  it('NAME: a nukta added to the name is saved and recorded', async () => {
    await store(w.c.A, 'name_hindi', 'फारूक');
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ newName: 'फ़ारूक़' }, 'फारूक'));
    expect(res.status).toBe(200);
    expect(String((await candidateRow(w.c.A)).name_hindi)).toBe('फ़ारूक़');
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field).toBe('NAME');
    expect(rows[0]?.old_name_hindi).toBe('फारूक');
    expect(rows[0]?.new_name_hindi).toBe('फ़ारूक़');
  });

  it('NAME: only the letter case changed', async () => {
    await store(w.c.A, 'name_hindi', 'RAMESH KUMAR');
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      path(w.psW1, w.c.A),
      body({ newName: 'Ramesh Kumar' }, 'RAMESH KUMAR'),
    );
    expect(res.status).toBe(200);
    expect(String((await candidateRow(w.c.A)).name_hindi)).toBe('Ramesh Kumar');
  });

  it('ADDRESS: a stray double space is tidied', async () => {
    await store(w.c.A, 'address', 'वार्ड 4,  चूरू');
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ address: 'वार्ड 4, चूरू' }, 'ए'));
    expect(res.status).toBe(200);
    expect(String((await candidateRow(w.c.A)).address)).toBe('वार्ड 4, चूरू');
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field).toBe('ADDRESS');
    expect(rows[0]?.old_value).toBe('वार्ड 4,  चूरू');
    expect(rows[0]?.new_value).toBe('वार्ड 4, चूरू');
    expect(rows[0]?.old_name_hindi).toBeNull();
  });

  it('OCCUPATION: only the letter case changed', async () => {
    await store(w.c.A, 'occupation', 'KRISHI');
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ occupation: 'Krishi' }, 'ए'));
    expect(res.status).toBe(200);
    expect(String((await candidateRow(w.c.A)).occupation)).toBe('Krishi');
  });
});

describe('blank details (empty education / mobile / occupation)', () => {
  it('filling three blank details at once works', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      path(w.psW1, w.c.A),
      body({ education: 'GRADUATE', mobile: '9876543210', occupation: 'कृषि' }, 'ए'),
    );
    expect(res.status).toBe(200);
    const rows = await history();
    expect(rows.map((r) => String(r.field)).sort()).toEqual(['EDUCATION', 'MOBILE', 'OCCUPATION']);
    for (const r of rows) expect(r.old_value).toBeNull();
  });

  it('clearing a detail back to empty works', async () => {
    await store(w.c.A, 'education', 'GRADUATE');
    await store(w.c.A, 'mobile', '9876543210');
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(path(w.psW1, w.c.A), body({ education: '', mobile: '' }, 'ए'));
    expect(res.status).toBe(200);
    const row = await candidateRow(w.c.A);
    expect(row.education).toBeNull();
    expect(row.mobile).toBeNull();
    const rows = await history();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.new_value).toBeNull();
  });
});

describe('party', () => {
  /** A real parties list can hold a row for independents; its label is then the independent label. */
  it('independent → a party whose short name is निर्दलीय is a real change and is recorded', async () => {
    await pool.execute(
      `INSERT INTO party (name_hindi, name_english, short_name, symbol)
       VALUES ('निर्दलीय', 'Independent', 'निर्दलीय', 'Independent')`,
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM party WHERE short_name = 'निर्दलीय'",
    );
    const partyId = Number(rows[0]?.id);
    const ro = await apiClient(app, 'ro_ps1_x1');
    const res = await ro.post(
      path(w.psW1, w.c.A),
      body({ partyId, confirmPartyChange: true }, 'ए'),
    );
    expect(res.status).toBe(200);
    expect(Number((await candidateRow(w.c.A)).party_id)).toBe(partyId);
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0]?.field).toBe('PARTY');
  });
});

describe('what the constraint must still refuse', () => {
  interface Row {
    field: string;
    oldValue?: string | null;
    newValue?: string | null;
    oldName?: string | null;
    newName?: string | null;
  }
  const insert = (row: Row) => {
    const params: (string | number | null)[] = [
      w.psW1,
      w.c.A,
      row.field,
      row.oldValue ?? null,
      row.newValue ?? null,
      row.oldName ?? null,
      row.newName ?? null,
      REASON,
      w.users.ro1,
    ];
    return migrator.execute<ResultSetHeader>(
      `INSERT INTO candidate_name_change
         (ward_id, candidate_id, ballot_position, field, old_value, new_value,
          old_name_hindi, new_name_hindi, reason, changed_by, changed_by_name, changed_by_role)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'Test RO', 'PS_RO')`,
      params,
    );
  };

  it('a row with no values at all', async () => {
    await expect(insert({ field: 'EDUCATION' })).rejects.toThrow(/chk_candidate_change/);
  });

  it('a row whose two values are byte-for-byte the same', async () => {
    await expect(
      insert({ field: 'EDUCATION', oldValue: 'GRADUATE', newValue: 'GRADUATE' }),
    ).rejects.toThrow(/chk_candidate_change/);
  });

  it('a NAME row without the two names', async () => {
    await expect(insert({ field: 'NAME', oldValue: 'अ', newValue: 'ब' })).rejects.toThrow(
      /chk_candidate_change/,
    );
  });

  it('a NAME row whose two names are byte-for-byte the same', async () => {
    await expect(
      insert({ field: 'NAME', oldValue: 'अ', newValue: 'अ', oldName: 'अ', newName: 'अ' }),
    ).rejects.toThrow(/chk_candidate_change/);
  });

  it('a non-NAME row that also carries the name columns', async () => {
    await expect(
      insert({
        field: 'EDUCATION',
        oldValue: null,
        newValue: 'GRADUATE',
        oldName: 'अ',
        newName: 'ब',
      }),
    ).rejects.toThrow(/chk_candidate_change/);
  });
});

describe('the whole correction is one transaction', () => {
  it('when the history insert fails, the candidate is NOT changed', async () => {
    await migrator.query(`
      CREATE TRIGGER trg_test_block_history BEFORE INSERT ON candidate_name_change
        FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test: history insert refused'
    `);
    try {
      const ro = await apiClient(app, 'ro_ps1_x1');
      const res = await ro.post(
        path(w.psW1, w.c.A),
        body({ newName: 'ए शर्मा', occupation: 'कृषि' }, 'ए'),
      );
      expect(res.status).toBe(500);
      // Nothing may have been saved: not the name, not the detail, not a history row.
      const row = await candidateRow(w.c.A);
      expect(String(row.name_hindi)).toBe('ए');
      expect(row.occupation).toBeNull();
      expect(await history()).toHaveLength(0);
      const [audit] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'CANDIDATE_%CORRECTED'",
      );
      expect(Number(audit[0]?.n)).toBe(0);
    } finally {
      await migrator.query('DROP TRIGGER IF EXISTS trg_test_block_history');
    }
  });
});
