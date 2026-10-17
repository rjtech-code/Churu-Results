import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { candidateAge } from '../../src/services/master-data/candidate-details.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import {
  CANDIDATE_HEADERS,
  PASSWORD,
  PS1_NAME,
  adminApp,
  apiClient,
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

const HEADERS = [...CANDIDATE_HEADERS, 'dob', 'age', 'education', 'mobile'];

/** Like xlsxBase64, but a cell may be a real Excel date cell. */
async function fileWithDates(rows: readonly (readonly (string | number | Date | null)[])[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow([...row]);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

async function detailsOf(wardId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ballot_position AS pos, DATE_FORMAT(dob, '%Y-%m-%d') AS dob, age_stated,
            education, mobile
       FROM candidate WHERE ward_id = ? AND is_nota = 0 ORDER BY ballot_position`,
    [wardId],
  );
  return rows;
}

interface CheckBody {
  ok: boolean;
  errors: { rows: number[]; message: string }[];
}

describe('candidate details in the Excel import', () => {
  it('imports dob (date cell or DD/MM/YYYY text), age, education (English or Hindi) and mobile', async () => {
    const res = await dm.post('/api/admin/candidates/save', {
      fileName: 'c.xlsx',
      fileBase64: await fileWithDates([
        // Excel date cell; Hindi education; mobile with +91 and spaces.
        [
          PS1_NAME,
          'PS',
          5,
          1,
          'राम',
          'P1',
          'M',
          null,
          new Date(Date.UTC(1980, 4, 15)),
          null,
          'उच्च माध्यमिक',
          '+91 98765 43210',
        ],
        // DD/MM/YYYY text and an age: the date of birth wins.
        [
          PS1_NAME,
          'PS',
          5,
          2,
          'सीता',
          null,
          'F',
          null,
          '21/11/1990',
          40,
          'post graduate',
          '07012345678',
        ],
        // Only the age; nothing else.
        [PS1_NAME, 'PS', 5, 3, 'गीता', null, 'F', null, null, 45, null, null],
      ]),
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(await detailsOf(w.psW5)).toEqual([
      {
        pos: 1,
        dob: '1980-05-15',
        age_stated: null,
        education: 'SR_SECONDARY',
        mobile: '9876543210',
      },
      {
        pos: 2,
        dob: '1990-11-21',
        age_stated: null,
        education: 'POST_GRADUATE',
        mobile: '7012345678',
      },
      { pos: 3, dob: null, age_stated: 45, education: null, mobile: null },
    ]);
    // Age on AGE_REFERENCE_DATE (20/11/2026): the birthday on 21/11 has not come yet.
    expect(candidateAge({ dob: '1990-11-21', ageStated: null })).toBe(35);
    expect(candidateAge({ dob: '1980-05-15', ageStated: null })).toBe(46);
    expect(candidateAge({ dob: null, ageStated: 45 })).toBe(45);
  });

  it('a wrong education or mobile is a Hindi row error and nothing is saved', async () => {
    const before = await masterSnapshot(pool);
    const fileBase64 = await fileWithDates([
      [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', null, null, 50, 'PhD', '9876543210'],
      [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', null, null, 40, 'Graduate', '12345'],
    ]);
    const check = await dm.post('/api/admin/candidates/check', { fileName: 'c.xlsx', fileBase64 });
    const body = check.body as CheckBody;
    expect(body.ok).toBe(false);
    expect(body.errors).toEqual([
      {
        rows: [2],
        message:
          'पंक्ति 2: शिक्षा "PhD" सही नहीं है — इनमें से एक लिखें: निरक्षर, साक्षर, प्राथमिक, उच्च प्राथमिक, माध्यमिक, उच्च माध्यमिक, स्नातक, स्नातकोत्तर, व्यावसायिक — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
      },
      {
        rows: [3],
        message:
          'पंक्ति 3: मोबाइल "12345" सही नहीं है — 10 अंकों का नंबर लिखें जो 6, 7, 8 या 9 से शुरू हो — Excel में इसे ठीक करके फ़ाइल फिर से चुनें',
      },
    ]);
    const save = await dm.post('/api/admin/candidates/save', {
      fileName: 'c.xlsx',
      fileBase64,
      password: PASSWORD,
    });
    expect(save.status).toBe(400);
    expect(await masterSnapshot(pool)).toBe(before);
  });

  it('an old file without the detail columns still imports (details empty)', async () => {
    const res = await dm.post('/api/admin/candidates/save', {
      fileName: 'old.xlsx',
      fileBase64: await xlsxBase64(CANDIDATE_HEADERS, [
        [PS1_NAME, 'PS', 5, 1, 'राम', 'P1', 'M', 'सामान्य'],
        [PS1_NAME, 'PS', 5, 2, 'सीता', null, 'F', 'सामान्य'],
      ]),
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(await detailsOf(w.psW5)).toEqual([
      { pos: 1, dob: null, age_stated: null, education: null, mobile: null },
      { pos: 2, dob: null, age_stated: null, education: null, mobile: null },
    ]);
  });
});
