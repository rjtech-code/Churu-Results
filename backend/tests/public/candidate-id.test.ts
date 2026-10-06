// Part 9: the screens mark the winner row by candidateId, never by name (names can repeat).
import type { Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WardCard } from '../../src/services/public-views.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { getJson, nextVersion, publicApp } from './helpers.js';
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

async function psW1Card(): Promise<WardCard> {
  const body = (await getJson(h.app, '/api/public/screens/1')).body as {
    panchayatSamitis: { wards: WardCard[] }[];
  };
  const card = body.panchayatSamitis.flatMap((b) => b.wards).find((c) => c.wardId === w.psW1);
  if (!card) throw new Error('psW1 not on screen 1');
  return card;
}

describe('candidateId on public cards', () => {
  it('TIE_RESOLVED where both tied candidates have the same name and party: the lottery winner is identified by id', async () => {
    // Same name, same party (both independents): only the id tells them apart.
    await migrator.execute('UPDATE candidate SET name_hindi = ? WHERE id = ?', ['ए', w.c.B]);
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    await fillPsW1(ro, w, { b1: [10, 10, 1], b2: [10, 10, 1], b4: [10, 10, 1], postal: [0, 0, 0] });
    const result = await previewResult(ro, w.psW1);
    const declared = await ro.dpost(`/wards/${w.psW1}`, {
      password: 'Counting-Pass-1',
      confirmWinnerCandidateId: w.c.B,
      confirmTotalValidVotes: result.totalValidVotes,
      lottery: {
        winnerCandidateId: w.c.B,
        conductedBy: 'Returning Officer',
        note: 'Lottery in front of both',
      },
    });
    expect(declared.status).toBe(201);
    await nextVersion(h, 0);
    await new Promise((r) => setTimeout(r, 250));

    const card = await psW1Card();
    expect(card.status).toBe('TIE_RESOLVED');
    const tied = card.top3.filter((t) => t.rank === 1);
    expect(tied.map((t) => [t.name, t.party])).toEqual([
      ['ए', null],
      ['ए', null],
    ]);
    expect(new Set(tied.map((t) => t.candidateId))).toEqual(new Set([w.c.A, w.c.B]));
    expect(card.winner).toEqual({ candidateId: w.c.B, name: 'ए', party: null });
    // exactly one top3 row is the winner by id
    expect(card.top3.filter((t) => t.candidateId === card.winner?.candidateId)).toHaveLength(1);

    const winners = (await getJson(h.app, '/api/public/winners')).body as {
      items: { winner: { candidateId: number } }[];
    };
    expect(winners.items[0]?.winner.candidateId).toBe(w.c.B);
    const recent = (await getJson(h.app, '/api/public/recent')).body as {
      items: { wardId: number; leaderOrWinner: { candidateId: number } | null }[];
    };
    expect(recent.items.find((i) => i.wardId === w.psW1)?.leaderOrWinner?.candidateId).toBe(w.c.B);
  });

  it('COUNTING: top3 rows carry their candidate ids in rank order', async () => {
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    await fillPsW1(ro, w);
    await nextVersion(h, 0);
    await new Promise((r) => setTimeout(r, 250));
    const card = await psW1Card();
    expect(card.top3.map((t) => t.candidateId)).toEqual([w.c.A, w.c.B]);
  });
});
