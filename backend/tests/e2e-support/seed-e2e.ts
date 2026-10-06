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
  /** Candidates beyond A and B (ballot positions 3..), before NOTA. */
  extraCandidates?: number;
}

/** Names for the extra candidates of a wide ballot. */
const EXTRA_NAMES = ['चंदन लाल', 'दिनेश शर्मा', 'ईश्वर प्रसाद', 'फतेह सिंह', 'गणेश राम', 'हरि ओम'];

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
  // The largest ballot the one-screen form must fit: 8 candidates + NOTA, nothing entered.
  { key: 'wide', wardNo: 8, booths: [{ no: 10, votes: null }], postal: null, extraCandidates: 6 },
];

export interface E2eWard {
  id: number;
  wardNo: number;
  booths: Record<number, number>; // booth no -> booth id
  candidates: { A: number; B: number; NOTA: number };
  /** Ballot positions 3.. (wide ballots only), in order. */
  extraCandidates: number[];
  entries: Record<number, number>; // booth no -> entry id
  postalEntry: number | null;
}

/** Part 9 (TV screens): a third PS on screen 2 and ZP wards 2-3 on screen 3. */
export interface E2eScreens {
  psName: string;
  roSardar: string;
  /** NOT_STARTED until a spec enters booth `boothId` through the API. */
  live: {
    wardId: number;
    wardNo: number;
    boothId: number;
    candidates: { A: number; B: number; NOTA: number };
  };
  declaredWardNo: number;
  correctedWardNo: number;
  unopposedWardNo: number;
  /** Two tied independents with the SAME name (identical on screen); the lottery winner is `winnerId`. */
  lottery: { wardNo: number; winnerId: number; loserId: number };
  /** Fully entered, READY_TO_DECLARE: a spec declares it as the ZP RO. */
  zpReady: { wardId: number; wardNo: number };
}

