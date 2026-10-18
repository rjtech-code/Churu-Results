// Ward forms after the numbers change: a correction version is what gets printed; votes changed
// behind a declaration are refused; the election date and the PS names in the header.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFormSource } from '../../src/modules/reports/ward-forms.data.js';
import { v } from '../counting/helpers.js';
import { confirmBody, declareClient } from '../declare/helpers.js';
import { apiClient, auditOf } from '../admin/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { USERS, agentFor, buildFormsWorld, exportAudits, getForm } from './world.js';
import type { FormsWorld } from './world.js';

let pool: Pool;
let migrator: Pool;
let fw: FormsWorld;

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
  fw = await buildFormsWorld(pool);
});

const REASON = 'Booth 1 sheet was typed with A and B swapped';

/** Corrects psW1 booth 1 so that B wins (A 230, B 310). */
async function correctPsW1(): Promise<void> {
  const ro = await declareClient(fw.app, USERS.ro1);
  const { w, psFilled } = fw;
  const changes = [
    {
      kind: 'BOOTH',
      entryId: psFilled.entries.b1,
      rowVersion: 1,
      sheetTotal: 510,
      votes: v([
        [w.c.A, 200],
        [w.c.B, 300],
        [w.c.N1, 10],
      ]),
    },
  ];
  const preview = await ro.dpost(`/wards/${String(w.psW1)}/correction/preview`, { changes });
  const after = (preview.body as { after: Parameters<typeof confirmBody>[0] }).after;
  const res = await ro.dpost(`/wards/${String(w.psW1)}/correction`, {
    ...confirmBody(after),
    reason: REASON,
    changes,
  });
  if (res.status !== 201) throw new Error(`correction: ${res.status} ${JSON.stringify(res.body)}`);
}

describe('correction versions', () => {
  it('the forms use the current (corrected) declaration: new winner, version 2 in the audit', async () => {
    await correctPsW1();
    const src = await readFormSource(pool, fw.w.psW1);
    expect(src.result.declaration).toMatchObject({ version: 2, winnerCandidateId: fw.w.c.B });
    expect(src.result.winnerCandidateId).toBe(fw.w.c.B);

    const res = await getForm(
      await agentFor(fw.app, USERS.ro1),
      `/api/ward-forms/${String(fw.w.psW1)}/part2.pdf`,
    );
    expect(res.status).toBe(200);
    expect((await exportAudits(pool)).at(-1)?.newValue).toMatchObject({ declaration_version: 2 });
  });
});

describe('votes changed behind a declaration', () => {
  it('is refused (409 DECLARATION_MISMATCH), never printed', async () => {
    const [rows] = await migrator.execute<RowDataPacket[]>(
      'SELECT id FROM booth_entry WHERE ward_id = ? AND booth_id = ?',
      [fw.w.zW1, fw.w.b1],
    );
    const entryId = Number(rows[0]?.id);
    await migrator.execute(
      'UPDATE booth_entry_vote SET votes = votes + 1 WHERE entry_id = ? AND candidate_id = ?',
      [entryId, fw.w.c.F],
    );
    await migrator.execute('UPDATE booth_entry SET sheet_total = sheet_total + 1 WHERE id = ?', [
      entryId,
    ]);

    const dm = await agentFor(fw.app, USERS.dm);
    for (const form of ['part2', 'prarup7']) {
      const res = await getForm(dm, `/api/ward-forms/${String(fw.w.zW1)}/${form}.pdf`);
      expect([form, res.status, res.body]).toEqual([form, 409, { error: 'DECLARATION_MISMATCH' }]);
    }
  });
});

describe('Prarup-7 header facts', () => {
  it('ZP ward: the Zila Parishad of the district, its ZP ward count, PS names from the booths', async () => {
    const src = await readFormSource(pool, fw.w.zW1);
    expect(src.panchayatSamitis).toEqual(['पंचायत समिति चूरू', 'पंचायत समिति राजगढ़']);
    expect(src.body).toEqual({ name: 'चूरू', wardCount: 1 });
    expect(src.district).toBe('चूरू');
    expect(src.ward.reservation).toBe('सामान्य महिला');
  });

  it('PS ward: its own Panchayat Samiti and that PS’s ward count; no PS list', async () => {
    const src = await readFormSource(pool, fw.w.psW1);
    // PS 1 has wards psW1, psW3 and psW4 (counting/helpers.ts buildWorld).
    expect(src.body).toEqual({ name: 'पंचायत समिति चूरू', wardCount: 3 });
    expect(src.panchayatSamitis).toEqual([]);
    expect(src.district).toBe('चूरू');
  });

  it('the election date: blank until the DM sets it; DM only; audited; validated', async () => {
    expect((await readFormSource(pool, fw.w.zW1)).electionDate).toBeNull();
    const path = '/api/admin/settings/election-date';
    const dm = await apiClient(fw.app, USERS.dm);

    expect((await dm.get(path)).body).toEqual({ date: null });
    expect((await dm.post(path, { date: '2026-02-30' })).status).toBe(400);
    expect((await dm.post(path, { date: '20.11.2026' })).status).toBe(400);
    expect((await dm.post(path, { date: '2026-11-20' })).status).toBe(200);
    expect((await dm.post(path, { date: '2026-11-20' })).body).toEqual({ error: 'NO_CHANGE' });
    expect((await readFormSource(pool, fw.w.zW1)).electionDate).toBe('2026-11-20');
    expect((await dm.post(path, { date: '' })).status).toBe(200);
    expect((await readFormSource(pool, fw.w.zW1)).electionDate).toBeNull();

    const audits = await auditOf(pool, 'SETTING_CHANGED');
    expect(audits.map((a): unknown[] => [a.old_value, a.new_value])).toEqual([
      [{ election_date: null }, { election_date: '2026-11-20' }],
      [{ election_date: '2026-11-20' }, { election_date: null }],
    ]);

    for (const user of [USERS.zp, USERS.ro1]) {
      const ro = await apiClient(fw.app, user);
      expect((await ro.post(path, { date: '2026-11-21' })).status).toBe(403);
      expect((await ro.get(path)).status).toBe(403);
    }
  });
});
