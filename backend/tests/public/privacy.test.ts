import type { Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, psW1Sheet, v } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { PUBLIC_PATHS, getJson, nextVersion, publicApp } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let h: PublicHarness;

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
  h = await publicApp(pool);
});
afterEach(() => {
  h.stop();
});

/** Keys that must never appear anywhere in a public response (any nesting level). */
const FORBIDDEN_KEYS = [
  'username',
  'fullName',
  'full_name',
  'userId',
  'user_id',
  'enteredBy',
  'updatedBy',
  'declaredBy',
  'voidedBy',
  'ip',
  'entryId',
  'entry_id',
  'rowVersion',
  'row_version',
  'boothId',
  'booth_id',
  'booths',
  'registeredVoters',
  'registeredVotersTotal',
  'registered_voters_total',
  'registeredVotersMale',
  'registeredVotersFemale',
  'lottery',
  'lotteryDetails',
  'lottery_details',
  'conductedBy',
  'note',
  'notaHighestAck',
  'declarationMismatch',
  'audit',
  'oldValue',
  'newValue',
  'reason',
  'correctionReason',
  'snapshot',
  'password',
  'passwordHash',
  'candidateId',
];

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, child] of Object.entries(value)) {
      out.add(k);
      keysOf(child, out);
    }
  }
  return out;
}

describe('public responses never leak internal data', () => {
  it('no forbidden keys or secret values in any public endpoint, in a rich state', async () => {
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    // Tie at the top -> declared by lottery with a recognisable note and officer.
    await fillPsW1(ro, w, { b1: [10, 10, 1], b2: [10, 10, 1], b4: [10, 10, 1], postal: [0, 0, 0] });
    const result = await previewResult(ro, w.psW1);
    const declared = await ro.dpost(`/wards/${w.psW1}`, {
      password: 'Counting-Pass-1',
      confirmWinnerCandidateId: w.c.B,
      confirmTotalValidVotes: result.totalValidVotes,
      lottery: {
        winnerCandidateId: w.c.B,
        conductedBy: 'SECRET-OFFICER-NAME',
        note: 'SECRET-LOTTERY-NOTE-TEXT',
      },
    });
    expect(declared.status).toBe(201);
    const zp = await declareClient(h.app, 'zp_ro_x3');
    await zp.post('/entries', {
      wardId: w.zW1,
      boothId: w.b3,
      ballotFor: 'ZP',
      roundNo: 1,
      sheetTotal: 3,
      votes: v([
        [w.c.E, 2],
        [w.c.F, 1],
        [w.c.N3, 0],
      ]),
    });
    const ro2 = await declareClient(h.app, 'ro_ps2_x2');
    await ro2.post('/entries', {
      ...psW1Sheet(w, w.b3),
      wardId: w.psW2,
      votes: v([
        [w.c.C, 300],
        [w.c.D, 200],
        [w.c.N2, 10],
      ]),
    });
    await nextVersion(h, 0);
    await new Promise((r) => setTimeout(r, 250));

    const secrets = [
      'ro_ps1_x1',
      'zp_ro_x3',
      'ro_ps2_x2',
      'Full ro_ps1_x1',
      'SECRET-OFFICER-NAME',
      'SECRET-LOTTERY-NOTE-TEXT',
      '127.0.0.1',
      '::1',
      'Counting-Pass-1',
    ];
    for (const path of PUBLIC_PATHS) {
      const res = await getJson(h.app, path);
      expect(res.status, path).toBe(200);
      const keys = keysOf(res.body);
      for (const k of FORBIDDEN_KEYS)
        expect(keys.has(k), `${path} contains key "${k}"`).toBe(false);
      const text = JSON.stringify(res.body);
      for (const s of secrets) expect(text, `${path} contains "${s}"`).not.toContain(s);
    }
    // The data is there, just not the private parts.
    const winners = (await getJson(h.app, '/api/public/winners')).body as {
      items: { status: string; winner: { name: string } }[];
    };
    expect(winners.items[0]).toMatchObject({ status: 'TIE_RESOLVED', winner: { name: 'बी' } });
  });
});
