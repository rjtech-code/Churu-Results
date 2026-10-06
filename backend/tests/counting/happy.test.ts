import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  captureEvents,
  clientFor,
  count,
  countingApp,
  psW1Sheet,
  tableCounts,
  v,
  zW1Sheet,
} from './helpers.js';
import { buildWorld } from './helpers.js';
import type { World } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;

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
  w = await buildWorld(pool);
});

const REASON = 'Typing mistake corrected after recheck';

async function auditRows(action: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM audit_log WHERE action = ? ORDER BY id',
    [action],
  );
  return rows;
}

describe('booth entries — happy paths', () => {
  it('PS_RO creates a PS entry for a booth of its own PS: 201, COUNTING, audit row, one event', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const cap = captureEvents();
    try {
      const res = await ro.post('/entries', psW1Sheet(w, w.b1));
      expect(res.status).toBe(201);
      const body = res.body as {
        entry: Record<string, unknown>;
        wardResult: Record<string, unknown>;
        warnings: string[];
      };
      expect(body.entry).toMatchObject({
        kind: 'BOOTH',
        wardId: w.psW1,
        boothId: w.b1,
        ballotFor: 'PS',
        roundNo: 1,
        sheetTotal: 510,
        rowVersion: 1,
        enteredBy: { username: 'ro_ps1_x1' },
        updatedBy: null,
        votes: v([
          [w.c.A, 300],
          [w.c.B, 200],
          [w.c.N1, 10],
        ]),
      });
      expect(body.wardResult).toMatchObject({
        wardId: w.psW1,
        status: 'COUNTING',
        boothsEntered: 1,
        boothsTotal: 3,
      });
      expect(body.warnings).toEqual([]);
      expect(cap.events).toEqual([{ wardId: w.psW1 }]);
    } finally {
      cap.stop();
    }
    const [audit] = await auditRows('ENTRY_CREATED');
    expect(audit).toMatchObject({
      user_id: w.users.ro1,
      entity: 'booth_entry',
      new_value: { ward_id: w.psW1, booth_id: w.b1, ballot_for: 'PS', sheet_total: 510 },
    });
    expect(String(audit?.ip)).toMatch(/127\.0\.0\.1|::1/);
  });

  it('ZP_RO creates ZP entries for booths in any PS', async () => {
    const zp = await clientFor(countingApp(pool), 'zp_ro_x3');
    expect((await zp.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);
    const res = await zp.post('/entries', zW1Sheet(w, w.b3)); // booth of ps2
    expect(res.status).toBe(201);
    expect(
      (res.body as { wardResult: { boothsEntered: number; boothsTotal: number } }).wardResult,
    ).toMatchObject({
      boothsEntered: 2,
      boothsTotal: 6,
    });
  });

  it('the same booth can have a PS entry (PS_RO) and a ZP entry (ZP_RO)', async () => {
    const app = countingApp(pool);
    expect(
      (await (await clientFor(app, 'ro_ps1_x1')).post('/entries', psW1Sheet(w, w.b1))).status,
    ).toBe(201);
    expect(
      (await (await clientFor(app, 'zp_ro_x3')).post('/entries', zW1Sheet(w, w.b1))).status,
    ).toBe(201);
  });

  it('preview returns the summary and the ward as it would become, and writes nothing (no event)', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    await ro.post('/entries', psW1Sheet(w, w.b2, 10, 20, 0));
    const before = await tableCounts(pool);
    const cap = captureEvents();
    try {
      const res = await ro.post('/entries/preview', psW1Sheet(w, w.b1));
      expect(res.status).toBe(200);
      const body = res.body as {
        summary: Record<string, unknown>;
        wardAfter: {
          candidates: { id: number; totalVotes: number }[];
          boothsEntered: number;
          status: string;
        };
      };
      expect(body.summary).toMatchObject({
        wardId: w.psW1,
        boothId: w.b1,
        ballotFor: 'PS',
        roundNo: 1,
        sheetTotal: 510,
        sum: 510,
        votes: [
          { candidateId: w.c.A, nameHindi: 'ए', isNota: false, votes: 300 },
          { candidateId: w.c.B, nameHindi: 'बी', isNota: false, votes: 200 },
          { candidateId: w.c.N1, nameHindi: 'नोटा', isNota: true, votes: 10 },
        ],
      });
      expect(body.wardAfter.boothsEntered).toBe(2);
      expect(body.wardAfter.candidates.map((c) => [c.id, c.totalVotes])).toEqual([
        [w.c.A, 310],
        [w.c.B, 220],
        [w.c.N1, 10],
      ]);
      expect(cap.events).toEqual([]);
    } finally {
      cap.stop();
    }
    expect(await tableCounts(pool)).toEqual(before);
    // A preview runs the same checks as create.
    const bad = await ro.post('/entries/preview', { ...psW1Sheet(w, w.b1), sheetTotal: 1 });
    expect(bad.body).toMatchObject({ error: 'SUM_MISMATCH' });
  });

  it('PUT with the right rowVersion and a reason updates votes, bumps rowVersion, audits old + new', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const created = await ro.post('/entries', psW1Sheet(w, w.b1));
    const entryId = (created.body as { entry: { id: number } }).entry.id;
    const cap = captureEvents();
    let res;
    try {
      res = await ro.put(`/entries/${entryId}`, {
        rowVersion: 1,
        roundNo: 2,
        sheetTotal: 511,
        votes: v([
          [w.c.A, 301],
          [w.c.B, 200],
          [w.c.N1, 10],
        ]),
        reason: REASON,
      });
      expect(cap.events).toEqual([{ wardId: w.psW1 }]);
    } finally {
      cap.stop();
    }
    expect(res.status).toBe(200);
    expect((res.body as { entry: unknown }).entry).toMatchObject({
      rowVersion: 2,
      roundNo: 2,
      sheetTotal: 511,
      updatedBy: { username: 'ro_ps1_x1' },
      votes: v([
        [w.c.A, 301],
        [w.c.B, 200],
        [w.c.N1, 10],
      ]),
    });
    const [audit] = await auditRows('ENTRY_UPDATED');
    expect(audit).toMatchObject({
      entity_id: String(entryId),
      reason: REASON,
      old_value: {
        sheet_total: 510,
        round_no: 1,
        row_version: 1,
        votes: v([
          [w.c.A, 300],
          [w.c.B, 200],
          [w.c.N1, 10],
        ]),
      },
      new_value: {
        sheet_total: 511,
        round_no: 2,
        row_version: 2,
        votes: v([
          [w.c.A, 301],
          [w.c.B, 200],
          [w.c.N1, 10],
        ]),
      },
    });
  });

  it('void archives the entry, audits it, frees the booth and the totals drop back', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    await ro.post('/entries', psW1Sheet(w, w.b2, 1, 2, 3));
    const created = await ro.post('/entries', psW1Sheet(w, w.b1));
    const entryId = (created.body as { entry: { id: number } }).entry.id;

    const res = await ro.post(`/entries/${entryId}/void`, {
      rowVersion: 1,
      reason: 'Entered on the wrong booth sheet',
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      voided: { archiveId: number; entryId: number };
      wardResult: { candidates: { id: number; totalVotes: number }[]; boothsEntered: number };
    };
    expect(body.voided.entryId).toBe(entryId);
    expect(body.wardResult.boothsEntered).toBe(1);
    expect(body.wardResult.candidates.map((c) => c.totalVotes)).toEqual([1, 2, 3]);

    const [archive] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM voided_entry WHERE id = ?',
      [body.voided.archiveId],
    );
    expect(archive[0]).toMatchObject({
      entry_kind: 'BOOTH',
      original_entry_id: entryId,
      ward_id: w.psW1,
      booth_id: w.b1,
      ballot_for: 'PS',
      sheet_total: 510,
      entered_by: w.users.ro1,
      voided_by: w.users.ro1,
      void_reason: 'Entered on the wrong booth sheet',
    });
    expect(
      (archive[0]?.votes as { candidateId: number; votes: number }[]).map((x) => [
        x.candidateId,
        x.votes,
      ]),
    ).toEqual([
      [w.c.A, 300],
      [w.c.B, 200],
      [w.c.N1, 10],
    ]);
    const [audit] = await auditRows('ENTRY_VOIDED');
    expect(audit).toMatchObject({
      reason: 'Entered on the wrong booth sheet',
      old_value: { booth_id: w.b1, sheet_total: 510 },
    });
    expect(await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry WHERE id = ?', [entryId])).toBe(
      0,
    );
    expect(
      await count(pool, 'SELECT COUNT(*) AS n FROM booth_entry_vote WHERE entry_id = ?', [entryId]),
    ).toBe(0);
    expect((await ro.get(`/entries/${entryId}`)).status).toBe(404);

    // The booth can be entered again.
    expect((await ro.post('/entries', psW1Sheet(w, w.b1, 5, 5, 5))).status).toBe(201);
  });

  it('a failed write emits no event', async () => {
    const ro = await clientFor(countingApp(pool), 'ro_ps1_x1');
    const cap = captureEvents();
    try {
      expect((await ro.post('/entries', { ...psW1Sheet(w, w.b1), sheetTotal: 1 })).status).toBe(
        400,
      );
      expect((await ro.post('/entries', psW1Sheet(w, w.b6))).status).toBe(400); // b6 is in psW4, not psW1
      expect(cap.events).toEqual([]);
    } finally {
      cap.stop();
    }
  });
});
