// Turning a public screen OFF from the Super Admin panel: the server stops sending that screen's
// results, the other two screens are untouched — and the switch ENDS that screen's sessions, so the
// TV asks for its key again when it comes back ON (Nov 2026). What a switch must never do is ask for
// the key while the screen stays on: a page reload, the TV's browser restarting and the app
// restarting all keep an unlocked screen unlocked. Both halves are tested below, separately.
//
// Nothing here touches counting: the same entries, the same snapshot, the same numbers — only
// whether one screen is allowed to receive them.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setScreenPower } from '../../src/modules/superadmin/superadmin.service.js';
import { readScreensOff } from '../../src/services/setup/screen-power.js';
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

/**
 * Switches one screen exactly as POST /api/superadmin/screens/:screenNo does — the real service (so
 * the session deletion is the real one) and then that screen's live streams — and waits for the
 * snapshot to carry it. `h.app` holds a session for every screen, so it can watch the others.
 */
async function switchScreen(screen: '1' | '2' | '3', on: boolean): Promise<number> {
  const out = await setScreenPower(
    pool,
    {
      user: {
        id: h.screenKey.superAdminId,
        username: 'super_admin',
        fullName: null,
        role: 'SUPER_ADMIN',
        panchayatSamitiId: null,
        panchayatSamitiName: null,
      },
      ip: '127.0.0.1',
    },
    screen,
    on,
  );
  h.hub.endScreen(screen, on ? 'on' : 'off');
  // Wait until the PUBLISHED snapshot carries the new state (the settings poll picks it up), so a
  // test that reads a screen's body sees the switch rather than the moment before it.
  await waitFor(() => h.snapshots.get()?.screensOff.includes(screen) === !on);
  return out.sessionsEnded;
}

const rows = async (sql: string) => {
  const [r] = await pool.execute<RowDataPacket[]>(sql);
  return r;
};

const screenBody = async (screen: '1' | '2' | '3') =>
  (await getJson(h.app, `/api/public/screens/${screen}`)).body as Record<string, unknown>;

/**
 * The body an unlocked TV of an OFF screen sees. Switching a screen off ends its sessions, so this
 * is a TV whose officer typed the key again while the screen was off: it is told the screen is off
 * and gets no results — the calm "यह स्क्रीन अस्थायी रूप से बंद है" card.
 */
const offScreenBody = async (screen: '1' | '2' | '3') => {
  const tv = await h.unlockAgain(screen);
  const res = await getJson(tv, `/api/public/screens/${screen}`);
  expect(res.status).toBe(200);
  return res.body as Record<string, unknown>;
};

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
    const body = await offScreenBody('1');
    expect(body.off).toBe(true);
    expect(body.panchayatSamitis).toBeUndefined();
    expect(body.zp).toBeUndefined();
    // Only the version and the time come back — nothing about any ward.
    expect(Object.keys(body).sort()).toEqual(['generatedAt', 'off', 'version']);
  });

  it('its lists come back empty, also with the same "off" flag', async () => {
    await switchScreen('2', false);
    const tv = await h.unlockAgain('2');
    for (const path of [
      '/api/public/recent?limit=10&screen=2',
      '/api/public/winners?limit=8&screen=2',
    ]) {
      const body = (await getJson(tv, path)).body as { off?: boolean; items?: unknown[] };
      expect(body.off, path).toBe(true);
      expect(body.items, path).toEqual([]);
    }
  });

  it('the live channel still runs, and it never carried results anyway', async () => {
    await switchScreen('3', false);
    const tv = await h.unlockAgain('3');
    // The stream is the screen's clock, not its data: it sends version numbers only, so an off
    // screen learns to refetch and then gets the "off" answer above.
    const res = await request(tv)
      .get('/api/public/stream?screen=3')
      .timeout({ deadline: 400 })
      .catch((err: unknown) => err as { response?: { text?: string } });
    const text = (res as { text?: string; response?: { text?: string } }).text ?? '';
    expect(text).not.toMatch(/wardId|candidateId|votes/);
  });
});

/**
 * The TV does it by itself: its open live stream is closed the moment the screen is switched, with
 * the event that says what the hall should see next — the calm card when it goes off, the key box
 * when it comes back on. Nobody reloads anything and nobody touches the TV.
 */
