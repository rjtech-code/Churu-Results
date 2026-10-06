// tsx tests/e2e-support/seed-e2e.ts <out.json>
// E2E ONLY (Playwright, Part 8). Empties the *_test database and builds a small district with one
// ward per browser scenario. Entries are made through the real API (in-process), never by SQL.
// Refuses to run against anything but a *_test database (loadTestEnv + resetData guards).
import { writeFileSync } from 'node:fs';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { createMigrationKnex } from '../../src/db/knex-config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SCREEN_LAYOUT_KEY } from '../../src/services/screen-layout.js';
import type { ScreenLayout } from '../../src/services/screen-layout.js';
import { buildApp, createUser, csrfToken, login, seedTwoPs } from '../auth/helpers.js';
import {
  createTestAppPool,
  createTestMigrationPool,
  insert,
  resetData,
  testEnv,
} from '../helpers/db.js';

export const E2E_PASSWORD = 'E2e-Counting-Pass-1';

type Votes = [number, number, number]; // A, B, NOTA

interface Scenario {
  key: string;
  wardNo: number;
  booths: { no: number; votes: Votes | null }[];
  postal: Votes | null;
  declare?: boolean;
}

/** PS Churu wards, one per scenario. Booth numbers are unique within the PS. */
const SCENARIOS: Scenario[] = [
  {
    key: 'entry',
    wardNo: 1,
    booths: [
      { no: 1, votes: null },
      { no: 2, votes: null },
    ],
    postal: null,
  },
  {
    key: 'edit',
    wardNo: 2,
    booths: [
      { no: 3, votes: [100, 50, 5] },
      { no: 4, votes: [80, 40, 2] },
    ],
    postal: null,
  },
  { key: 'postal', wardNo: 3, booths: [{ no: 5, votes: [200, 100, 10] }], postal: null },
  { key: 'ready', wardNo: 4, booths: [{ no: 6, votes: [300, 200, 10] }], postal: [5, 3, 1] },
  { key: 'tie', wardNo: 5, booths: [{ no: 7, votes: [150, 150, 10] }], postal: [2, 2, 0] },
  { key: 'nota', wardNo: 6, booths: [{ no: 8, votes: [100, 120, 400] }], postal: [1, 1, 1] },
  {
    key: 'correction',
    wardNo: 7,
    booths: [{ no: 9, votes: [250, 100, 5] }],
    postal: [4, 1, 0],
    declare: true,
  },
];

export interface E2eWard {
  id: number;
  wardNo: number;
  booths: Record<number, number>; // booth no -> booth id
  candidates: { A: number; B: number; NOTA: number };
  entries: Record<number, number>; // booth no -> entry id
  postalEntry: number | null;
}

export interface E2eWorld {
  password: string;
  /** One active PS_RO per PS is allowed: ro = Churu (most specs), roOther = Rajgarh. */
  users: { ro: string; roOther: string; zp: string; dm: string };
  wards: Record<string, E2eWard>;
  otherPsWard: number;
}

async function migrate(): Promise<void> {
  const db = createMigrationKnex(testEnv, 'test');
  try {
    await runMigrations(db, testEnv, 'test', 'latest');
  } finally {
    await db.destroy();
  }
}

