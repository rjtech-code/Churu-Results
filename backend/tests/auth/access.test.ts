import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ballotWriteAllowed,
  canReadWard,
  canWriteBallot,
  canWriteWard,
  wardReadAllowed,
  wardWriteAllowed,
} from '../../src/services/access.js';
import type { AccessUser, BallotFor } from '../../src/services/access.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { seedTwoPs } from './helpers.js';

let app: Pool;
let migrator: Pool;
let ids: {
  ps1: number;
  ps2: number;
  psWardOwn: number;
  psWardOther: number;
  zpWard: number;
  boothOwn: number;
  boothOther: number;
};

async function insert(sql: string, params: (string | number | null)[]): Promise<number> {
  const [r] = await app.execute<ResultSetHeader>(sql, params);
  return r.insertId;
}

beforeAll(async () => {
  app = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  const { ps1, ps2 } = await seedTwoPs(app);
  const ward = (type: string, ps: number | null, no: number) =>
    insert(
      'INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) SELECT ?, district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [type, ps, no, ps1],
    );
  const psWardOwn = await ward('PS', ps1, 1);
  const psWardOther = await ward('PS', ps2, 1);
  const zpWard = await ward('ZP', null, 1);
  const booth = (ps: number, wardId: number) =>
    insert(
      "INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, 1, 'बूथ', ?, ?)",
      [ps, wardId, zpWard],
    );
  ids = {
    ps1,
    ps2,
    psWardOwn,
    psWardOther,
    zpWard,
    boothOwn: await booth(ps1, psWardOwn),
    boothOther: await booth(ps2, psWardOther),
  };
});
afterAll(async () => {
  await app.end();
  await migrator.end();
});

const users = () => ({
  psRo: { role: 'PS_RO', panchayatSamitiId: ids.ps1 } as AccessUser,
  zpRo: { role: 'ZP_RO', panchayatSamitiId: null } as AccessUser,
  dm: { role: 'DM', panchayatSamitiId: null } as AccessUser,
});

describe('canWriteBallot', () => {
  // [user, booth, ballot, expected]
  const cases: [keyof ReturnType<typeof users>, 'boothOwn' | 'boothOther', BallotFor, boolean][] = [
    ['psRo', 'boothOwn', 'PS', true],
    ['psRo', 'boothOwn', 'ZP', false],
    ['psRo', 'boothOther', 'PS', false],
    ['psRo', 'boothOther', 'ZP', false],
    ['zpRo', 'boothOwn', 'PS', false],
    ['zpRo', 'boothOwn', 'ZP', true],
    ['zpRo', 'boothOther', 'PS', false],
    ['zpRo', 'boothOther', 'ZP', true],
    ['dm', 'boothOwn', 'PS', false],
    ['dm', 'boothOwn', 'ZP', false],
    ['dm', 'boothOther', 'PS', false],
    ['dm', 'boothOther', 'ZP', false],
  ];
  it.each(cases)('%s on %s, %s ballot -> %s', async (user, booth, ballot, expected) => {
    expect(await canWriteBallot(app, users()[user], ids[booth], ballot)).toBe(expected);
  });

  it('unknown booth -> false for every role', async () => {
    for (const u of Object.values(users())) {
      expect(await canWriteBallot(app, u, 999_999, 'PS')).toBe(false);
      expect(await canWriteBallot(app, u, 999_999, 'ZP')).toBe(false);
    }
  });

  it('a PS_RO without a PS can write nothing', () => {
    expect(ballotWriteAllowed({ role: 'PS_RO', panchayatSamitiId: null }, ids.ps1, 'PS')).toBe(
      false,
    );
  });
});

describe('canWriteWard / canReadWard', () => {
  type WardKey = 'psWardOwn' | 'psWardOther' | 'zpWard';
  // [user, ward, write, read]
  const cases: [keyof ReturnType<typeof users>, WardKey, boolean, boolean][] = [
    ['psRo', 'psWardOwn', true, true],
    ['psRo', 'psWardOther', false, false],
    ['psRo', 'zpWard', false, false],
    ['zpRo', 'psWardOwn', false, false],
    ['zpRo', 'psWardOther', false, false],
    ['zpRo', 'zpWard', true, true],
    ['dm', 'psWardOwn', false, true],
    ['dm', 'psWardOther', false, true],
    ['dm', 'zpWard', false, true],
  ];
  it.each(cases)('%s on %s -> write %s, read %s', async (user, ward, write, read) => {
    expect(await canWriteWard(app, users()[user], ids[ward])).toBe(write);
    expect(await canReadWard(app, users()[user], ids[ward])).toBe(read);
  });

  it('unknown ward -> false for every role', async () => {
    for (const u of Object.values(users())) {
      expect(await canWriteWard(app, u, 999_999)).toBe(false);
      expect(await canReadWard(app, u, 999_999)).toBe(false);
    }
  });

  it('the pure rules agree for a PS_RO without a PS', () => {
    const orphan: AccessUser = { role: 'PS_RO', panchayatSamitiId: null };
    expect(wardWriteAllowed(orphan, { wardType: 'PS', panchayatSamitiId: null })).toBe(false);
    expect(wardReadAllowed(orphan, { wardType: 'PS', panchayatSamitiId: ids.ps1 })).toBe(false);
  });
});
