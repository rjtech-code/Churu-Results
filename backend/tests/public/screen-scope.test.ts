// Each TV screen gets only its own wards in /recent and /winners (?screen=1|2|3): screen 1 = its PS
// from the screen layout, screen 2 = its PS, screen 3 = Zila Parishad. Without ?screen: unchanged.
import type { Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, clientFor, v, zW1Sheet } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { getJson, publicApp, waitFor } from './helpers.js';
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

interface Item {
  wardId: number;
  kind: 'PS' | 'ZP';
}
const items = async (path: string): Promise<Item[]> => {
  const res = await getJson(h.app, path);
  expect(res.status, path).toBe(200);
  return (res.body as { items: Item[] }).items;
};
const ids = (list: Item[]) => list.map((i) => i.wardId).sort((a, b) => a - b);

describe('per-screen /recent and /winners', () => {
  it('screen 1 sees only its PS, screen 2 only its PS, screen 3 only ZP — and the reverse', async () => {
    // Changes on all three screens: psW1 (PS 1, screen 1) declared, psW2 (PS 2, screen 2) counting,
    // zW1 (ZP, screen 3) counting.
    const ro1 = await declareClient(h.app, 'ro_ps1_x1');
    await fillPsW1(ro1, w);
    expect(
      (await ro1.dpost(`/wards/${w.psW1}`, confirmBody(await previewResult(ro1, w.psW1)))).status,
    ).toBe(201);
    const ro2 = await clientFor(h.app, 'ro_ps2_x2');
    const ps2 = await ro2.post('/entries', {
      wardId: w.psW2,
      boothId: w.b3,
      ballotFor: 'PS',
      roundNo: 1,
      sheetTotal: 310,
      votes: v([
        [w.c.C, 200],
        [w.c.D, 100],
        [w.c.N2, 10],
      ]),
    });
    expect(ps2.status).toBe(201);
    const zp = await clientFor(h.app, 'zp_ro_x3');
    expect((await zp.post('/entries', zW1Sheet(w, w.b1))).status).toBe(201);

    // Wait until the snapshot has all three changes.
    await waitFor(async () => {
      const all = ids(await items('/api/public/recent?limit=50'));
      return [w.psW1, w.psW2, w.zW1].every((id) => all.includes(id)) ? true : undefined;
    });

    const recent1 = await items('/api/public/recent?limit=50&screen=1');
    const recent2 = await items('/api/public/recent?limit=50&screen=2');
    const recent3 = await items('/api/public/recent?limit=50&screen=3');
    expect(ids(recent1)).toEqual([w.psW1]);
    expect(ids(recent2)).toEqual([w.psW2]);
    expect(ids(recent3)).toEqual([w.zW1]);
    expect(recent3.every((i) => i.kind === 'ZP')).toBe(true);
    expect([...recent1, ...recent2].every((i) => i.kind === 'PS')).toBe(true);

    // The PS 1 winner: on screen 1 only; never on screen 2 or the ZP screen.
    expect(ids(await items('/api/public/winners?limit=50&screen=1'))).toEqual([w.psW1]);
    expect(await items('/api/public/winners?limit=50&screen=2')).toEqual([]);
    expect(await items('/api/public/winners?limit=50&screen=3')).toEqual([]);

    // Header counters come from each screen's own data: screen 2 / ZP never count PS 1's winner.
    const declared = (cards: { status: string }[]) =>
      cards.filter((c) => c.status === 'DECLARED').length;
    const s2 = (await getJson(h.app, '/api/public/screens/2')).body as {
      panchayatSamitis: {
        panchayatSamiti: { id: number };
        wards: { wardId: number; status: string }[];
      }[];
    };
    expect(s2.panchayatSamitis.map((b) => b.panchayatSamiti.id)).toEqual([w.ps2]);
    expect(declared(s2.panchayatSamitis.flatMap((b) => b.wards))).toBe(0);
    const s3 = (await getJson(h.app, '/api/public/screens/3')).body as {
      zp: { wards: { wardId: number; status: string }[] };
    };
    expect(s3.zp.wards.map((c) => c.wardId)).toEqual([w.zW1]);
    expect(declared(s3.zp.wards)).toBe(0);

    // Without ?screen the lists are as before (everything); a bad screen is a 400.
    expect(ids(await items('/api/public/recent?limit=50'))).toEqual(
      [w.psW1, w.psW2, w.zW1].sort((a, b) => a - b),
    );
    for (const bad of ['0', '4', 'ZP', ''])
      expect((await getJson(h.app, `/api/public/recent?screen=${bad}`)).status).toBe(400);
  });
});
