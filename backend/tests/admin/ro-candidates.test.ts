import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NOTA_NAME_HINDI } from '../../src/services/master-data/candidates.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  auditWhoWhen,
  buildAdminWorld,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let ro: ApiClient;

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
  ro = await apiClient(app, 'ro_ps1_x1');
});

type G = 'M' | 'F' | 'O';
const c = (ballotPosition: number, nameHindi: string, partyId: number | null, gender: G = 'M') => ({
  ballotPosition,
  nameHindi,
  partyId,
  gender,
});
const save = (wardId: number, candidates: ReturnType<typeof c>[]) =>
  ro.put(`/api/candidates/wards/${wardId}`, { candidates });
const errorsOf = (body: unknown) =>
  ((body as { errors?: { message: string }[] }).errors ?? []).map((e) => e.message);

async function wardRow(id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT is_unopposed, candidates_ready_by, candidates_return_reason FROM ward WHERE id = ?',
    [id],
  );
  return rows[0];
}
async function names(id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT ballot_position AS pos, name_hindi AS name, is_nota AS nota FROM candidate WHERE ward_id = ? ORDER BY ballot_position',
    [id],
  );
  return rows;
}

describe('RO candidate list', () => {
  it('saves the whole list, adds NOTA at N+1, and is audited with old and new values', async () => {
    const res = await save(w.psW5, [c(2, 'सीता', null, 'F'), c(1, 'राम', w.p1)]);
    expect([res.status, res.body]).toEqual([200, { candidates: 2, unopposed: false }]);
    expect(await names(w.psW5)).toEqual([
      { pos: 1, name: 'राम', nota: 0 },
      { pos: 2, name: 'सीता', nota: 0 },
      { pos: 3, name: NOTA_NAME_HINDI, nota: 1 },
    ]);
    const [audit] = await auditOf(pool, 'CANDIDATES_SAVED');
    expect(audit?.user_id).toBe(w.users.ro1);
    expect(audit?.old_value).toEqual({ candidates: [], ready: false });

    // Edit: delete one -> unopposed, no NOTA.
    const one = await save(w.psW5, [c(1, 'राम', w.p1)]);
    expect(one.body).toEqual({ candidates: 1, unopposed: true });
    expect(await names(w.psW5)).toEqual([{ pos: 1, name: 'राम', nota: 0 }]);
    expect((await wardRow(w.psW5))?.is_unopposed).toBe(1);

    // Identical save: NO_CHANGE, nothing written.
    const before = await masterSnapshot(pool);
    expect((await save(w.psW5, [c(1, 'राम', w.p1)])).body).toEqual({ error: 'NO_CHANGE' });
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('the importer rules apply: gaps, repeats, a party twice, an empty name, an unknown party', async () => {
    const before = await masterSnapshot(pool);
    const gaps = await save(w.psW5, [c(1, 'राम', null), c(3, 'श्याम', null)]);
    expect(gaps.status).toBe(400);
    expect(errorsOf(gaps.body)).toEqual([
      'पंचायत समिति चूरू वार्ड 5 में बैलेट नंबर 1 से 2 तक बिना छूटे होने चाहिए; अभी हैं: 1, 3 — इसे ठीक करके फिर से सेव करें',
    ]);
    const repeat = await save(w.psW5, [c(1, 'राम', w.p1), c(1, 'श्याम', w.p1)]);
    expect(errorsOf(repeat.body)).toContain(
      'पंचायत समिति चूरू वार्ड 5 में बैलेट नंबर 1 दो बार है — इसे ठीक करके फिर से सेव करें',
    );
    expect(errorsOf(repeat.body)).toContain(
      'पंचायत समिति चूरू वार्ड 5 में पार्टी "P1" के एक से अधिक उम्मीदवार हैं — इसे ठीक करके फिर से सेव करें',
    );
    // Independents may be several.
    expect((await save(w.psW5, [c(1, 'अ', null), c(2, 'ब', null)])).status).toBe(200);
    const after = await masterSnapshot(pool);
    expect(after).not.toBe(before);
    const empty = await save(w.psW5, [c(1, '   ', null)]);
    expect(errorsOf(empty.body)[0]).toContain('"हिंदी नाम" खाली है');
    const unknown = await save(w.psW5, [c(1, 'अ', 999_999)]);
    expect(errorsOf(unknown.body)[0]).toContain('पार्टी सूची में नहीं है');
    expect(await masterSnapshot(pool)).toBe(after);
  });

  it('no change is possible once the ballot is locked, or once a counting entry exists', async () => {
    const before = await masterSnapshot(pool);
    const locked = await save(w.psW1, [c(1, 'नया', null)]);
    expect(locked.status).toBe(400);
    expect(errorsOf(locked.body)[0]).toContain('की सूची लॉक है');
    expect((await ro.post(`/api/candidates/wards/${w.psW1}/ready`, {})).body).toEqual({
      error: 'BALLOT_LOCKED',
    });

    // An entry exists; even if the ward were unlocked again the list stays frozen.
    const entry = await ro.post('/api/counting/entries', {
      wardId: w.psW1,
      boothId: w.b1,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 2,
      votes: [
        { candidateId: w.c.A, votes: 1 },
        { candidateId: w.c.B, votes: 1 },
        { candidateId: w.c.N1, votes: 0 },
      ],
    });
    expect(entry.status).toBe(201);
    await pool.execute(
      'UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL WHERE id = ?',
      [w.psW1],
    );
    const withEntry = await save(w.psW1, [c(1, 'नया', null)]);
    expect(errorsOf(withEntry.body)[0]).toContain('में मतगणना शुरू हो चुकी है');
    const snapshot = JSON.parse(await masterSnapshot(pool)) as unknown[];
    expect(snapshot[1]).toEqual((JSON.parse(before) as unknown[])[1]); // candidates untouched
  });

  it('mark ready (no password), DM sends back (reason), an RO save clears ready', async () => {
    expect((await ro.post(`/api/candidates/wards/${w.psW5}/ready`, {})).body).toEqual({
      error: 'LIST_EMPTY',
    });
    await save(w.psW5, [c(1, 'राम', w.p1), c(2, 'सीता', null, 'F')]);

    // A password is no longer accepted (strict body).
    const extra = await ro.post(`/api/candidates/wards/${w.psW5}/ready`, { password: PASSWORD });
    expect(extra.status).toBe(400);
    expect((await wardRow(w.psW5))?.candidates_ready_by).toBeNull();

    expect((await ro.post(`/api/candidates/wards/${w.psW5}/ready`, {})).status).toBe(200);
    expect((await wardRow(w.psW5))?.candidates_ready_by).toBe(w.users.ro1);
    expect(await auditWhoWhen(pool, 'CANDIDATES_READY')).toEqual([
      { userId: w.users.ro1, entityId: w.psW5, at: 'date' },
    ]);
    const list = (await ro.get('/api/candidates/wards')).body as {
      wards: { id: number; status: string; candidates: number }[];
    };
    expect(list.wards.find((x) => x.id === w.psW5)).toMatchObject({
      status: 'READY',
      candidates: 2,
    });

    const dm = await apiClient(app, 'dm_x4');
    const back = await dm.post(`/api/admin/wards/${w.psW5}/send-back`, {
      reason: 'बैलेट नंबर 2 का नाम गलत है',
    });
    expect(back.status).toBe(200);
    expect(await wardRow(w.psW5)).toMatchObject({
      candidates_ready_by: null,
      candidates_return_reason: 'बैलेट नंबर 2 का नाम गलत है',
    });
    const [audit] = await auditOf(pool, 'CANDIDATES_SENT_BACK');
    expect(audit?.reason).toBe('बैलेट नंबर 2 का नाम गलत है');
    expect(await auditWhoWhen(pool, 'CANDIDATES_SENT_BACK')).toEqual([
      { userId: w.users.dm, entityId: w.psW5, at: 'date' },
    ]);
    const ward = (await ro.get(`/api/candidates/wards/${w.psW5}`)).body as {
      ward: { status: string; returnReason: string };
    };
    expect(ward.ward).toMatchObject({
      status: 'PENDING',
      returnReason: 'बैलेट नंबर 2 का नाम गलत है',
    });

    // Ready again clears the reason; then an RO save clears ready.
    await ro.post(`/api/candidates/wards/${w.psW5}/ready`, {});
    expect((await wardRow(w.psW5))?.candidates_return_reason).toBeNull();
    await save(w.psW5, [c(1, 'राम', w.p1), c(2, 'सीता देवी', null, 'F')]);
    expect((await wardRow(w.psW5))?.candidates_ready_by).toBeNull();

    // Send back of a locked ward is refused.
    expect(
      (
        await dm.post(`/api/admin/wards/${w.psW1}/send-back`, {
          reason: 'कुछ भी गलत है',
        })
      ).body,
    ).toEqual({ error: 'BALLOT_LOCKED' });
  });
});
