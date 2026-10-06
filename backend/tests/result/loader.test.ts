import mysql from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_TABLE_PRIVILEGES } from '../../src/db/grants.js';
import {
  buildDeclarationSnapshot,
  computeWardResult,
  ResultInputError,
} from '../../src/services/result.js';
import type { WardResultInput } from '../../src/services/result.js';
import {
  WardNotFoundError,
  loadWardResult,
  loadWardResults,
  withReadOnlySnapshot,
} from '../../src/services/result-loader.js';
import { createUser, seedTwoPs } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData, testEnv } from '../helpers/db.js';

let app: Pool;
let migrator: Pool;

beforeAll(() => {
  app = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await app.end();
  await migrator.end();
});

async function ins(sql: string, params: (string | number | null)[]): Promise<number> {
  const [r] = await app.execute<ResultSetHeader>(sql, params);
  return r.insertId;
}

interface World {
  ps1: number;
  ps2: number;
  psWard: number; // PS ward 1 of ps1
  zpWard: number; // spans ps1 and ps2
  booths: { b1: number; b2: number; b3: number }; // b1, b2 in ps1; b3 in ps2
  c: { psA: number; psB: number; psNota: number; zpA: number; zpB: number; zpNota: number };
  users: { ro: number; zp: number };
}

/** Builds a small district: ZP ward 1 spans booths of two Panchayat Samitis. */
async function buildWorld(): Promise<World> {
  const { ps1, ps2 } = await seedTwoPs(app);
  const ward = (type: string, ps: number | null, no: number) =>
    ins(
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const psWard = await ward('PS', ps1, 1);
  const psWard2 = await ward('PS', ps2, 1);
  const zpWard = await ward('ZP', null, 1);
  const booth = (ps: number, no: number, pw: number) =>
    ins(
      "INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, ?, 'बूथ', ?, ?)",
      [ps, no, pw, zpWard],
    );
  const booths = {
    b1: await booth(ps1, 1, psWard),
    b2: await booth(ps1, 2, psWard),
    b3: await booth(ps2, 1, psWard2),
  };
  const cand = (wardId: number, pos: number, name: string, nota = false) =>
    ins(
      'INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota) VALUES (?, ?, ?, NULL, ?, ?)',
      [wardId, pos, name, nota ? null : 'M', nota ? 1 : 0],
    );
  const c = {
    psA: await cand(psWard, 1, 'पीएस ए'),
    psB: await cand(psWard, 2, 'पीएस बी'),
    psNota: await cand(psWard, 3, 'नोटा', true),
    zpA: await cand(zpWard, 1, 'जेडपी ए'),
    zpB: await cand(zpWard, 2, 'जेडपी बी'),
    zpNota: await cand(zpWard, 3, 'नोटा', true),
  };
  const users = {
    ro: await createUser(app, {
      username: 'ro_one',
      role: 'PS_RO',
      psId: ps1,
      password: 'x-password-1',
    }),
    zp: await createUser(app, { username: 'zp_one', role: 'ZP_RO', password: 'x-password-1' }),
  };
  return { ps1, ps2, psWard, zpWard, booths, c, users };
}

async function boothEntry(
  w: World,
  boothId: number,
  ballot: 'PS' | 'ZP',
  round: number,
  votes: [number, number][],
) {
  const wardId = ballot === 'PS' ? w.psWard : w.zpWard;
  const total = votes.reduce((s, [, v]) => s + v, 0);
  const entry = await ins(
    'INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, ?, ?, ?, ?, ?)',
    [boothId, ballot, wardId, round, total, ballot === 'PS' ? w.users.ro : w.users.zp],
  );
  for (const [cid, v] of votes) {
    await ins(
      'INSERT INTO booth_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
      [entry, wardId, cid, v],
    );
  }
}

async function postalEntry(
  w: World,
  wardId: number,
  rejected: number | null,
  votes: [number, number][],
) {
  const total = votes.reduce((s, [, v]) => s + v, 0);
  const entry = await ins(
    'INSERT INTO postal_entry (ward_id, sheet_total, rejected_count, entered_by) VALUES (?, ?, ?, ?)',
    [wardId, total, rejected, w.users.zp],
  );
  for (const [cid, v] of votes) {
    await ins(
      'INSERT INTO postal_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
      [entry, wardId, cid, v],
    );
  }
}

describe('result loader', () => {
  let w: World;
  beforeEach(async () => {
    await resetData(migrator);
    w = await buildWorld();
  });

  it('a ZP ward loads the booths of both Panchayat Samitis, and equals the engine on hand-built input', async () => {
    const { b1, b2, b3 } = w.booths;
    const { zpA, zpB, zpNota } = w.c;
    await boothEntry(w, b1, 'ZP', 1, [
      [zpA, 10],
      [zpB, 4],
      [zpNota, 1],
    ]);
    await boothEntry(w, b3, 'ZP', 2, [
      [zpA, 2],
      [zpB, 9],
      [zpNota, 0],
    ]);
    await postalEntry(w, w.zpWard, 3, [
      [zpA, 1],
      [zpB, 1],
      [zpNota, 0],
    ]);

    const loaded = await loadWardResult(app, w.zpWard);
    const handBuilt: WardResultInput = {
      ward: { id: w.zpWard, kind: 'ZP', isUnopposed: false, boothIds: [b1, b2, b3] },
      candidates: [
        { id: zpA, ballotPosition: 1, nameHindi: 'जेडपी ए', partyId: null, isNota: false },
        { id: zpB, ballotPosition: 2, nameHindi: 'जेडपी बी', partyId: null, isNota: false },
        { id: zpNota, ballotPosition: 3, nameHindi: 'नोटा', partyId: null, isNota: true },
      ],
      boothEntries: [
        {
          boothId: b1,
          roundNo: 1,
          sheetTotal: 15,
          votes: [
            { candidateId: zpA, votes: 10 },
            { candidateId: zpB, votes: 4 },
            { candidateId: zpNota, votes: 1 },
          ],
        },
        {
          boothId: b3,
          roundNo: 2,
          sheetTotal: 11,
          votes: [
            { candidateId: zpA, votes: 2 },
            { candidateId: zpB, votes: 9 },
            { candidateId: zpNota, votes: 0 },
          ],
        },
      ],
      postalEntry: {
        sheetTotal: 2,
        rejectedCount: 3,
        votes: [
          { candidateId: zpA, votes: 1 },
          { candidateId: zpB, votes: 1 },
          { candidateId: zpNota, votes: 0 },
        ],
      },
      latestDeclaration: null,
    };
    expect(loaded).toEqual(computeWardResult(handBuilt));
    expect(loaded).toMatchObject({
      kind: 'ZP',
      boothsTotal: 3,
      boothsEntered: 2,
      status: 'COUNTING',
      roundsSeen: [1, 2],
      rejectedPostal: 3,
    });
    // A PS entry on booth b1 belongs to the PS ward only.
    expect((await loadWardResult(app, w.psWard)).boothsTotal).toBe(2);
  });

  it('reads the LATEST declaration version and checks it against its snapshot', async () => {
    const { b1, b2 } = w.booths;
    const { psA, psB, psNota } = w.c;
    await boothEntry(w, b1, 'PS', 1, [
      [psA, 7],
      [psB, 3],
      [psNota, 0],
    ]);
    await boothEntry(w, b2, 'PS', 1, [
      [psA, 1],
      [psB, 1],
      [psNota, 1],
    ]);
    await postalEntry(w, w.psWard, null, [
      [psA, 0],
      [psB, 0],
      [psNota, 0],
    ]);
    const ready = await loadWardResult(app, w.psWard);
    expect(ready.status).toBe('READY_TO_DECLARE');
    const snapshot = JSON.stringify(buildDeclarationSnapshot(ready));
    const declare = (version: number, reason: string | null, snap: string) =>
      ins(
        `INSERT INTO ward_declarations (ward_id, version, status, winner_candidate_id, margin, snapshot, declared_by, correction_reason)
         VALUES (?, ?, 'DECLARED', ?, 4, ?, ?, ?)`,
        [w.psWard, version, psA, snap, w.users.ro, reason],
      );
    await declare(1, null, JSON.stringify({ candidates: [] }));
    await declare(2, 'correction', snapshot);
    const declared = await loadWardResult(app, w.psWard);
    expect(declared).toMatchObject({
      status: 'DECLARED',
      winnerCandidateId: psA,
      margin: 4,
      declaration: { version: 2 },
      declarationMismatch: false,
    });
  });

  it('several wards at once; unknown wards throw WardNotFoundError; no ids -> empty map', async () => {
    const results = await loadWardResults(app, [w.zpWard, w.psWard, w.zpWard]);
    expect([...results.keys()].sort((a, b) => a - b)).toEqual(
      [w.psWard, w.zpWard].sort((a, b) => a - b),
    );
    expect(results.get(w.psWard)?.status).toBe('NOT_STARTED');
    await expect(loadWardResults(app, [w.psWard, 987_654])).rejects.toBeInstanceOf(
      WardNotFoundError,
    );
    await expect(loadWardResult(app, 987_654)).rejects.toThrow('Ward(s) not found: 987654');
    expect((await loadWardResults(app, [])).size).toBe(0);
  });

  it('invalid stored data surfaces as ResultInputError (e.g. an entry without vote rows)', async () => {
    await ins(
      "INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, 'PS', ?, 1, 0, ?)",
      [w.booths.b1, w.psWard, w.users.ro],
    );
    await expect(loadWardResult(app, w.psWard)).rejects.toBeInstanceOf(ResultInputError);
  });

  it('uses the same fixed number of queries for 1 ward and for 20 wards', async () => {
    // 19 more PS wards in ps1, each with a booth, 2 candidates + NOTA and one entry.
    const wardIds = [w.psWard];
    for (let i = 2; i <= 20; i++) {
      const wardId = await ins(
        "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT 'PS', district_id, id, ? FROM panchayat_samiti WHERE id = ?",
        [i, w.ps1],
      );
      const boothId = await ins(
        "INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, ?, 'बूथ', ?, ?)",
        [w.ps1, 100 + i, wardId, w.zpWard],
      );
      const a = await ins(
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 1, 'क', 'M', 0)",
        [wardId],
      );
      const b = await ins(
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 2, 'ख', 'F', 0)",
        [wardId],
      );
      const n = await ins(
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 3, 'नोटा', NULL, 1)",
        [wardId],
      );
      const entry = await ins(
        "INSERT INTO booth_entry (booth_id, ballot_for, ward_id, round_no, sheet_total, entered_by) VALUES (?, 'PS', ?, 1, 3, ?)",
        [boothId, wardId, w.users.ro],
      );
      for (const [cid, v] of [
        [a, 1],
        [b, 2],
        [n, 0],
      ] as const) {
        await ins(
          'INSERT INTO booth_entry_vote (entry_id, ward_id, candidate_id, votes) VALUES (?, ?, ?, ?)',
          [entry, wardId, cid, v],
        );
      }
      wardIds.push(wardId);
    }

    // One connection, so the server's per-session statement counter sees exactly the loader's work.
    const single = mysql.createPool({
      host: testEnv.DB_HOST,
      port: testEnv.DB_PORT,
      user: testEnv.DB_APP_USER,
      password: testEnv.DB_APP_PASSWORD,
      database: testEnv.TEST_DB,
      connectionLimit: 1,
    });
    try {
      const questions = async (): Promise<number> => {
        const [rows] = await single.query<RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Questions'");
        return Number(rows[0]?.Value);
      };
      const statementsFor = async (ids: number[]): Promise<number> => {
        const before = await questions();
        const results = await loadWardResults(single, ids);
        expect(results.size).toBe(ids.length);
        return (await questions()) - before - 1; // minus the second SHOW STATUS itself
      };
      await statementsFor([w.psWard]); // warm-up (prepared statement cache)
      const one = await statementsFor([w.psWard]);
      const twenty = await statementsFor(wardIds);
      expect(twenty).toBe(one);
      // SET TRANSACTION + START TRANSACTION + 8 data queries + COMMIT
      expect(one).toBe(11);
    } finally {
      await single.end();
    }
  });

  it('writes nothing: row counts are unchanged, and its transaction is READ ONLY', async () => {
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const table of Object.keys(APP_TABLE_PRIVILEGES)) {
        const [rows] = await app.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ??', [table]);
        out[table] = Number(rows[0]?.n);
      }
      return out;
    };
    const before = await counts();
    await loadWardResults(app, [w.psWard, w.zpWard]);
    expect(await counts()).toEqual(before);

    await expect(
      withReadOnlySnapshot(app, (conn) =>
        conn.execute("INSERT INTO app_settings (setting_key, setting_value) VALUES ('x', 'y')"),
      ),
    ).rejects.toMatchObject({ code: 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION' });
    expect(await counts()).toEqual(before);
  });
});
