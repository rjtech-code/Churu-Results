import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBallotLock } from '../../scripts/ballot-lock.js';
import { runBallotUnlock } from '../../scripts/ballot-unlock.js';
import { runImportCandidates } from '../../scripts/import-candidates.js';
import { runImportGeography } from '../../scripts/import-geography.js';
import { runImportParties } from '../../scripts/import-parties.js';
import { runImportVoters } from '../../scripts/import-voters.js';
import type { ScriptContext, ScriptResult } from '../../scripts/lib/run.js';
import { runUsersCreate } from '../../scripts/users-create.js';
import { runUsersResetPassword } from '../../scripts/users-reset-password.js';
import { runUsersSetActive } from '../../scripts/users-set-active.js';
import {
  ALPHA,
  BETA,
  CANDIDATE_HEADERS,
  GEO_HEADERS,
  PARTY_HEADERS,
  auditCount,
  candidateRows,
  closeHarness,
  createHarness,
  geoRows,
  makeCtx,
  resetDb,
  wardId,
  writeXlsx,
} from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetDb(h);
});
afterAll(async () => {
  await closeHarness(h);
});

type Step = (commit: boolean, ctx: ScriptContext) => Promise<ScriptResult>;

/** Runs a step as a dry run (0 audit rows) and then committed (exactly 1 audit row). */
async function dryThenCommit(name: string, step: Step): Promise<void> {
  const before = await auditCount(h);
  const dry = await step(false, makeCtx(h).ctx);
  expect(dry.ok, `${name} dry run`).toBe(true);
  expect(await auditCount(h), `${name} dry run audit rows`).toBe(before);

  const real = await step(true, makeCtx(h).ctx);
  expect(real.ok, `${name} commit`).toBe(true);
  expect(await auditCount(h), `${name} commit audit rows`).toBe(before + 1);
}

describe('audit trail', () => {
  it('every committed run writes exactly one audit_log row; every dry run writes none', async () => {
    const geo = await writeXlsx(h, GEO_HEADERS, geoRows());
    await dryThenCommit('import:geography', (commit, ctx) =>
      runImportGeography({ file: geo, commit }, ctx),
    );

    const parties = await writeXlsx(h, PARTY_HEADERS, [
      ['पार्टी एक', 'Party One', 'P1', 'कमल'],
      ['पार्टी दो', 'Party Two', 'P2', 'हाथ'],
    ]);
    await dryThenCommit('import:parties', (commit, ctx) =>
      runImportParties({ file: parties, commit }, ctx),
    );

    const voters = await writeXlsx(
      h,
      ['panchayat_samiti', 'booth_no', 'voters_male', 'voters_female', 'voters_total'],
      [
        [ALPHA, 1, 1, 1, 2],
        [ALPHA, 2, 1, 1, 2],
        [ALPHA, 3, 1, 1, 2],
        [BETA, 1, 1, 1, 2],
        [BETA, 2, 1, 1, 2],
      ],
    );
    await dryThenCommit('import:voters', (commit, ctx) =>
      runImportVoters({ file: voters, commit }, ctx),
    );

    const candidates = await writeXlsx(h, CANDIDATE_HEADERS, candidateRows());
    await dryThenCommit('import:candidates', (commit, ctx) =>
      runImportCandidates({ file: candidates, commit }, ctx),
    );

    const ward = String(await wardId(h, 'PS', 1));
    await dryThenCommit('ballot:lock', (commit, ctx) =>
      runBallotLock({ ward, by: 'Ram', commit, yes: true }, ctx),
    );
    await dryThenCommit('ballot:unlock', (commit, ctx) =>
      runBallotUnlock({ ward, by: 'Ram', reason: 'test', commit }, ctx),
    );

    await dryThenCommit('users:create', (commit, ctx) =>
      runUsersCreate({ role: 'DM', username: 'dm_churu', fullName: 'DM', commit }, ctx),
    );
    await dryThenCommit('users:reset-password', (commit, ctx) =>
      runUsersResetPassword({ username: 'dm_churu', commit }, ctx),
    );
    await dryThenCommit('users:disable', (commit, ctx) =>
      runUsersSetActive('disable', { username: 'dm_churu', commit }, ctx),
    );
    await dryThenCommit('users:enable', (commit, ctx) =>
      runUsersSetActive('enable', { username: 'dm_churu', commit }, ctx),
    );

    const [rows] = await h.app.query<RowDataPacket[]>(
      'SELECT action, user_id FROM audit_log ORDER BY id',
    );
    expect(rows.map((r) => String(r.action))).toEqual([
      'IMPORT_GEOGRAPHY',
      'IMPORT_PARTIES',
      'IMPORT_VOTERS',
      'IMPORT_CANDIDATES',
      'BALLOT_LOCK',
      'BALLOT_UNLOCK',
      'USER_CREATE',
      'USER_RESET_PASSWORD',
      'USER_DISABLE',
      'USER_ENABLE',
    ]);
    expect(rows.every((r) => r.user_id === null)).toBe(true);
  });

  it('a failed committed run writes no audit row', async () => {
    const before = await auditCount(h);
    const bad = await writeXlsx(h, PARTY_HEADERS, [['x', 'y', 'P1', 'z']]); // P1 exists with other values
    const result = await runImportParties({ file: bad, commit: true }, makeCtx(h).ctx);
    expect(result.ok).toBe(false);
    expect(await auditCount(h)).toBe(before);
  });
});
