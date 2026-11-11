// The observer overview must not slow counting down: ONE cached build, a FIXED number of queries
// whatever the size of the district (no query per ward, no N+1), and concurrent requests share it.
import type { Pool, PoolConnection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObserverCache } from '../../src/modules/observer/observer.cache.js';
import { createTestAppPool, createTestMigrationPool, insert, resetData } from '../helpers/db.js';
import { seedTwoPs } from '../auth/helpers.js';

let pool: Pool;
let migrator: Pool;

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

/** A pool whose connections count every execute() (transaction control via query() is excluded). */
function countingPool(real: Pool): { pool: Pool; count: () => number } {
  let n = 0;
  const wrapped = {
    ...real,
    getConnection: async (): Promise<PoolConnection> => {
      const conn = await real.getConnection();
      return new Proxy(conn, {
        get(target, prop, receiver): unknown {
          if (prop === 'execute') {
            const execute = target.execute.bind(target) as (...a: unknown[]) => unknown;
            return (...args: unknown[]): unknown => {
              n++;
              return execute(...args);
            };
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        },
      });
    },
  } as unknown as Pool;
  return { pool: wrapped, count: () => n };
}

/** `wards` PS wards in one PS, each with `boothsPerWard` booths and a 2-candidate ballot. */
async function seedWards(wards: number, boothsPerWard: number): Promise<void> {
  const { ps1 } = await seedTwoPs(pool);
  const [[district]] = (await pool.execute('SELECT id FROM district LIMIT 1')) as unknown as [
    { id: number }[],
  ];
  const districtId = district?.id ?? 0;
  const zp = await insert(
    pool,
    "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('ZP', ?, NULL, 1)",
    [districtId],
  );
  let boothNo = 0;
  for (let w = 1; w <= wards; w++) {
    const wardId = await insert(
      pool,
      "INSERT INTO ward (ward_type, district_id, panchayat_samiti_id, ward_no) VALUES ('PS', ?, ?, ?)",
      [districtId, ps1, w],
    );
    for (let b = 0; b < boothsPerWard; b++) {
      boothNo++;
      await insert(
        pool,
        'INSERT INTO booth (panchayat_samiti_id, booth_no, name_hindi, ps_ward_id, zp_ward_id) VALUES (?, ?, ?, ?, ?)',
        [ps1, boothNo, `बूथ ${String(boothNo)}`, wardId, zp],
      );
    }
    for (const [pos, name] of [
      [1, 'क'],
      [2, 'ख'],
    ] as const) {
      await insert(
        pool,
        "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, ?, ?, 'M', 0)",
        [wardId, pos, `उम्मीदवार ${name} ${String(w)}`],
      );
    }
    await insert(
      pool,
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 3, 'नोटा', NULL, 1)",
      [wardId],
    );
  }
}

describe('observer overview cost', () => {
  it('one build costs the same fixed number of queries for 2 wards and for 40', async () => {
    await resetData(migrator);
    await seedWards(2, 2);
    const small = countingPool(pool);
    await new ObserverCache(small.pool).get();
    const smallCount = small.count();

    await resetData(migrator);
    await seedWards(40, 6);
    const big = countingPool(pool);
    await new ObserverCache(big.pool).get();
    const bigCount = big.count();

    expect(bigCount).toBe(smallCount); // no query per ward, booth or candidate
    // 14 for the DM report read (6 + 8 engine inputs) + 18 for the Counting Status read
    // (9 + the election date + 8 engine inputs).
    expect(smallCount).toBe(32);
  });

  it('serving the dashboard from the cache costs no queries at all', async () => {
    await resetData(migrator);
    await seedWards(5, 3);
    const counting = countingPool(pool);
    const cache = new ObserverCache(counting.pool);
    await cache.get();
    const afterFirst = counting.count();
    // Every other page of the dashboard, plus repeated polls, read the same build.
    for (let i = 0; i < 10; i++) await cache.get();
    expect(counting.count()).toBe(afterFirst);
  });

  it('concurrent first requests share ONE build', async () => {
    await resetData(migrator);
    await seedWards(3, 2);
    const counting = countingPool(pool);
    const cache = new ObserverCache(counting.pool);
    const builds = await Promise.all([cache.get(), cache.get(), cache.get(), cache.get()]);
    expect(new Set(builds).size).toBe(1);
    expect(counting.count()).toBe(32);
  });
});