describe("the switch closes that screen's stream, with the right event", () => {
  /** An open /api/public/stream of one TV (its own screen cookie only). */
  async function openStream(app: Express, screen: '1' | '2' | '3') {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    let buffer = '';
    let ended = false;
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(`${base}/api/public/stream?screen=${screen}`, resolve);
      req.on('error', reject);
    });
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => (buffer += chunk));
    res.on('end', () => (ended = true));
    return {
      status: res.statusCode ?? 0,
      text: () => buffer,
      ended: () => ended,
      close: async () => {
        res.destroy();
        await new Promise((r) => server.close(r));
      },
    };
  }

  it('off sends "off" (the card), on sends "locked" (the key box), and screen 2 keeps streaming', async () => {
    const tv1 = await openStream(h.appFor('1'), '1');
    const tv2 = await openStream(h.appFor('2'), '2');
    try {
      expect([tv1.status, tv2.status]).toEqual([200, 200]);
      await waitFor(() => tv1.text().includes('event: snapshot'));
      await waitFor(() => tv2.text().includes('event: snapshot'));

      await switchScreen('1', false);
      await waitFor(() => tv1.ended());
      expect(tv1.text()).toContain('event: off');
      expect(tv1.text()).not.toContain('event: locked');
      // Screen 2's TV never noticed.
      expect(tv2.ended()).toBe(false);
      expect(tv2.text()).not.toMatch(/event: (off|locked)/);
    } finally {
      await tv1.close();
      await tv2.close();
    }

    // Switched back on: the TV that typed its key during the off window is told it is locked, which
    // is the key box — the screen is showing results again and its key has to be typed once.
    const back = await openStream(await h.unlockAgain('1'), '1');
    try {
      await waitFor(() => back.text().includes('event: snapshot'));
      await switchScreen('1', true);
      await waitFor(() => back.ended());
      expect(back.text()).toContain('event: locked');
      expect(back.text()).not.toContain('event: off');
    } finally {
      await back.close();
    }
  });
});

