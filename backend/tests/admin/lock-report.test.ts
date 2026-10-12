import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  PASSWORD,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  masterSnapshot,
} from './helpers.js';
import type { AdminWorld, ApiClient } from './helpers.js';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;
let app: Express;
let dm: ApiClient;

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
  w = await buildAdminWorld(pool);
  app = adminApp(pool);
  dm = await apiClient(app, 'dm_x4');
});

interface Preview {
  toLock: { id: number }[];
  noCandidates: { id: number }[];
  notReady: { id: number }[];
  alreadyLocked: number;
  canLock: boolean;
}
const preview = async (area: string) =>
  (await dm.get(`/api/admin/lock/preview?area=${area}`)).body as Preview;
const lockedIds = async () => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM ward WHERE is_locked = 1 ORDER BY id',
  );
  return rows.map((r) => Number(r.id));
};
const binary = (res: Response) => res.body as Buffer;
const getBinary = (path: string) =>
  dm.agent
    .get(path)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });

describe('DM ballot lock', () => {
  it('wards without candidates are listed and refuse the whole lock (existing rule)', async () => {
    const p = await preview(`PS:${w.ps1}`);
    // ps1: psW1, psW3 already locked; psW4 has candidates; psW5 has none.
    expect(p.toLock.map((x) => x.id).sort()).toEqual([w.psW4, w.psW5].sort());
    expect(p.noCandidates.map((x) => x.id)).toEqual([w.psW5]);
    expect(p.alreadyLocked).toBe(2);
    expect(p.canLock).toBe(false);

    const before = await masterSnapshot(pool);
    const res = await dm.post('/api/admin/lock', {
      area: `PS:${w.ps1}`,
      confirmText: 'LOCK',
      expectedWardIds: [w.psW4, w.psW5],
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('LOCK_REFUSED');
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('needs LOCK typed, the password, and the same plan as the preview', async () => {
    const area = 'ZP'; // zW1 is locked; zW2 gets one candidate (unopposed) first
    await pool.execute(
      "INSERT INTO candidate (ward_id, ballot_position, name_hindi, gender, is_nota) VALUES (?, 1, 'गीता', 'F', 0)",
      [w.zW2],
    );
    await pool.execute('UPDATE ward SET is_unopposed = 1 WHERE id = ?', [w.zW2]);
    const p = await preview(area);
    expect(p).toMatchObject({ canLock: true, toLock: [{ id: w.zW2 }], notReady: [{ id: w.zW2 }] });

    const bad = await dm.post('/api/admin/lock', {
      area,
      confirmText: 'lock',
      expectedWardIds: [w.zW2],
      password: PASSWORD,
    });
    expect(bad.status).toBe(400);
    const wrong = await dm.post('/api/admin/lock', {
      area,
      confirmText: 'LOCK',
      expectedWardIds: [w.zW2],
      password: 'wrong',
    });
    expect(wrong.body).toEqual({ error: 'REAUTH_FAILED' });
    const changed = await dm.post('/api/admin/lock', {
      area,
      confirmText: 'LOCK',
      expectedWardIds: [w.zW2, 12345],
      password: PASSWORD,
    });
    expect(changed.body).toEqual({ error: 'LOCK_PLAN_CHANGED' });
    expect(await lockedIds()).not.toContain(w.zW2);

    const ok = await dm.post('/api/admin/lock', {
      area,
      confirmText: 'LOCK',
      expectedWardIds: [w.zW2],
      password: PASSWORD,
    });
    expect([ok.status, ok.body]).toEqual([200, { locked: [w.zW2] }]);
    const [row] = await pool.execute<RowDataPacket[]>(
      'SELECT locked_by, locked_by_name FROM ward WHERE id = ?',
      [w.zW2],
    );
    expect(row[0]).toEqual({ locked_by: w.users.dm, locked_by_name: 'Full dm_x4' });
    const [audit] = await auditOf(pool, 'BALLOT_LOCK');
    expect(audit?.new_value).toMatchObject({ via: 'web', scope: 'ZP', locked_ward_ids: [w.zW2] });

    // Locked: the RO can no longer change it, and a second lock has nothing to do.
    expect((await preview(area)).toLock).toEqual([]);
  });

  it('candidate status per area', async () => {
    const res = await dm.get(`/api/admin/candidate-status?area=PS:${w.ps1}`);
    const body = res.body as {
      areas: { area: string; total: number; locked: number; pending: number }[];
      detail: { wards: { id: number; status: string; candidates: number }[] };
    };
    expect(body.areas.find((a) => a.area === `PS:${w.ps1}`)).toMatchObject({
      total: 4,
      locked: 2,
      pending: 2,
    });
    expect(body.areas.find((a) => a.area === 'ZP')).toMatchObject({ total: 2, locked: 1 });
    expect(body.detail.wards.find((x) => x.id === w.psW4)).toMatchObject({
      status: 'PENDING',
      candidates: 2,
    });
  });
});

describe('DM downloads', () => {
  it('ballot report (.xlsx) for one PS, the ZP, or all — audited', async () => {
    const res = await getBinary(`/api/admin/ballot-report.xlsx?scope=PS:${w.ps1}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['cache-control']).toBe('no-store');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(binary(res) as unknown as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(['CHURU']);
    const zp = await getBinary('/api/admin/ballot-report.xlsx?scope=ZP');
    const zpBook = new ExcelJS.Workbook();
    await zpBook.xlsx.load(binary(zp) as unknown as ArrayBuffer);
    expect(zpBook.worksheets.map((s) => s.name)).toEqual(['ZP']);
    expect((await auditOf(pool, 'BALLOT_REPORT_DOWNLOADED')).length).toBe(2);
    expect((await dm.get('/api/admin/ballot-report.xlsx?scope=PS:999999')).status).toBe(404);
    expect((await dm.get('/api/admin/ballot-report.xlsx?scope=../x')).status).toBe(400);
  });

  it('empty templates', async () => {
    const res = await getBinary('/api/admin/templates/candidates.xlsx');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(binary(res) as unknown as ArrayBuffer);
    const header = book.worksheets[0]?.getRow(1).values as unknown[];
    expect(header).toContain('ballot_position');
    expect((await dm.get('/api/admin/templates/secrets.xlsx')).status).toBe(404);
  });
});
