// npm run demo:seed [-- --commit]
// DEVELOPMENT / OFFICIAL DEMO ONLY. Fills a *_dev database with clearly marked DEMO data, using the
// normal Part 2 import functions. Never run against a real database (guarded).
import { randomInt } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import type { RowDataPacket } from 'mysql2/promise';
import { parseEnv } from '../src/config/env.js';
import { runBallotLock } from './ballot-lock.js';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
  runImportCandidates,
} from './import-candidates.js';
import { runImportGeography } from './import-geography.js';
import { PARTY_COLUMNS, runImportParties } from './import-parties.js';
import { runPsSetHindiNames } from './ps-set-hindi-names.js';
import { runImportVoters } from './import-voters.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { countOf, inTransaction } from './lib/db.js';
import { assertDemoEnvironment } from './lib/demo-guard.js';
import { scriptEnvSchema } from './lib/env.js';
import { REPO_ROOT } from './lib/paths.js';
import type { ScriptContext } from './lib/run.js';
import { writeSheet } from './lib/xlsx.js';
import type { Cell } from './lib/xlsx.js';
import { runUsersCreate } from './users-create.js';

export const DEMO_FILE = resolve(REPO_ROOT, 'docs', 'polling-stations.xlsx');
export const DEMO_FIXES = resolve(REPO_ROOT, 'docs', 'demo', 'demo-fixes.json');
export const PS_NAMES = resolve(REPO_ROOT, 'docs', 'ps-names.json');
export const DEMO_PS = ['CHURU PANCHAYAT SAMITI', 'RAJGARH PANCHAYAT SAMITI'] as const;

/** 4 random lowercase letters/digits (no look-alikes), so demo usernames are not guessable. */
function suffix(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 4 }, () => alphabet.charAt(randomInt(alphabet.length))).join('');
}

export interface DemoSeedResult {
  ok: boolean;
  usernames: string[];
}

