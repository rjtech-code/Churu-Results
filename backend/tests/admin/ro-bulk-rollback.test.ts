// The bulk add is ONE transaction: if the second account fails to insert, the first one (and its
// audit row) must be rolled back too. insertAccount is wrapped to fail on a chosen call.
import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RO_BULK_COLUMNS } from '../../src/services/master-data/ro-bulk.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  buildAdminWorld,
  dataAuditCount,
  masterSnapshot,
  xlsxBase64,
} from './helpers.js';

const insertFault = vi.hoisted(() => ({ failOnCall: 0, calls: 0 }));

vi.mock('../../src/services/master-data/accounts.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/master-data/accounts.js')>();
  return {
    ...real,
    insertAccount: async (...args: Parameters<typeof real.insertAccount>) => {
      insertFault.calls++;
      if (insertFault.calls === insertFault.failOnCall) throw new Error('insert failed (test)');
      return real.insertAccount(...args);
    },
  };
});

let pool: Pool;
let migrator: Pool;
let app: Express;

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
  const w = await buildAdminWorld(pool);
  for (const [en, hi] of [
    ['SARDARSHAHAR PANCHAYAT SAMITI', 'पंचायत समिति सरदारशहर'],
    ['TARANAGAR PANCHAYAT SAMITI', 'पंचायत समिति तारानगर'],
  ] as const)
    await pool.execute<ResultSetHeader>(
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) SELECT district_id, ?, ? FROM panchayat_samiti WHERE id = ?',
      [en, hi, w.ps1],
    );
  app = adminApp(pool);
  insertFault.calls = 0;
  insertFault.failOnCall = 0;
});

describe('RO bulk add: all or nothing', () => {
  it('a failure on the second account rolls back the first one and every audit row', async () => {
    const dm = await apiClient(app, 'dm_x4');
    const upload = {
      fileName: 'ro.xlsx',
      fileBase64: await xlsxBase64(
        [...RO_BULK_COLUMNS],
        [
          ['PS', 'Sardarshahar', 'रमेश कुमार', '9829011111'],
          ['PS', 'Taranagar', 'सीमा देवी', '9829022222'],
        ],
      ),
    };
    const preview = (await dm.post('/api/admin/users/bulk/check', upload)).body as {
      expectedSeats: string[];
    };
    expect(preview.expectedSeats).toHaveLength(2);

    const before = await masterSnapshot(pool);
    const audits = await dataAuditCount(pool);
    insertFault.failOnCall = 2;
    const res = await dm.post('/api/admin/users/bulk/save', {
      ...upload,
      password: PASSWORD,
      allowErrors: false,
      expectedSeats: preview.expectedSeats,
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('insert failed');
    expect(insertFault.calls).toBe(2);
    expect(await masterSnapshot(pool)).toBe(before);
    expect(await dataAuditCount(pool)).toBe(audits);
  });
});
