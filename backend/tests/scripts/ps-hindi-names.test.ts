// npm run ps:set-hindi-names (Part 9.2): only panchayat_samiti.name_hindi, dry run by default,
// all-or-nothing, one audit row.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPsSetHindiNames } from '../../scripts/ps-set-hindi-names.js';
import { insert } from '../helpers/db.js';
import { auditCount, closeHarness, createHarness, makeCtx, resetDb, writeJson } from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const RATANGARH = 'RATANGARH PANCHAYAT SAMITI';
const RAJGARH = 'RAJGARH PANCHAYAT SAMITI';
let psIds: Record<string, number>;
let wardRow: string;

async function snapshot(): Promise<string> {
  const [ps] = await h.app.execute<RowDataPacket[]>(
    'SELECT id, district_id, name_english, name_hindi FROM panchayat_samiti ORDER BY id',
  );
  return JSON.stringify(ps);
}
async function names(): Promise<Record<string, string>> {
  const [rows] = await h.app.execute<RowDataPacket[]>(
    'SELECT name_english, name_hindi FROM panchayat_samiti',
  );
  return Object.fromEntries(rows.map((r) => [String(r.name_english), String(r.name_hindi)]));
}
async function wardsAndBooths(): Promise<string> {
  const [w] = await h.app.execute<RowDataPacket[]>('SELECT * FROM ward ORDER BY id');
  const [b] = await h.app.execute<RowDataPacket[]>('SELECT * FROM booth ORDER BY id');
  return JSON.stringify([w, b]);
}

beforeEach(async () => {
  await resetDb(h);
  const district = await insert(
    h.app,
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
    [],
  );
  psIds = {};
  // As a real import without Hindi names stores them: the English name in name_hindi.
  for (const name of [RATANGARH, RAJGARH]) {
    psIds[name] = await insert(
      h.app,
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
      [district, name, name],
    );
  }
  const ward = await insert(
    h.app,
    "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('PS', ?, ?, 1)",
    [district, psIds[RATANGARH] ?? 0],
  );
  const zp = await insert(
    h.app,
    "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, NULL, 1)",
    [district],
  );
  await insert(
    h.app,
    `INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, 1, 'बूथ', ?, ?)`,
    [psIds[RATANGARH] ?? 0, ward, zp],
  );
  wardRow = await wardsAndBooths();
});

describe('ps:set-hindi-names', () => {
  it('dry run (default) reports the change but writes nothing', async () => {
    const file = await writeJson(h, { [RATANGARH]: 'रतनगढ़' });
    const before = await snapshot();
    const audits = await auditCount(h);
    const { ctx, output } = makeCtx(h);
    const res = await runPsSetHindiNames({ file }, ctx);
    expect(res).toMatchObject({ ok: true, committed: false });
    expect(output.join('\n')).toContain(`${RATANGARH}: "${RATANGARH}" -> "रतनगढ़"`);
    expect(await snapshot()).toBe(before);
    expect(await auditCount(h)).toBe(audits);
  });

  it('commit updates ONLY name_hindi of the listed PS and writes exactly one audit row', async () => {
    const file = await writeJson(h, {
      [RATANGARH]: ' रतनगढ़ ',
      'rajgarh  panchayat samiti': 'राजगढ़',
    });
    const audits = await auditCount(h);
    const res = await runPsSetHindiNames({ file, commit: true }, makeCtx(h).ctx);
    expect(res).toMatchObject({ ok: true, committed: true });
    expect(await names()).toEqual({ [RATANGARH]: 'रतनगढ़', [RAJGARH]: 'राजगढ़' });
    expect(await wardsAndBooths()).toBe(wardRow); // wards and booths untouched
    expect(await auditCount(h)).toBe(audits + 1);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT entity, old_value, new_value FROM audit_log WHERE action = 'PS_HINDI_NAMES_SET'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity).toBe('panchayat_samiti');
    expect(rows[0]?.new_value).toEqual({ [RATANGARH]: 'रतनगढ़', [RAJGARH]: 'राजगढ़' });
    expect(rows[0]?.old_value).toEqual({ [RATANGARH]: RATANGARH, [RAJGARH]: RAJGARH });
  });

  it('an unknown name fails and writes nothing (even the valid names in the same file)', async () => {
    const file = await writeJson(h, {
      [RATANGARH]: 'रतनगढ़',
      'NOWHERE PANCHAYAT SAMITI': 'कहीं नहीं',
    });
    const before = await snapshot();
    const audits = await auditCount(h);
    const { ctx, output } = makeCtx(h);
    const res = await runPsSetHindiNames({ file, commit: true }, ctx);
    expect(res).toMatchObject({ ok: false, committed: false });
    expect(output.join('\n')).toContain('Unknown Panchayat Samiti: "NOWHERE PANCHAYAT SAMITI"');
    expect(await snapshot()).toBe(before);
    expect(await auditCount(h)).toBe(audits);
  });

  it('a duplicate Hindi name, an empty or a non-Devanagari value fails and writes nothing', async () => {
    const before = await snapshot();
    for (const data of [
      { [RATANGARH]: 'एक', [RAJGARH]: 'एक' },
      { [RATANGARH]: '   ' },
      { [RATANGARH]: 'Ratangarh' },
      { [RATANGARH]: 5 },
      [],
      {},
    ]) {
      const res = await runPsSetHindiNames(
        { file: await writeJson(h, data), commit: true },
        makeCtx(h).ctx,
      );
      expect(res.ok, JSON.stringify(data)).toBe(false);
    }
    expect(await snapshot()).toBe(before);
  });

  it('two PS can swap their Hindi names in one run (no unique-key clash)', async () => {
    await runPsSetHindiNames(
      { file: await writeJson(h, { [RATANGARH]: 'रतनगढ़', [RAJGARH]: 'राजगढ़' }), commit: true },
      makeCtx(h).ctx,
    );
    const res = await runPsSetHindiNames(
      { file: await writeJson(h, { [RATANGARH]: 'राजगढ़', [RAJGARH]: 'रतनगढ़' }), commit: true },
      makeCtx(h).ctx,
    );
    expect(res.ok).toBe(true);
    expect(await names()).toEqual({ [RATANGARH]: 'राजगढ़', [RAJGARH]: 'रतनगढ़' });
  });

  it('a name that would clash with an unlisted PS fails', async () => {
    await runPsSetHindiNames(
      { file: await writeJson(h, { [RAJGARH]: 'राजगढ़' }), commit: true },
      makeCtx(h).ctx,
    );
    const res = await runPsSetHindiNames(
      { file: await writeJson(h, { [RATANGARH]: 'राजगढ़' }), commit: true },
      makeCtx(h).ctx,
    );
    expect(res.ok).toBe(false);
    expect((await names())[RATANGARH]).toBe(RATANGARH);
  });

  it('applies the provisional docs/ps-names.json to a district with all 13 PS', async () => {
    const path = resolve(import.meta.dirname, '../../../docs/ps-names.json');
    const provisional = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
    expect(Object.keys(provisional)).toHaveLength(13);
    const [d] = await h.app.execute<RowDataPacket[]>('SELECT id FROM district');
    for (const english of Object.keys(provisional)) {
      if (english === RATANGARH || english === RAJGARH) continue;
      await insert(
        h.app,
        'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
        [Number(d[0]?.id), english, english],
      );
    }
    const res = await runPsSetHindiNames({ file: path, commit: true }, makeCtx(h).ctx);
    expect(res.ok).toBe(true);
    expect(await names()).toEqual(provisional);
  });
});
