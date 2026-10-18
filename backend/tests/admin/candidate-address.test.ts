// Candidate address and occupation (Prarup-7 पता / व्यवसाय): optional text in the Excel import,
// the DM's details edit and the RO's form, with the same checks, privacy and audit as the other
// details.
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ADDRESS_LENGTH,
  MAX_OCCUPATION_LENGTH,
} from '../../src/services/master-data/candidate-details.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  CANDIDATE_HEADERS,
  PASSWORD,
  PS1_NAME,
  adminApp,
  apiClient,
  auditOf,
  buildAdminWorld,
  masterSnapshot,
  xlsxBase64,
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

const HEADERS = [...CANDIDATE_HEADERS, 'mobile', 'address', 'occupation'];
const ADDRESS = 'ग्राम पोस्ट- साण्डन, तह.- सुजानगढ़, जिला- चूरू';

async function textDetails(wardId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT ballot_position AS pos, address, occupation FROM candidate WHERE ward_id = ? AND is_nota = 0 ORDER BY ballot_position',
    [wardId],
  );
  return rows;
}

const save = async (headers: readonly string[], rows: (string | number | null)[][]) =>
  dm.post('/api/admin/candidates/save', {
    fileName: 'c.xlsx',
    fileBase64: await xlsxBase64(headers, rows),
    password: PASSWORD,
  });

describe('address and occupation in the Excel import', () => {
  it('are imported when the columns are there (spaces tidied); empty cells stay empty', async () => {
    const res = await save(HEADERS, [
      [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, null, `  ${ADDRESS}   `, 'कृषि'],
      [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, null, null, null],
    ]);
    expect(res.status).toBe(200);
    expect(await textDetails(w.psW5)).toEqual([
      { pos: 1, address: ADDRESS, occupation: 'कृषि' },
      { pos: 2, address: null, occupation: null },
    ]);
  });

  it('a file without the new columns still imports (both empty)', async () => {
    expect(
      (await save(CANDIDATE_HEADERS, [[PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य']])).status,
    ).toBe(200);
    expect(await textDetails(w.psW5)).toEqual([{ pos: 1, address: null, occupation: null }]);
  });

  it('too long: a Hindi row error in the dry-run check, and nothing is saved', async () => {
    const before = await masterSnapshot(pool);
    const fileBase64 = await xlsxBase64(HEADERS, [
      [
        PS1_NAME,
        'PS',
        5,
        1,
        'राम',
        'P1',
        'M',
        null,
        null,
        'क'.repeat(MAX_ADDRESS_LENGTH + 1),
        null,
      ],
      [
        PS1_NAME,
        'PS',
        5,
        2,
        'सीता',
        null,
        'F',
        null,
        null,
        null,
        'ख'.repeat(MAX_OCCUPATION_LENGTH + 1),
      ],
    ]);
    const check = await dm.post('/api/admin/candidates/check', { fileName: 'c.xlsx', fileBase64 });
    expect((check.body as { ok: boolean }).ok).toBe(false);
    expect((check.body as { errors: { rows: number[]; message: string }[] }).errors).toEqual([
      {
        rows: [2],
        message: `पंक्ति 2: पता ${String(MAX_ADDRESS_LENGTH)} अक्षरों से लंबा है — Excel में इसे ठीक करके फ़ाइल फिर से चुनें`,
      },
      {
        rows: [3],
        message: `पंक्ति 3: व्यवसाय ${String(MAX_OCCUPATION_LENGTH)} अक्षरों से लंबा है — Excel में इसे ठीक करके फ़ाइल फिर से चुनें`,
      },
    ]);
    expect(
      (
        await dm.post('/api/admin/candidates/save', {
          fileName: 'c.xlsx',
          fileBase64,
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(await masterSnapshot(pool)).toBe(before);
  });
});

describe('the DM edit and the RO form', () => {
  it('the DM changes address / occupation; the audit keeps old and new values', async () => {
    expect(
      (await save(CANDIDATE_HEADERS, [[PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य']])).status,
    ).toBe(200);
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM candidate WHERE ward_id = ? AND is_nota = 0',
      [w.psW5],
    );
    const id = Number(rows[0]?.id);
    const path = `/api/admin/candidates/${String(id)}/details`;
    expect((await dm.post(path, { address: ADDRESS, occupation: 'व्यापार' })).status).toBe(200);
    expect(await textDetails(w.psW5)).toEqual([
      { pos: 1, address: ADDRESS, occupation: 'व्यापार' },
    ]);
    const [audit] = await auditOf(pool, 'CANDIDATE_DETAILS_CHANGED');
    expect(audit?.old_value).toMatchObject({ address: null, occupation: null });
    expect(audit?.new_value).toMatchObject({ address: ADDRESS, occupation: 'व्यापार' });
    expect((await dm.get(`/api/admin/wards/${String(w.psW5)}/candidates`)).body).toMatchObject({
      candidates: [{ address: ADDRESS, occupation: 'व्यापार' }],
    });
  });

  it('the ward’s own RO saves and reads them on the candidate form', async () => {
    const ro = await apiClient(app, 'ro_ps1_x1');
    const path = `/api/candidates/wards/${String(w.psW5)}`;
    const res = await ro.put(path, {
      candidates: [
        {
          ballotPosition: 1,
          nameHindi: 'राम',
          partyId: w.p1,
          gender: 'M',
          address: ADDRESS,
          occupation: 'कृषि',
        },
        { ballotPosition: 2, nameHindi: 'सीता', partyId: null, gender: 'F' },
      ],
    });
    expect(res.status).toBe(200);
    expect((await ro.get(path)).body).toMatchObject({
      candidates: [
        { ballotPosition: 1, address: ADDRESS, occupation: 'कृषि' },
        { ballotPosition: 2, address: null, occupation: null },
      ],
    });
  });
});
