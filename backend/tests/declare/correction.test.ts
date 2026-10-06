import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDeclarationSnapshot } from '../../src/services/result.js';
import type { WardResult } from '../../src/services/result.js';
import { loadWardResult } from '../../src/services/result-loader.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, captureEvents, tableCounts, v } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { appFor, confirmBody, declareClient, fillPsW1, previewResult } from './helpers.js';
import type { DeclareClient, FilledWard } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let ro: DeclareClient;
let filled: FilledWard;

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
  ro = await declareClient(appFor(pool), 'ro_ps1_x1');
  filled = await fillPsW1(ro, w); // A 330, B 210, NOTA 13
  const result = await previewResult(ro, w.psW1);
  const res = await ro.dpost(`/wards/${w.psW1}`, confirmBody(result));
  if (res.status !== 201) throw new Error('declare failed');
});

const REASON = 'Booth 1 sheet was typed with A and B swapped';

/** Booth 1 corrected: A 200, B 300, NOTA 10 -> A 230, B 310: B now wins by 80. */
function swapB1(rowVersion = 1) {
  return {
    kind: 'BOOTH',
    entryId: filled.entries.b1,
    rowVersion,
    sheetTotal: 510,
    votes: v([
      [w.c.A, 200],
      [w.c.B, 300],
      [w.c.N1, 10],
    ]),
  };
}

async function versions(): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM ward_declarations WHERE ward_id = ? ORDER BY version',
    [w.psW1],
  );
  return rows;
}

function correctionBody(
  after: WardResult,
  changes: unknown[],
  extra: Record<string, unknown> = {},
) {
  return { ...confirmBody(after), reason: REASON, changes, ...extra };
}