async function seed(app: Pool, migrator: Pool): Promise<E2eWorld> {
  await resetData(migrator);
  const { ps1, ps2 } = await seedTwoPs(app);
  // The default screen layout names all real PS; this district has only these two.
  const layout: ScreenLayout = {
    '1': ['CHURU PANCHAYAT SAMITI'],
    '2': ['RAJGARH PANCHAYAT SAMITI'],
  };
  await app.execute('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?', [
    JSON.stringify(layout),
    SCREEN_LAYOUT_KEY,
  ]);
  const ward = (type: 'PS' | 'ZP', ps: number | null, no: number) =>
    insert(
      app,
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const zpWard = await ward('ZP', null, 1); // no candidates, never locked: ZP side unused here
  const booth = (ps: number, no: number, psWard: number) =>
    insert(
      app,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, 1000)`,
      [ps, no, `राजकीय विद्यालय ${no}`, psWard, zpWard],
    );
  const candidates = async (w: number) => {
    const c = (pos: number, name: string, nota: boolean) =>
      insert(
        app,
        'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, ?, ?, ?, ?)',
        [w, pos, name, nota ? null : 'M', nota ? 1 : 0],
      );
    return {
      A: await c(1, 'अमर सिंह', false),
      B: await c(2, 'भरत कुमार', false),
      NOTA: await c(3, 'नोटा', true),
    };
  };
  const lock = (w: number) =>
    app.execute(
      "UPDATE ward SET is_locked = 1, locked_at = NOW(3), locked_by_name = 'E2E' WHERE id = ?",
      [w],
    );

  const wards: Record<string, E2eWard> = {};
  for (const s of SCENARIOS) {
    const id = await ward('PS', ps1, s.wardNo);
    const booths: Record<number, number> = {};
    for (const b of s.booths) booths[b.no] = await booth(ps1, b.no, id);
    wards[s.key] = {
      id,
      wardNo: s.wardNo,
      booths,
      candidates: await candidates(id),
      entries: {},
      postalEntry: null,
    };
    await lock(id);
  }
  const otherPsWard = await ward('PS', ps2, 1);
  await booth(ps2, 1, otherPsWard);
  await candidates(otherPsWard);
  await lock(otherPsWard);

  const users = {
    ro: 'e2e_ro_churu',
    roOther: 'e2e_ro_rajgarh',
    zp: 'e2e_zp_ro',
    dm: 'e2e_dm',
  };
  for (const [username, role, psId] of [
    [users.ro, 'PS_RO', ps1],
    [users.roOther, 'PS_RO', ps2],
    [users.zp, 'ZP_RO', null],
    [users.dm, 'DM', null],
  ] as const) {
    await createUser(app, { username, role, psId, password: E2E_PASSWORD });
  }

  // Entries and declarations through the real API, as the Churu RO.
  const server = buildApp(app);
  const agent = request.agent(server);
  if ((await login(agent, users.ro, E2E_PASSWORD)).status !== 200)
    throw new Error('seed login failed');
  const token = await csrfToken(agent);
  const post = async (path: string, body: object) => {
    const res = await agent.post(path).set('X-CSRF-Token', token).send(body);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`seed ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as Record<string, unknown>;
  };
  for (const s of SCENARIOS) {
    const w = wards[s.key];
    if (w === undefined) continue;
    const rows = ([a, b, n]: Votes) => [
      { candidateId: w.candidates.A, votes: a },
      { candidateId: w.candidates.B, votes: b },
      { candidateId: w.candidates.NOTA, votes: n },
    ];
    for (const b of s.booths) {
      if (b.votes === null) continue;
      const body = await post('/api/counting/entries', {
        wardId: w.id,
        boothId: w.booths[b.no],
        ballotFor: 'PS',
        roundNo: 1,
        sheetTotal: b.votes[0] + b.votes[1] + b.votes[2],
        votes: rows(b.votes),
      });
      w.entries[b.no] = (body.entry as { id: number }).id;
    }
    if (s.postal !== null) {
      const body = await post(`/api/counting/wards/${w.id}/postal`, {
        sheetTotal: s.postal[0] + s.postal[1] + s.postal[2],
        votes: rows(s.postal),
      });
      w.postalEntry = (body.entry as { id: number }).id;
    }
    if (s.declare === true) {
      const preview = await post(`/api/declare/wards/${w.id}/preview`, {});
      const result = preview.result as { leader: { candidateId: number }; totalValidVotes: number };
      await post(`/api/declare/wards/${w.id}`, {
        password: E2E_PASSWORD,
        confirmWinnerCandidateId: result.leader.candidateId,
        confirmTotalValidVotes: result.totalValidVotes,
      });
    }
  }
  return { password: E2E_PASSWORD, users, wards, otherPsWard };
}

const out = process.argv[2];
if (out === undefined) throw new Error('usage: tsx tests/e2e-support/seed-e2e.ts <out.json>');
await migrate();
const appPool = createTestAppPool();
const migrationPool = createTestMigrationPool();
try {
  const world = await seed(appPool, migrationPool);
  writeFileSync(out, JSON.stringify(world, null, 2));
  console.log(`E2E data seeded in ${testEnv.TEST_DB}; world written to ${out}`);
} finally {
  await appPool.end();
  await migrationPool.end();
}
