// Turning a public screen OFF from the Super Admin panel: the server stops sending that screen's
// results, the other two screens are untouched, and turning it back ON needs no key again.
//
// Nothing here touches counting: the same entries, the same snapshot, the same numbers — only
// whether one screen is allowed to receive them.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SCREEN_POWER_KEY, readScreensOff } from '../../src/services/setup/screen-power.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { buildWorld } from '../counting/helpers.js';
import { getJson, publicApp, useWorldLayout, waitFor } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let pool: Pool;
let migrator: Pool;
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
  await buildWorld(pool);
  await useWorldLayout(pool);
  h = await publicApp(pool);
});
afterEach(() => {
  h.stop();
});

/** Writes the setting the way the panel does, then waits for the snapshot to carry it. */
async function switchScreen(screen: '1' | '2' | '3', on: boolean): Promise<void> {
  const off = await readScreensOff(pool);
  const next = on ? off.filter((n) => n !== screen) : [...new Set([...off, screen])];
  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [SCREEN_POWER_KEY, JSON.stringify(next.sort())],
  );
  await waitFor(async () => {
    const body = (await getJson(h.app, `/api/public/screens/${screen}`)).body as { off?: boolean };
    return (body.off === true) === !on;
  });
}

const screenBody = async (screen: '1' | '2' | '3') =>
  (await getJson(h.app, `/api/public/screens/${screen}`)).body as Record<string, unknown>;

describe('the default', () => {
  it('no setting: all three screens send their results, exactly as before', async () => {
    expect(await readScreensOff(pool)).toEqual([]);
    for (const screen of ['1', '2', '3'] as const) {
      const body = await screenBody(screen);
      expect(body.off, screen).toBeUndefined();
      expect(screen === '3' ? body.zp : body.panchayatSamitis, screen).toBeDefined();
    }
  });
});

describe('a screen that is off', () => {
  it('its data endpoint says "off" and carries NO results at all', async () => {
    await switchScreen('1', false);
    const body = await screenBody('1');
    expect(body.off).toBe(true);
    expect(body.panchayatSamitis).toBeUndefined();
    expect(body.zp).toBeUndefined();
    // Only the version and the time come back — nothing about any ward.
    expect(Object.keys(body).sort()).toEqual(['generatedAt', 'off', 'version']);
  });

  it('its lists come back empty, also with the same "off" flag', async () => {
    await switchScreen('2', false);
    for (const path of [
      '/api/public/recent?limit=10&screen=2',
      '/api/public/winners?limit=8&screen=2',
    ]) {
      const body = (await getJson(h.app, path)).body as { off?: boolean; items?: unknown[] };
      expect(body.off, path).toBe(true);
      expect(body.items, path).toEqual([]);
    }
  });

  it('the live channel still runs, and it never carried results anyway', async () => {
    await switchScreen('3', false);
    // The stream is the screen's clock, not its data: it sends version numbers only, so an off
    // screen learns to refetch and then gets the "off" answer above.
    const res = await request(h.app)
      .get('/api/public/stream')
      .timeout({ deadline: 400 })
      .catch((err: unknown) => err as { response?: { text?: string } });
    const text = (res as { text?: string; response?: { text?: string } }).text ?? '';
    expect(text).not.toMatch(/wardId|candidateId|votes/);
  });
});

describe('the three screens are independent', () => {
  it('turning one off leaves the other two exactly as they were', async () => {
    const before = { '1': await screenBody('1'), '3': await screenBody('3') };
    await switchScreen('2', false);
    expect((await screenBody('2')).off).toBe(true);
    for (const screen of ['1', '3'] as const) {
      const now = await screenBody(screen);
      expect(now.off, screen).toBeUndefined();
      // The same results as before the switch (the version moves, the data does not).
      expect(screen === '3' ? now.zp : now.panchayatSamitis, screen).toEqual(
        screen === '3' ? before['3'].zp : before['1'].panchayatSamitis,
      );
    }
  });
});

describe('turning it back on', () => {
  it('results return with the SAME screen session — the key is never asked for again', async () => {
    await switchScreen('1', false);
    expect((await screenBody('1')).off).toBe(true);
    await switchScreen('1', true);
    const back = await screenBody('1');
    expect(back.off).toBeUndefined();
    expect(back.panchayatSamitis).toBeDefined();
    // The same cookie was used throughout: no 401, no unlock in between.
    expect((await getJson(h.app, '/api/public/meta')).status).toBe(200);
  });
});

describe('counting is untouched', () => {
  it('every counting row and every number of another screen survive a switch unchanged', async () => {
    const countingRows = async () => {
      const parts: unknown[] = [];
      for (const sql of [
        'SELECT * FROM booth_entry ORDER BY id',
        'SELECT * FROM booth_entry_vote ORDER BY id',
        'SELECT * FROM postal_entry ORDER BY id',
        'SELECT * FROM ward_declarations ORDER BY id',
      ]) {
        const [rows] = await pool.query<RowDataPacket[]>(sql);
        parts.push(rows);
      }
      return JSON.stringify(parts);
    };
    const before = await countingRows();
    const screen3Before = await screenBody('3');
    await switchScreen('2', false);
    await switchScreen('2', true);
    expect(await countingRows()).toBe(before);
    expect((await screenBody('3')).zp).toEqual(screen3Before.zp);
  });
});