async function previewAfter(changes: unknown[]): Promise<WardResult> {
  const res = await ro.dpost(`/wards/${w.psW1}/correction/preview`, { changes });
  if (res.status !== 200)
    throw new Error(`correction preview ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { after: WardResult }).after;
}

describe('post-declare correction', () => {
  it('preview shows before/after and the next version, and writes nothing', async () => {
    const before = await tableCounts(pool);
    const res = await ro.dpost(`/wards/${w.psW1}/correction/preview`, { changes: [swapB1()] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      before: { status: 'DECLARED', leader: { candidateId: w.c.A } },
      after: { status: 'READY_TO_DECLARE', leader: { candidateId: w.c.B }, margin: 80 },
      wouldStore: { version: 2, status: 'DECLARED', winnerCandidateId: w.c.B, margin: 80 },
    });
    expect(await tableCounts(pool)).toEqual(before);
  });

  it('a correction that changes the winner: v2 stored, v1 unchanged, entries updated, audited, event once', async () => {
    const v1Before = (await versions())[0];
    const after = await previewAfter([swapB1()]);
    const cap = captureEvents();
    let res;
    try {
      res = await ro.dpost(`/wards/${w.psW1}/correction`, correctionBody(after, [swapB1()]));
      expect(cap.events).toEqual([{ wardId: w.psW1 }]);
    } finally {
      cap.stop();
    }
    expect(res.status).toBe(201);
    const body = res.body as { declaration: Record<string, unknown>; result: WardResult };
    expect(body.declaration).toMatchObject({
      version: 2,
      status: 'DECLARED',
      winner: { id: w.c.B },
      margin: 80,
      correctionReason: REASON,
    });
    expect(body.result).toMatchObject({
      status: 'DECLARED',
      winnerCandidateId: w.c.B,
      declaration: { version: 2 },
      declarationMismatch: false,
    });
    expect(body.result.leader?.candidateId).toBe(w.c.B);

    const rows = await versions();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(v1Before); // version 1 kept exactly as it was
    expect(rows[1]?.snapshot).toEqual(buildDeclarationSnapshot(after));

    const [entry] = await pool.execute<RowDataPacket[]>(
      'SELECT row_version FROM booth_entry WHERE id = ?',
      [filled.entries.b1],
    );
    expect(entry[0]?.row_version).toBe(2);
    const [updated] = await pool.execute<RowDataPacket[]>(
      "SELECT reason, new_value FROM audit_log WHERE action = 'ENTRY_UPDATED'",
    );
    expect(updated[0]).toMatchObject({
      reason: REASON,
      new_value: { correction_version: 2, sheet_total: 510 },
    });
    const [corrected] = await pool.execute<RowDataPacket[]>(
      "SELECT old_value, new_value, reason FROM audit_log WHERE action = 'WARD_CORRECTED'",
    );
    expect(corrected[0]).toMatchObject({
      reason: REASON,
      old_value: { version: 1, winner_candidate_id: w.c.A, margin: 120, total_valid_votes: 553 },
      new_value: { version: 2, winner_candidate_id: w.c.B, margin: 80, total_valid_votes: 553 },
    });
  });

  it('a correction that creates a tie requires a lottery -> TIE_RESOLVED v2', async () => {
    // b1 becomes A 240 / B 260: A = 330 - 300 + 240 = 270, B = 210 - 200 + 260 = 270 -> tie.
    const change = {
      ...swapB1(),
      sheetTotal: 510,
      votes: v([
        [w.c.A, 240],
        [w.c.B, 260],
        [w.c.N1, 10],
      ]),
    };
    const after = await previewAfter([change]);
    expect(after.status).toBe('TIE_NEEDS_LOTTERY');
    const base = correctionBody(after, [change], { confirmWinnerCandidateId: w.c.A });
    const noLottery = await ro.dpost(`/wards/${w.psW1}/correction`, base);
    expect((noLottery.body as { error: string }).error).toBe('LOTTERY_REQUIRED');
    const ok = await ro.dpost(`/wards/${w.psW1}/correction`, {
      ...base,
      lottery: {
        winnerCandidateId: w.c.A,
        conductedBy: 'RO Churu',
        note: 'Re-drawn after the correction',
      },
    });
    expect(ok.status).toBe(201);
    expect((ok.body as { declaration: unknown }).declaration).toMatchObject({
      version: 2,
      status: 'TIE_RESOLVED',
      margin: 0,
      winner: { id: w.c.A },
    });
  });

  it('a postal correction: rejectedCount kept when omitted, cleared with null', async () => {
    const postal = (rejectedCount?: number | null) => ({
      kind: 'POSTAL',
      entryId: filled.entries.postal,
      rowVersion: 1,
      sheetTotal: 7,
      ...(rejectedCount === undefined ? {} : { rejectedCount }),
      votes: v([
        [w.c.A, 5],
        [w.c.B, 1],
        [w.c.N1, 1],
      ]),
    });
    const after = await previewAfter([postal()]);
    const res = await ro.dpost(`/wards/${w.psW1}/correction`, correctionBody(after, [postal()]));
    expect(res.status).toBe(201);
    expect((res.body as { result: WardResult }).result.rejectedPostal).toBeNull(); // was never set
  });

  it('stale rowVersion -> STALE_VERSION; nothing written', async () => {
    const after = await previewAfter([swapB1()]);
    const res = await ro.dpost(`/wards/${w.psW1}/correction`, correctionBody(after, [swapB1(7)]));
    expect(res.body).toMatchObject({ error: 'STALE_VERSION', currentRowVersion: 1 });
    expect(await versions()).toHaveLength(1);
  });

  it('NO_CHANGE: identical numbers, or a round-only change', async () => {
    const same = {
      kind: 'BOOTH',
      entryId: filled.entries.b1,
      rowVersion: 1,
      sheetTotal: 510,
      votes: v([
        [w.c.A, 300],
        [w.c.B, 200],
        [w.c.N1, 10],
      ]),
    };
    const result = await loadWardResult(pool, w.psW1);
    const res = await ro.dpost(`/wards/${w.psW1}/correction`, correctionBody(result, [same]));
    expect([res.status, res.body]).toEqual([400, { error: 'NO_CHANGE' }]);
    const roundOnly = await ro.dpost(
      `/wards/${w.psW1}/correction`,
      correctionBody(result, [{ ...same, roundNo: 9 }]),
    );
    expect(roundOnly.body).toEqual({ error: 'NO_CHANGE' });
    expect(
      (await ro.dpost(`/wards/${w.psW1}/correction/preview`, { changes: [same] })).body,
    ).toEqual({ error: 'NO_CHANGE' });
  });

  it('reason is required (10-500 characters)', async () => {
    const after = await previewAfter([swapB1()]);
    for (const reason of [undefined, 'short', 'x'.repeat(501)]) {
      const res = await ro.dpost(`/wards/${w.psW1}/correction`, {
        ...correctionBody(after, [swapB1()]),
        reason,
      });
      expect((res.body as { error: string }).error).toBe('VALIDATION_FAILED');
    }
  });

  it('an entry of another ward -> 400 ENTRY_NOT_IN_WARD', async () => {
    // A zW1 entry of booth b1 (entered by the ZP_RO), used in a psW1 correction.
    const zp = await declareClient(appFor(pool), 'zp_ro_x3');
    const zEntry = await zp.post('/entries', {
      wardId: w.zW1,
      boothId: w.b1,
      ballotFor: 'ZP',
      roundNo: 1,
      sheetTotal: 2,
      votes: v([
        [w.c.E, 1],
        [w.c.F, 1],
        [w.c.N3, 0],
      ]),
    });
    const id = (zEntry.body as { entry: { id: number } }).entry.id;
    const change = {
      kind: 'BOOTH',
      entryId: id,
      rowVersion: 1,
      sheetTotal: 2,
      votes: v([
        [w.c.E, 2],
        [w.c.F, 0],
        [w.c.N3, 0],
      ]),
    };
    const res = await ro.dpost(`/wards/${w.psW1}/correction/preview`, { changes: [change] });
    expect([res.status, res.body]).toEqual([
      400,
      { error: 'ENTRY_NOT_IN_WARD', kind: 'BOOTH', entryId: id },
    ]);
  });

  it('an undeclared ward -> 409 NOT_DECLARED', async () => {
    const zp = await declareClient(appFor(pool), 'zp_ro_x3');
    const res = await zp.dpost(`/wards/${w.zW1}/correction/preview`, { changes: [swapB1()] });
    expect([res.status, res.body]).toEqual([409, { error: 'NOT_DECLARED' }]);
  });

  it('the Part 5 sheet rules apply inside changes', async () => {
    const result = await loadWardResult(pool, w.psW1);
    const cases: [unknown, string][] = [
      [{ ...swapB1(), sheetTotal: 511 }, 'SUM_MISMATCH'],
      [
        {
          ...swapB1(),
          sheetTotal: 500,
          votes: v([
            [w.c.A, 200],
            [w.c.B, 300],
          ]),
        },
        'VOTES_INCOMPLETE',
      ],
      [
        {
          ...swapB1(),
          sheetTotal: 1001,
          votes: v([
            [w.c.A, 701],
            [w.c.B, 290],
            [w.c.N1, 10],
          ]),
        },
        'EXCEEDS_REGISTERED_VOTERS',
      ],
      [
        {
          ...swapB1(),
          sheetTotal: 511,
          votes: [...swapB1().votes, { candidateId: w.c.C, votes: 1 }],
        },
        'UNKNOWN_CANDIDATE',
      ],
      [{ ...swapB1(), rejectedCount: 3 }, 'VALIDATION_FAILED'], // booth changes have no rejectedCount
      [
        {
          kind: 'POSTAL',
          entryId: filled.entries.postal,
          rowVersion: 1,
          roundNo: 2,
          sheetTotal: 0,
          votes: [],
        },
        'VALIDATION_FAILED',
      ],
    ];
    for (const [change, code] of cases) {
      const res = await ro.dpost(`/wards/${w.psW1}/correction`, correctionBody(result, [change]));
      expect((res.body as { error: string }).error, code).toBe(code);
    }
    const dup = await ro.dpost(
      `/wards/${w.psW1}/correction`,
      correctionBody(result, [swapB1(), swapB1()]),
    );
    expect(dup.body).toMatchObject({ error: 'DUPLICATE_CHANGE' });
    expect(await versions()).toHaveLength(1);
  });

  it('wrong password -> REAUTH_FAILED; nothing changed', async () => {
    const after = await previewAfter([swapB1()]);
    const res = await ro.dpost(`/wards/${w.psW1}/correction`, {
      ...correctionBody(after, [swapB1()]),
      password: 'wrong-password',
    });
    expect([res.status, res.body]).toEqual([401, { error: 'REAUTH_FAILED' }]);
    expect(await versions()).toHaveLength(1);
  });
});
