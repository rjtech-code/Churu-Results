import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runScreensSet } from '../../scripts/screens-set.js';
import { runScreensShow } from '../../scripts/screens-show.js';
import {
  DEFAULT_SCREEN_LAYOUT,
  SCREEN_LAYOUT_KEY,
  validateScreenLayout,
} from '../../src/services/screen-layout.js';
import { createTestMigrationPool, resetData } from '../helpers/db.js';
import { closeHarness, createHarness, makeCtx } from '../scripts/helpers.js';
import type { Harness } from '../scripts/helpers.js';
import { getJson, publicApp, waitFor } from './helpers.js';
import type { PublicHarness } from './helpers.js';

let h: Harness;
let migrator: Pool;
let pub: PublicHarness | null = null;
const ALL = [...DEFAULT_SCREEN_LAYOUT['1'], ...DEFAULT_SCREEN_LAYOUT['2']];

beforeAll(async () => {
  h = await createHarness();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await closeHarness(h);
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  // All 13 real Panchayat Samitis (names exactly as the geography import stores them).
  const [d] = await h.app.execute<ResultSetHeader>(
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
  );
  for (const name of ALL) {
    await h.app.execute(
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
      [d.insertId, name, `${name} (हि)`],
    );
  }
});
afterEach(() => {
  pub?.stop();
  pub = null;
});

async function layoutFile(layout: unknown): Promise<string> {
  const file = join(h.dir, `layout-${Date.now()}-${Math.random()}.json`);
  await writeFile(file, JSON.stringify(layout));
  return file;
}

describe('screen layout', () => {
  it('the default names are exactly the 13 PS of the official file (7 on screen 1, 6 on screen 2)', async () => {
    const example = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../../docs/ps-names.example.json'), 'utf8'),
    ) as Record<string, string>;
    expect([...ALL].sort()).toEqual(Object.keys(example).sort());
    expect(DEFAULT_SCREEN_LAYOUT['1']).toHaveLength(7);
    expect(DEFAULT_SCREEN_LAYOUT['2']).toHaveLength(6);
    expect(validateScreenLayout(DEFAULT_SCREEN_LAYOUT, ALL).problems).toEqual([]);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [SCREEN_LAYOUT_KEY],
    );
    expect(JSON.parse(String(rows[0]?.setting_value))).toEqual(DEFAULT_SCREEN_LAYOUT);
  });

  it('the public screens follow the layout order', async () => {
    pub = await publicApp(h.app);
    const s1 = (await getJson(pub.app, '/api/public/screens/1')).body as {
      panchayatSamitis: { panchayatSamiti: { name: string } }[];
    };
    expect(s1.panchayatSamitis.map((b) => b.panchayatSamiti.name)).toEqual(
      DEFAULT_SCREEN_LAYOUT['1'].map((n) => `${n} (हि)`),
    );
  });

  it('validation: missing, duplicate and unknown PS, screen 3, wrong shapes', () => {
    const one = DEFAULT_SCREEN_LAYOUT['1'];
    const two = DEFAULT_SCREEN_LAYOUT['2'];
    const problems = (layout: unknown) => validateScreenLayout(layout, ALL).problems.join(' | ');
    expect(problems({ '1': one.slice(1), '2': two })).toContain(`"${one[0] ?? ''}" is missing`);
    expect(problems({ '1': one, '2': [...two, one[0]] })).toContain('appears more than once');
    expect(problems({ '1': [...one, 'NOWHERE PANCHAYAT SAMITI'], '2': two })).toContain(
      'unknown Panchayat Samiti "NOWHERE PANCHAYAT SAMITI"',
    );
    expect(problems({ '1': one, '2': two, '3': [] })).toContain('Only screens "1" and "2"');
    expect(problems([])).toContain('must be a JSON object');
    expect(problems({ '1': 'x', '2': two })).toContain('Screen 1 must be a list');
    // Names are matched case-insensitively and stored as spelled in the database.
    const lower = validateScreenLayout({ '1': one.map((n) => n.toLowerCase()), '2': two }, ALL);
    expect(lower.layout?.['1']).toEqual(one);
  });

  it('screens:set rejects an invalid file and writes nothing; dry run writes nothing', async () => {
    const before = await h.app.execute<RowDataPacket[]>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [SCREEN_LAYOUT_KEY],
    );
    const bad = await runScreensSet(
      { file: await layoutFile({ '1': DEFAULT_SCREEN_LAYOUT['1'], '2': [] }), commit: true },
      makeCtx(h).ctx,
    );
    expect(bad.ok).toBe(false);
    const swapped = { '1': DEFAULT_SCREEN_LAYOUT['2'], '2': DEFAULT_SCREEN_LAYOUT['1'] };
    const dry = await runScreensSet({ file: await layoutFile(swapped) }, makeCtx(h).ctx);
    expect(dry).toMatchObject({ ok: true, committed: false });
    const after = await h.app.execute<RowDataPacket[]>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [SCREEN_LAYOUT_KEY],
    );
    expect(after[0]).toEqual(before[0]);
    const [audit] = await h.app.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'SCREEN_LAYOUT_CHANGED'",
    );
    expect(Number(audit[0]?.n)).toBe(0);
  });

  it('a valid change is audited and reaches the running screens within the poll interval', async () => {
    pub = await publicApp(h.app, { layoutPollMs: 150 });
    // Let the poller record the current stamp first.
    await new Promise((r) => setTimeout(r, 400));
    const moved = {
      '1': [...DEFAULT_SCREEN_LAYOUT['1'], 'RAJGARH PANCHAYAT SAMITI'],
      '2': DEFAULT_SCREEN_LAYOUT['2'].filter((n) => n !== 'RAJGARH PANCHAYAT SAMITI'),
    };
    const res = await runScreensSet(
      { file: await layoutFile(moved), commit: true },
      makeCtx(h).ctx,
    );
    expect(res).toMatchObject({ ok: true, committed: true });
    const [audit] = await h.app.query<RowDataPacket[]>(
      "SELECT old_value, new_value FROM audit_log WHERE action = 'SCREEN_LAYOUT_CHANGED'",
    );
    expect(audit[0]).toMatchObject({ old_value: DEFAULT_SCREEN_LAYOUT, new_value: moved });

    const harness = pub;
    const names = await waitFor(async () => {
      const s1 = (await getJson(harness.app, '/api/public/screens/1')).body as {
        panchayatSamitis: { panchayatSamiti: { name: string } }[];
      };
      const list = s1.panchayatSamitis.map((b) => b.panchayatSamiti.name);
      return list.length === 8 ? list : undefined;
    }, 3000);
    expect(names[7]).toBe('RAJGARH PANCHAYAT SAMITI (हि)');
    const meta = (await getJson(pub.app, '/api/public/meta')).body as {
      screens: Record<string, unknown>;
    };
    expect((meta.screens['1'] as number[]).length).toBe(8);
    expect((meta.screens['2'] as number[]).length).toBe(5);
  });

  it('screens:show prints the layout and checks it', async () => {
    const { ctx, output } = makeCtx(h);
    const res = await runScreensShow(ctx);
    expect(res.ok).toBe(true);
    expect(output.join('\n')).toContain(
      'Layout is valid: all Panchayat Samitis appear exactly once.',
    );
    expect(output.join('\n')).toContain('1. CHURU PANCHAYAT SAMITI');
  });
});
