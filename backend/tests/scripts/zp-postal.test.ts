// npm run zp-postal:set-default: dry run by default, --commit writes; every ZP ward once, 13 PS
// matched by name, no duplicate; one audit row per change; re-running changes nothing.
import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runZpPostalSetDefault } from '../../scripts/zp-postal-set-default.js';
import {
  KEPT_TABLES,
  MASTER_DATA_TABLES,
  TEST_DATA_TABLES,
} from '../../src/services/setup/data-reset.js';
import {
  DEFAULT_ZP_POSTAL_MAPPING,
  PS_COUNT,
  ZP_WARD_COUNT,
  checkZpPostalMapping,
} from '../../src/services/zp-postal-default.js';
import { insert } from '../helpers/db.js';
import { closeHarness, createHarness, makeCtx, resetDb } from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
let psIds: Record<string, number>;
let wardIds: Record<number, number>;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

beforeEach(async () => {
  await resetDb(h);
  const district = await insert(
    h.app,
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
    [],
  );
  psIds = {};
  for (const name of Object.keys(DEFAULT_ZP_POSTAL_MAPPING)) {
    psIds[name] = await insert(
      h.app,
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
      [district, name, name],
    );
  }
  wardIds = {};
  for (let no = 1; no <= ZP_WARD_COUNT; no++) {
    wardIds[no] = await insert(
      h.app,
      "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, NULL, ?)",
      [district, no],
    );
  }
});

const rows = async () => {
  const [r] = await h.app.query<RowDataPacket[]>(
    'SELECT zp_ward_id, ps_id FROM zp_ward_postal_assignment ORDER BY zp_ward_id',
  );
  return r.map((x) => [Number(x.zp_ward_id), Number(x.ps_id)]);
};
const audits = async () => {
  const [r] = await h.app.query<RowDataPacket[]>(
    "SELECT old_value, new_value FROM audit_log WHERE action = 'ZP_POSTAL_ASSIGNMENT_SET' ORDER BY id",
  );
  return r;
};
const ward = (no: number) => wardIds[no] ?? 0;
const ps = (name: string) => psIds[name] ?? 0;

describe('the official mapping', () => {
  it('covers ZP wards 1-39 exactly once with 13 different PS', () => {
    const { problems, byWard } = checkZpPostalMapping(DEFAULT_ZP_POSTAL_MAPPING);
    expect(problems).toEqual([]);
    expect(byWard.size).toBe(ZP_WARD_COUNT);
    expect(Object.keys(DEFAULT_ZP_POSTAL_MAPPING)).toHaveLength(PS_COUNT);
    expect(byWard.get(19)).toBe('RATANGARH PANCHAYAT SAMITI');
    expect(byWard.get(39)).toBe('TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI');
  });

  it('a wrong mapping is reported: missing ward, duplicate ward, unknown ward, 12 PS', () => {
    const missing = { ...DEFAULT_ZP_POSTAL_MAPPING, 'SIDDHMUKH PANCHAYAT SAMITI': [33] };
    expect(checkZpPostalMapping(missing).problems).toContain(
      'ZP ward 34 is not assigned to any Panchayat Samiti.',
    );
    const dup = { ...DEFAULT_ZP_POSTAL_MAPPING, 'SIDDHMUKH PANCHAYAT SAMITI': [33, 34, 1] };
    expect(checkZpPostalMapping(dup).problems.join('\n')).toContain('ZP ward 1 is assigned twice');
    const unknown = { ...DEFAULT_ZP_POSTAL_MAPPING, 'SIDDHMUKH PANCHAYAT SAMITI': [33, 34, 40] };
    expect(checkZpPostalMapping(unknown).problems.join('\n')).toContain(
      'ZP ward 40 does not exist',
    );
    const { 'SIDDHMUKH PANCHAYAT SAMITI': _gone, ...twelve } = DEFAULT_ZP_POSTAL_MAPPING;
    expect(checkZpPostalMapping(twelve).problems.join('\n')).toContain('must name 13');
  });
});