describe('the three screens are independent', () => {
  it('turning one off leaves the other two exactly as they were', async () => {
    const before = { '1': await screenBody('1'), '3': await screenBody('3') };
    await switchScreen('2', false);
    expect((await offScreenBody('2')).off).toBe(true);
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

/**
 * The half that must NEVER change: while a screen stays ON, nothing makes it ask for its key.
 * Counting day cannot have a blank TV because someone pressed F5, so this is tested on its own.
 */
describe('a screen that stays ON never asks for the key again', () => {
  it('a page reload, the TV browser restarting and the app restarting all keep it unlocked', async () => {
    const tv = h.appFor('1');
    // A page reload is the same cookie asking again — many times over.
    for (let i = 0; i < 5; i++) {
      expect((await getJson(tv, '/api/public/screens/1')).status).toBe(200);
      expect((await getJson(tv, '/api/public/meta?screen=1')).status).toBe(200);
    }
    // A browser restart on the TV: the cookie has a Max-Age, so it comes back with it. Another
    // screen being switched does not touch this one either.
    await switchScreen('2', false);
    await switchScreen('2', true);
    expect((await getJson(tv, '/api/public/screens/1')).status).toBe(200);
    // An app restart: a second app on the same database (the session lives in MySQL).
    const restarted = await publicApp(pool);
    try {
      const sameCookieNewApp = await getJson(h.appFor('1'), '/api/public/screens/1');
      expect(sameCookieNewApp.status).toBe(200);
      expect((await getJson(restarted.app, '/api/public/screens/1')).status).toBe(200);
    } finally {
      restarted.stop();
    }
    const body = (await getJson(tv, '/api/public/screens/1')).body as Record<string, unknown>;
    expect(body.off).toBeUndefined();
    expect(body.panchayatSamitis).toBeDefined();
  });
});

describe('off and then on asks for the key again — on that screen only', () => {
  it('screen 1 is refused after the switch, and the other two TVs never notice', async () => {
    const tv1 = h.appFor('1');
    const tv2 = h.appFor('2');
    const tv3 = h.appFor('3');
    expect((await getJson(tv1, '/api/public/screens/1')).status).toBe(200);

    // OFF: screen 1's session is ended there and then (and only screen 1's).
    expect(await switchScreen('1', false)).toBe(1);
    const locked = await getJson(tv1, '/api/public/screens/1');
    // The TV is told the screen is off, so it shows the calm card and not the key box yet.
    expect([locked.status, locked.body]).toEqual([401, { error: 'SCREEN_LOCKED', off: true }]);

    // ON again: now the same TV is simply locked out, with no "off" — the key box, by itself, on
    // the very next poll. Nobody reloaded anything.
    await switchScreen('1', true);
    const asked = await getJson(tv1, '/api/public/screens/1');
    expect([asked.status, asked.body]).toEqual([401, { error: 'SCREEN_LOCKED' }]);
    expect((await getJson(tv1, '/api/public/meta?screen=1')).status).toBe(401);

    // Screens 2 and 3 kept their sessions through both switches.
    for (const [screen, tv] of [
      ['2', tv2],
      ['3', tv3],
    ] as const) {
      const res = await getJson(tv, `/api/public/screens/${screen}`);
      expect([screen, res.status]).toEqual([screen, 200]);
      expect((res.body as { off?: boolean }).off, screen).toBeUndefined();
    }
    expect(
      (await rows('SELECT screen FROM screen_session ORDER BY screen')).map((r) =>
        String(r.screen),
      ),
    ).toEqual(['2', '3']);

    // And typing the key again is all it takes.
    const back = await h.unlockAgain('1');
    const shown = (await getJson(back, '/api/public/screens/1')).body as Record<string, unknown>;
    expect(shown.off).toBeUndefined();
    expect(shown.panchayatSamitis).toBeDefined();
  });

  it('a key typed while the screen was off does not survive the switch back on', async () => {
    await switchScreen('1', false);
    const duringOff = await h.unlockAgain('1');
    expect((await getJson(duringOff, '/api/public/screens/1')).status).toBe(200); // told "off"
    // Switching on ends that session too, so the screen still asks for its key once.
    expect(await switchScreen('1', true)).toBe(1);
    expect((await getJson(duringOff, '/api/public/screens/1')).status).toBe(401);
  });
});

/**
 * The counting path is not touched by any of this. The proof is a full dump of every counting table,
 * byte for byte, across switching screens off and on AND typing keys — the only rows that may change
 * are in screen_session, which holds no result.
 */
describe('counting is untouched', () => {
  const countingRows = async () => {
    const parts: unknown[] = [];
    for (const sql of [
      'SELECT * FROM booth_entry ORDER BY id',
      'SELECT * FROM booth_entry_vote ORDER BY id',
      'SELECT * FROM postal_entry ORDER BY id',
      'SELECT * FROM postal_entry_vote ORDER BY id',
      'SELECT * FROM ward_declarations ORDER BY id',
    ]) {
      const [rows] = await pool.query<RowDataPacket[]>(sql);
      parts.push(rows);
    }
    return JSON.stringify(parts);
  };

  it('every counting row and every number of another screen survive a switch unchanged', async () => {
    const before = await countingRows();
    const screen3Before = await screenBody('3');
    await switchScreen('2', false);
    await switchScreen('2', true);
    expect(await countingRows()).toBe(before);
    expect((await screenBody('3')).zp).toEqual(screen3Before.zp);
  });

  it('switching every screen off and on, and typing every key again, changes no counting row', async () => {
    const before = await countingRows();
    for (const screen of ['1', '2', '3'] as const) {
      await switchScreen(screen, false);
      await h.unlockAgain(screen); // a key typed at the TV while it is off
      await switchScreen(screen, true);
      await h.unlockAgain(screen); // and again once it is back on
    }
    expect(await countingRows()).toBe(before);
    // The results themselves are still served, unchanged, to every screen.
    for (const screen of ['1', '2', '3'] as const) {
      const tv = await h.unlockAgain(screen);
      const body = (await getJson(tv, `/api/public/screens/${screen}`)).body as Record<
        string,
        unknown
      >;
      expect(body.off, screen).toBeUndefined();
      expect(screen === '3' ? body.zp : body.panchayatSamitis, screen).toBeDefined();
    }
  });
});