export async function runDemoSeed(
  options: { commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<DemoSeedResult> {
  const fail = (message: string): DemoSeedResult => {
    ctx.out(`DEMO SEED FAILED: ${message}`);
    return { ok: false, usernames: [] };
  };

  // Guard again with the database we are actually connected to (defence in depth).
  const [db] = await ctx.pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  try {
    assertDemoEnvironment({ nodeEnv: process.env.NODE_ENV, dbName: String(db[0]?.name ?? '') });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if ((await countOf(ctx.pool, 'SELECT COUNT(*) AS n FROM ward')) > 0) {
    return fail('the database already has geography. Run npm run demo:reset -- --commit first.');
  }

  ctx.out(
    'DEMO SEED — creates DEMO data only (13 PS / 231 PS wards / 39 ZP wards / 1,359 booths from the',
  );
  ctx.out(
    'official file, 5 DEMO parties, DEMO candidates, fake voter counts, locked ballots, 4 DEMO users).',
  );
  if (options.commit !== true) {
    const geo = await runImportGeography({ file: DEMO_FILE, fixes: DEMO_FIXES }, ctx);
    ctx.out(
      geo.ok
        ? 'Dry run OK. Re-run with --commit to create the demo data.'
        : 'Dry run found problems (see above).',
    );
    return { ok: geo.ok, usernames: [] };
  }

  const tmp = await mkdtemp(join(tmpdir(), 'churu-demo-'));

  // 1. Geography (booth 69 -> ZP ward 30, DEMO ONLY fix).
  if (!(await runImportGeography({ file: DEMO_FILE, fixes: DEMO_FIXES, commit: true }, ctx)).ok) {
    return fail('geography import failed.');
  }
  // 1b. The provisional Hindi PS names, so the demo TV screens show Hindi names.
  if (!(await runPsSetHindiNames({ file: PS_NAMES, commit: true }, ctx)).ok) {
    return fail('setting the Hindi PS names failed.');
  }

  // 2. Five DEMO parties.
  const partiesFile = join(tmp, 'demo-parties.xlsx');
  await writeSheet(partiesFile, [
    {
      name: 'parties',
      headers: PARTY_COLUMNS,
      rows: [1, 2, 3, 4, 5].map((i) => [
        `DEMO दल ${i}`,
        `DEMO Party ${i}`,
        `DEMO${i}`,
        `DEMO-चिह्न ${i}`,
      ]),
    },
  ]);
  if (!(await runImportParties({ file: partiesFile, commit: true }, ctx)).ok)
    return fail('party import failed.');

  // 3. Fake registered-voter counts (deterministic, 600-1200 per booth).
  const [booths] = await ctx.pool.query<RowDataPacket[]>(
    `SELECT ps.name_english AS ps, b.booth_no, b.id FROM booth b
       JOIN panchayat_samiti ps ON ps.id = b.panchayat_samiti_id ORDER BY ps.name_english, b.booth_no`,
  );
  const voterRows: Cell[][] = booths.map((b) => {
    const id = Number(b.id);
    const total = 600 + ((id * 7919) % 601);
    const other = id % 3 === 0 ? 1 : 0;
    const male = Math.floor(total * 0.52);
    return [String(b.ps), Number(b.booth_no), male, total - male - other, other, total];
  });
  const votersFile = join(tmp, 'demo-voters.xlsx');
  await writeSheet(votersFile, [
    {
      name: 'voters',
      headers: [
        'panchayat_samiti',
        'booth_no',
        'voters_male',
        'voters_female',
        'voters_other',
        'voters_total',
      ],
      rows: voterRows,
    },
  ]);
  if (!(await runImportVoters({ file: votersFile, commit: true }, ctx)).ok)
    return fail('voter import failed.');

  // 4. DEMO candidates: 2-5 per ward; every 20th ward has one candidate (unopposed).
  const [wards] = await ctx.pool.query<RowDataPacket[]>(
    `SELECT w.ward_type, w.ward_no, ps.name_english AS ps FROM ward w
       LEFT JOIN panchayat_samiti ps ON ps.id = w.panchayat_samiti_id ORDER BY w.ward_type, ps.name_english, w.ward_no`,
  );
  const candidateRows: Cell[][] = [];
  wards.forEach((w, i) => {
    const n = i % 20 === 0 ? 1 : 2 + (i % 4);
    for (let j = 0; j < n; j++) {
      const party = j < n - 1 ? `DEMO${((i + j) % 5) + 1}` : null; // last one independent
      candidateRows.push([
        w.ward_type === 'PS' ? String(w.ps) : null,
        String(w.ward_type),
        Number(w.ward_no),
        j + 1,
        `DEMO उम्मीदवार ${j + 1}`,
        party,
        j % 2 === 0 ? 'M' : 'F',
        'DEMO सामान्य',
      ]);
    }
  });
  const candidatesFile = join(tmp, 'demo-candidates.xlsx');
  await writeSheet(candidatesFile, [
    {
      name: 'candidates',
      headers: [...CANDIDATE_COLUMNS, ...OPTIONAL_CANDIDATE_COLUMNS],
      rows: candidateRows,
    },
  ]);
  const candidates = await runImportCandidates({ file: candidatesFile, commit: true }, ctx);
  if (!candidates.ok) return fail('candidate import failed.');

  // 5. Lock every ballot.
  if (!(await runBallotLock({ all: true, by: 'DEMO seed', commit: true, yes: true }, ctx)).ok) {
    return fail('ballot lock failed.');
  }

  // 6. DEMO users (random-suffix usernames; each password is printed once by users:create).
  const users = [
    {
      role: 'PS_RO',
      username: `demo_ro_chu_${suffix()}`,
      ps: DEMO_PS[0],
      fullName: 'DEMO RO Churu',
    },
    {
      role: 'PS_RO',
      username: `demo_ro_rjg_${suffix()}`,
      ps: DEMO_PS[1],
      fullName: 'DEMO RO Rajgarh',
    },
    { role: 'ZP_RO', username: `demo_zp_${suffix()}`, ps: undefined, fullName: 'DEMO ZP RO' },
    { role: 'DM', username: `demo_dm_${suffix()}`, ps: undefined, fullName: 'DEMO DM' },
  ];
  for (const u of users) {
    if (!(await runUsersCreate({ ...u, commit: true }, ctx)).ok)
      return fail(`creating ${u.username} failed.`);
  }

  // 7. One audit row marking all of the above as DEMO.
  const summary = {
    note: 'DEMO DATA - not official',
    booths: booths.length,
    wards: wards.length,
    candidate_rows: candidateRows.length,
    unopposed_wards: candidates.unopposedWards.length,
    parties: 5,
    usernames: users.map((u) => u.username),
  };
  await inTransaction(ctx.pool, async (conn) => {
    await writeAudit(conn, {
      action: 'DEMO_SEED',
      entity: 'demo',
      entityId: null,
      newValue: summary,
    });
    return { commit: true, value: undefined };
  });
  ctx.out('');
  ctx.out('DEMO SEED COMPLETE (DEMO DATA - not official).');
  ctx.out(
    `Demo users: ${users.map((u) => `${u.username} (${u.role}${u.ps ? `, ${u.ps}` : ''})`).join('; ')}`,
  );
  return { ok: true, usernames: users.map((u) => u.username) };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { commit: { type: 'boolean' } },
    'npm run demo:seed [-- --commit]',
  );
  return runDemoSeed(values, ctx);
}

if (isMainModule(import.meta.url)) {
  // Guard BEFORE any connection is opened.
  dotenv.config({ quiet: true });
  const parsed = parseEnv(scriptEnvSchema, process.env);
  try {
    assertDemoEnvironment({
      nodeEnv: process.env.NODE_ENV,
      dbName: parsed.ok ? parsed.env.DB_NAME : undefined,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  await runCli(main);
}