export interface E2eWorld {
  password: string;
  /** One active PS_RO per PS is allowed: ro = Churu (most specs), roOther = Rajgarh. */
  users: { ro: string; roOther: string; zp: string; dm: string };
  wards: Record<string, E2eWard>;
  otherPsWard: number;
  screens: E2eScreens;
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
  const ps3 = await insert(
    app,
    'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) SELECT district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
    ['SARDARSHAHAR PANCHAYAT SAMITI', 'पंचायत समिति सरदारशहर', ps1],
  );
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
  const candidates = async (w: number, extra = 0) => {
    const c = (pos: number, name: string, nota: boolean) =>
      insert(
        app,
        'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, ?, ?, ?, ?)',
        [w, pos, name, nota ? null : 'M', nota ? 1 : 0],
      );
    const A = await c(1, 'अमर सिंह', false);
    const B = await c(2, 'भरत कुमार', false);
    const more: number[] = [];
    for (let i = 0; i < extra; i++)
      more.push(await c(3 + i, EXTRA_NAMES[i] ?? `उम्मीदवार ${3 + i}`, false));
    return { A, B, NOTA: await c(3 + extra, 'नोटा', true), more };
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
      ...(await candidates(id, s.extraCandidates ?? 0).then(({ more, ...abn }) => ({
        candidates: abn,
        extraCandidates: more,
      }))),
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
  const screens = await seedScreens(app, server, { ps1, ps3, ward, lock }, users.zp);
  // Written LAST: the running e2e server polls this setting and rebuilds its public snapshot within
  // ~2 s, so the TV screens show the finished data (the seed runs in another process, so the server
  // gets no change events). The default layout names all real PS; this district has three.
  const layout: ScreenLayout = {
    '1': ['CHURU PANCHAYAT SAMITI'],
    '2': ['SARDARSHAHAR PANCHAYAT SAMITI', 'RAJGARH PANCHAYAT SAMITI'],
  };
  await app.execute('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?', [
    JSON.stringify(layout),
    SCREEN_LAYOUT_KEY,
  ]);
  return { password: E2E_PASSWORD, users, wards, otherPsWard, screens };
}

type PartyKey = 'BJP' | 'INC' | 'RLP';
type Sheet = [number, number, number];

/** A logged-in API client (in-process app) for the seed. */
async function apiAs(server: ReturnType<typeof buildApp>, username: string) {
  const agent = request.agent(server);
  if ((await login(agent, username, E2E_PASSWORD)).status !== 200) {
    throw new Error(`seed login failed: ${username}`);
  }
  const token = await csrfToken(agent);
  return async (path: string, body: object) => {
    const res = await agent.post(path).set('X-CSRF-Token', token).send(body);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`seed ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as Record<string, unknown>;
  };
}

/**
 * Part 9 data for the TV screens, through the real API:
 *  - SARDARSHAHAR PS (screen 2, first) with 14 wards (2 sub-pages): declared, corrected (v2),
 *    lottery with two same-name same-party candidates, unopposed, a live NOT_STARTED ward and fillers
 *  - ZP ward 2 (READY_TO_DECLARE) and ZP ward 3 (COUNTING) on booths of that PS
 *  - three parties
 */
async function seedScreens(
  app: Pool,
  server: ReturnType<typeof buildApp>,
  ctx: {
    ps1: number;
    ps3: number;
    ward: (type: 'PS' | 'ZP', ps: number | null, no: number) => Promise<number>;
    lock: (w: number) => Promise<unknown>;
  },
  zpUser: string,
): Promise<E2eScreens> {
  const { ps3, ward, lock } = ctx;
  const party: Record<PartyKey, number> = {
    BJP: await insert(
      app,
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      ['भारतीय जनता पार्टी', 'Bharatiya Janata Party', 'BJP', 'कमल'],
    ),
    INC: await insert(
      app,
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      ['भारतीय राष्ट्रीय कांग्रेस', 'Indian National Congress', 'INC', 'हाथ'],
    ),
    RLP: await insert(
      app,
      'INSERT INTO party (name_hindi, name_english, short_name, symbol) VALUES (?, ?, ?, ?)',
      ['राष्ट्रीय लोकतांत्रिक पार्टी', 'Rashtriya Loktantrik Party', 'RLP', 'बोतल'],
    ),
  };
  const cand = (w: number, pos: number, name: string, p: PartyKey | null, nota = false) =>
    insert(
      app,
      'INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota, party_id) VALUES (?, ?, ?, ?, ?, ?)',
      [w, pos, name, nota ? null : 'M', nota ? 1 : 0, p === null ? null : party[p]],
    );
  const pair = async (w: number, a: [string, PartyKey | null], b: [string, PartyKey | null]) => ({
    A: await cand(w, 1, a[0], a[1]),
    B: await cand(w, 2, b[0], b[1]),
    NOTA: await cand(w, 3, 'नोटा', null, true),
  });

  const zp2 = await ward('ZP', null, 2);
  const zp3 = await ward('ZP', null, 3);
  const zp2c = await pair(zp2, ['प्रेम सिंह', 'BJP'], ['श्याम लाल', 'INC']);
  const zp3c = await pair(zp3, ['कमला देवी', 'INC'], ['सीता देवी', 'RLP']);
  await lock(zp2);
  await lock(zp3);
  // Booths 1-7 of the PS belong to ZP ward 2, booths 8-15 to ZP ward 3.
  const booth = (no: number, psWard: number) =>
    insert(
      app,
      `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id, registered_voters_total)
       VALUES (?, ?, ?, ?, ?, 1000)`,
      [ps3, no, `राजकीय विद्यालय सरदारशहर ${no}`, psWard, no <= 7 ? zp2 : zp3],
    );

  const psWards: { id: number; booth: number; c: { A: number; B: number; NOTA: number } }[] = [];
  const names: [[string, PartyKey | null], [string, PartyKey | null]][] = [
    [
      ['सुरेश कुमार', 'BJP'],
      ['महेश चंद', 'INC'],
    ], // 1 declared
    [
      ['रमेश लाल', 'INC'],
      ['दिनेश सैनी', 'RLP'],
    ], // 2 corrected
    [
      ['गोपाल राम', null],
      ['गोपाल राम', null],
    ], // 3 lottery: same name, both independent (one party may field only one candidate)
    [
      ['हरि राम', 'BJP'],
      ['', null],
    ], // 4 unopposed (one candidate only)
    [
      ['अजय सिंह', 'BJP'],
      ['विजय कुमार', 'INC'],
    ], // 5 live
  ];
  for (let no = 1; no <= 14; no++) {
    const id = await ward('PS', ps3, no);
    const b = await booth(no, id);
    let c: { A: number; B: number; NOTA: number };
    if (no === 4) {
      c = { A: await cand(id, 1, 'हरि राम', 'BJP'), B: 0, NOTA: 0 };
      await app.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [id]);
    } else {
      const n = names[no - 1] ?? [
        ['प्रत्याशी क', null],
        ['प्रत्याशी ख', null],
      ];
      c = await pair(id, n[0], n[1]);
    }
    await lock(id);
    psWards.push({ id, booth: b, c });
  }
  await booth(15, psWards[13]?.id ?? 0);

  await createUser(app, {
    username: 'e2e_ro_sardarshahar',
    role: 'PS_RO',
    psId: ps3,
    password: E2E_PASSWORD,
  });
  const ro = await apiAs(server, 'e2e_ro_sardarshahar');
  const rows = (c: { A: number; B: number; NOTA: number }, [a, b, n]: Sheet) => [
    { candidateId: c.A, votes: a },
    { candidateId: c.B, votes: b },
    { candidateId: c.NOTA, votes: n },
  ];
  const fill = async (
    w: { id: number; booth: number; c: { A: number; B: number; NOTA: number } },
    sheet: Sheet,
    postal: Sheet,
  ) => {
    const entry = await ro('/api/counting/entries', {
      wardId: w.id,
      boothId: w.booth,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: sheet[0] + sheet[1] + sheet[2],
      votes: rows(w.c, sheet),
    });
    await ro(`/api/counting/wards/${w.id}/postal`, {
      sheetTotal: postal[0] + postal[1] + postal[2],
      votes: rows(w.c, postal),
    });
    return (entry.entry as { id: number; rowVersion: number }).id;
  };
  const at = (i: number) => {
    const w = psWards[i];
    if (w === undefined) throw new Error('seed: missing ward');
    return w;
  };
  interface Preview {
    result: { leader: { candidateId: number }; totalValidVotes: number };
  }

  // 1: declared
  await fill(at(0), [300, 200, 10], [1, 1, 0]);
  const p1 = (await ro(`/api/declare/wards/${at(0).id}/preview`, {})) as unknown as Preview;
  await ro(`/api/declare/wards/${at(0).id}`, {
    password: E2E_PASSWORD,
    confirmWinnerCandidateId: p1.result.leader.candidateId,
    confirmTotalValidVotes: p1.result.totalValidVotes,
  });
  // 2: declared, then corrected (version 2)
  const e2 = await fill(at(1), [250, 100, 5], [0, 0, 0]);
  const p2 = (await ro(`/api/declare/wards/${at(1).id}/preview`, {})) as unknown as Preview;
  await ro(`/api/declare/wards/${at(1).id}`, {
    password: E2E_PASSWORD,
    confirmWinnerCandidateId: p2.result.leader.candidateId,
    confirmTotalValidVotes: p2.result.totalValidVotes,
  });
  const changes = [
    {
      kind: 'BOOTH',
      entryId: e2,
      rowVersion: 1,
      sheetTotal: 365,
      votes: rows(at(1).c, [260, 100, 5]),
    },
  ];
  const cp = (await ro(`/api/declare/wards/${at(1).id}/correction/preview`, {
    changes,
  })) as unknown as {
    after: { leader: { candidateId: number }; totalValidVotes: number };
  };
  await ro(`/api/declare/wards/${at(1).id}/correction`, {
    password: E2E_PASSWORD,
    reason: 'पुनर्गणना में बूथ के मत बदले',
    changes,
    confirmWinnerCandidateId: cp.after.leader.candidateId,
    confirmTotalValidVotes: cp.after.totalValidVotes,
  });
  // 3: tie between two "गोपाल राम (BJP)", resolved by lottery for the SECOND one
  await fill(at(2), [150, 150, 0], [0, 0, 0]);
  const p3 = (await ro(`/api/declare/wards/${at(2).id}/preview`, {})) as unknown as {
    result: { totalValidVotes: number };
  };
  await ro(`/api/declare/wards/${at(2).id}`, {
    password: E2E_PASSWORD,
    confirmWinnerCandidateId: at(2).c.B,
    confirmTotalValidVotes: p3.result.totalValidVotes,
    lottery: {
      winnerCandidateId: at(2).c.B,
      conductedBy: 'रिटर्निंग अधिकारी',
      note: 'दोनों के सामने पर्ची निकाली गई',
    },
  });

  // ZP: ward 2 fully entered (READY), ward 3 counting (one booth).
  const zp = await apiAs(server, zpUser);
  for (let i = 0; i < 7; i++) {
    await zp('/api/counting/entries', {
      wardId: zp2,
      boothId: at(i).booth,
      ballotFor: 'ZP',
      roundNo: 1,
      sheetTotal: 82,
      votes: rows(zp2c, [50, 30, 2]),
    });
  }
  await zp(`/api/counting/wards/${zp2}/postal`, { sheetTotal: 3, votes: rows(zp2c, [2, 1, 0]) });
  await zp('/api/counting/entries', {
    wardId: zp3,
    boothId: at(7).booth,
    ballotFor: 'ZP',
    roundNo: 1,
    sheetTotal: 101,
    votes: rows(zp3c, [40, 60, 1]),
  });

  return {
    psName: 'पंचायत समिति सरदारशहर',
    roSardar: 'e2e_ro_sardarshahar',
    live: { wardId: at(4).id, wardNo: 5, boothId: at(4).booth, candidates: at(4).c },
    declaredWardNo: 1,
    correctedWardNo: 2,
    unopposedWardNo: 4,
    lottery: { wardNo: 3, winnerId: at(2).c.B, loserId: at(2).c.A },
    zpReady: { wardId: zp2, wardNo: 2 },
  };
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