describe('zp-postal:set-default', () => {
  it('dry run (default): reports the plan, writes nothing, no audit row', async () => {
    const res = await runZpPostalSetDefault({}, makeCtx(h).ctx);
    expect(res).toMatchObject({ ok: true, committed: false });
    const report = await readFile(res.reportPath, 'utf8');
    expect(report).toContain('ZP ward 9: RATANGARH PANCHAYAT SAMITI');
    expect(report).toContain('Re-run with --commit');
    expect(await rows()).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it('--commit: 39 rows as in the official order and one audit row; re-run changes nothing', async () => {
    const res = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(res).toMatchObject({ ok: true, committed: true });
    const saved = await rows();
    expect(saved).toHaveLength(ZP_WARD_COUNT);
    expect(saved).toContainEqual([ward(1), ps('BHANIPURA PANCHAYAT SAMITI')]);
    expect(saved).toContainEqual([ward(26), ps('CHURU PANCHAYAT SAMITI')]);
    expect(saved).toContainEqual([ward(29), ps('CHANDGOTHI HQ RAJGARH PANCHAYAT SAMITI')]);
    expect(saved).toContainEqual([
      ward(37),
      ps('TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI'),
    ]);
    const first = await audits();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      old_value: {},
      new_value: { '9': 'RATANGARH PANCHAYAT SAMITI', '35': 'TARANAGAR EAST PANCHAYAT SAMITI' },
    });

    const again = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(again).toMatchObject({ ok: true, committed: false });
    expect(await readFile(again.reportPath, 'utf8')).toContain('nothing to change');
    expect(await rows()).toEqual(saved);
    expect(await audits()).toHaveLength(1);
  });

  it('a changed assignment is replaced and audited with the old value', async () => {
    await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    await h.app.execute('UPDATE zp_ward_postal_assignment SET ps_id = ? WHERE zp_ward_id = ?', [
      ps('CHURU PANCHAYAT SAMITI'),
      ward(1),
    ]);
    const res = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(res.committed).toBe(true);
    expect(await rows()).toContainEqual([ward(1), ps('BHANIPURA PANCHAYAT SAMITI')]);
    const last = (await audits()).at(-1);
    expect(last).toMatchObject({
      old_value: { '1': 'CHURU PANCHAYAT SAMITI' },
      new_value: { '1': 'BHANIPURA PANCHAYAT SAMITI' },
    });
  });

  it('a wrong mapping is refused: nothing written', async () => {
    const bad = { ...DEFAULT_ZP_POSTAL_MAPPING, 'SIDDHMUKH PANCHAYAT SAMITI': [33, 34, 1] };
    const res = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx, bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('ZP ward 1 is assigned twice');
    expect(await rows()).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it('the database must match: unknown PS, missing ZP ward, extra ZP ward -> error, nothing written', async () => {
    await h.app.execute("UPDATE panchayat_samiti SET name_english = 'X' WHERE id = ?", [
      ps('SIDDHMUKH PANCHAYAT SAMITI'),
    ]);
    const noPs = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(noPs.ok).toBe(false);
    expect(noPs.errors.join('\n')).toContain('"SIDDHMUKH PANCHAYAT SAMITI" is not in the database');
    await h.app.execute('UPDATE panchayat_samiti SET name_english = ? WHERE id = ?', [
      'SIDDHMUKH PANCHAYAT SAMITI',
      ps('SIDDHMUKH PANCHAYAT SAMITI'),
    ]);

    await h.app.execute('DELETE FROM ward WHERE id = ?', [ward(39)]);
    const noWard = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(noWard.ok).toBe(false);
    expect(noWard.errors).toContain('ZP ward 39 is not in the database.');

    await h.app.execute(
      "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT 'ZP', district_id, NULL, 40 FROM ward WHERE id = ?",
      [ward(1)],
    );
    const extra = await runZpPostalSetDefault({ commit: true }, makeCtx(h).ctx);
    expect(extra.errors).toContain('ZP ward 40 is in the database but not in the mapping.');
    expect(await rows()).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it('warns (no error) when the assigned PS has no booth in that ZP ward', async () => {
    const res = await runZpPostalSetDefault({}, makeCtx(h).ctx);
    expect(res.ok).toBe(true);
    expect(res.warnings.join('\n')).toContain('ZP ward 1: BHANIPURA PANCHAYAT SAMITI has no booth');
  });
});

describe('data resets', () => {
  it('a master-data replace empties the table (new ward ids); a test-data reset keeps it', () => {
    expect(MASTER_DATA_TABLES).toContain('zp_ward_postal_assignment');
    expect(KEPT_TABLES.has('zp_ward_postal_assignment')).toBe(false);
    expect(TEST_DATA_TABLES).not.toContain('zp_ward_postal_assignment');
  });
});
