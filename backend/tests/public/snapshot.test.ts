import type { Pool } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultPublicApiConfig } from '../../src/config/app-config.js';
import { PublicSnapshotService } from '../../src/services/public-snapshot.js';
import type { WardCard } from '../../src/services/public-views.js';
import { loadWardResults } from '../../src/services/result-loader.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld, psW1Sheet, v } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { declareClient } from '../declare/helpers.js';
import { FAST, nextVersion, publicApp, waitFor } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: World;
let h: PublicHarness | null = null;

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
afterEach(() => {
  h?.stop();
  h = null;
});

/** ZP ward 1 has booths b1..b6; enter them one after another as the ZP_RO. */
async function zpEntries(app: PublicHarness['app'], count: number, gapMs: number): Promise<void> {
  const zp = await declareClient(app, 'zp_ro_x3');
  const booths = [w.b1, w.b2, w.b3, w.b4, w.b5, w.b6];
  for (let i = 0; i < count; i++) {
    const boothId = booths[i % booths.length] ?? 0;
    const res = await zp.post('/entries', {
      wardId: w.zW1,
      boothId,
      ballotFor: 'ZP',
      roundNo: 1,
      sheetTotal: 3,
      votes: v([
        [w.c.E, 2],
        [w.c.F, 1],
        [w.c.N3, 0],
      ]),
    });
    if (res.status === 409) {
      // booth already entered: correct it instead (still a ward change)
      const id = (
        (await zp.get(`/wards/${w.zW1}/booths`)).body as {
          booths: { boothId: number; entryId: number }[];
        }
      ).booths.find((b) => b.boothId === boothId)?.entryId;
      const entry = (await zp.get(`/entries/${String(id)}`)).body as {
        entry: { rowVersion: number };
      };
      await zp.put(`/entries/${String(id)}`, {
        rowVersion: entry.entry.rowVersion,
        roundNo: 2,
        sheetTotal: 3 + i,
        votes: v([
          [w.c.E, 2 + i],
          [w.c.F, 1],
          [w.c.N3, 0],
        ]),
        reason: 'Burst test correction',
      });
    }
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
}

function zpCard(h: PublicHarness): WardCard | undefined {
  return h.snapshots.get()?.screens['3'].zp.wards.find((c) => c.wardId === w.zW1);
}

describe('public snapshot', () => {
  it('an entry through the counting API publishes a new version within ~1 s', async () => {
    h = await publicApp(pool);
    const before = h.snapshots.get()?.version ?? 0;
    const started = Date.now();
    const ro = await declareClient(h.app, 'ro_ps1_x1');
    await ro.post('/entries', psW1Sheet(w, w.b1));
    await nextVersion(h, before, 1000);
    expect(Date.now() - started).toBeLessThan(1500);
    const card = h.snapshots.get()?.screens['1'][0]?.wards.find((c) => c.wardId === w.psW1);
    expect(card).toMatchObject({ status: 'COUNTING', boothsEntered: 1 });
  });

  it('a burst of 20 changes gives only a few rebuilds (debounce), and the final snapshot is correct', async () => {
    h = await publicApp(pool, { debounceMs: 200, minSnapshotIntervalMs: 200 });
    const before = h.snapshots.publishedCount;
    await zpEntries(h.app, 20, 0);
    // Wait until no more rebuilds happen (the last change has been published).
    let last = -1;
    while (h.snapshots.publishedCount !== last) {
      last = h.snapshots.publishedCount;
      await new Promise((r) => setTimeout(r, 500));
    }
    const rebuilds = h.snapshots.publishedCount - before;
    expect(rebuilds).toBeGreaterThanOrEqual(1);
    expect(rebuilds).toBeLessThan(20);
    // Final snapshot equals a direct engine load.
    const truth = (await loadWardResults(pool, [w.zW1])).get(w.zW1);
    const card = zpCard(h);
    expect(card?.boothsEntered).toBe(truth?.boothsEntered);
    expect(card?.top3.map((t) => t.votes)).toEqual(truth?.top3.map((t) => t.totalVotes));
  });

  it('a burst over ~3 s: snapshots are never closer than the minimum interval; nothing is lost', async () => {
    const minInterval = 800;
    h = await publicApp(pool, { debounceMs: 50, minSnapshotIntervalMs: minInterval });
    const publishedAt: number[] = [];
    const off = h.snapshots.onPublish(() => publishedAt.push(Date.now()));
    await zpEntries(h.app, 20, 150); // ~3 s of changes
    await new Promise((r) => setTimeout(r, minInterval + 400));
    off();
    expect(publishedAt.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < publishedAt.length; i++) {
      expect((publishedAt[i] ?? 0) - (publishedAt[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        minInterval - 25,
      );
    }
    const truth = (await loadWardResults(pool, [w.zW1])).get(w.zW1);
    const card = zpCard(h);
    expect(card?.top3.map((t) => t.votes)).toEqual(truth?.top3.map((t) => t.totalVotes));
    expect(card?.boothsEntered).toBe(6);
  });

  it('a failed rebuild keeps serving the last good snapshot (never a half-built one)', async () => {
    const ownPool = createTestAppPool();
    const logs: string[] = [];
    const service = new PublicSnapshotService(ownPool, defaultPublicApiConfig(FAST), (m) =>
      logs.push(m),
    );
    try {
      await service.start();
      const good = service.get();
      expect(good?.version).toBe(1);
      await ownPool.end(); // the database "goes away"
      service.requestRebuild();
      await waitFor(() => logs.some((l) => l.includes('rebuild failed')) || undefined, 3000);
      expect(service.get()).toBe(good); // same object, same version
      expect(Object.isFrozen(good)).toBe(true);
      expect(Object.isFrozen(good?.screens['1'])).toBe(true);
    } finally {
      service.stop();
    }
  });

  it('the safety rebuild picks up changes made outside the server (e.g. scripts)', async () => {
    h = await publicApp(pool, { safetyRebuildMs: 300 });
    const before = h.snapshots.get()?.version ?? 0;
    await pool.execute('UPDATE ward SET reservation_category = ? WHERE id = ?', [
      'सामान्य',
      w.psW1,
    ]);
    await nextVersion(h, before, 2000);
    const harness = h;
    const card = await waitFor(
      () =>
        harness.snapshots
          .get()
          ?.screens['1'][0]?.wards.find(
            (c) => c.wardId === w.psW1 && c.reservationCategory === 'सामान्य',
          ),
      2000,
    );
    expect(card.reservationCategory).toBe('सामान्य');
  });

  it('a change during a rebuild schedules exactly one more rebuild', async () => {
    h = await publicApp(pool, { debounceMs: 10, minSnapshotIntervalMs: 0 });
    const before = h.snapshots.publishedCount;
    for (let i = 0; i < 10; i++) h.snapshots.requestRebuild();
    await new Promise((r) => setTimeout(r, 15));
    for (let i = 0; i < 10; i++) h.snapshots.requestRebuild(); // likely during the build
    await new Promise((r) => setTimeout(r, 600));
    expect(h.snapshots.publishedCount - before).toBeGreaterThanOrEqual(1);
    expect(h.snapshots.publishedCount - before).toBeLessThanOrEqual(2);
  });
});
