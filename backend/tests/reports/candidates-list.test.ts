import ExcelJS from 'exceljs';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANDIDATE_LIST_HEADERS } from '../../src/modules/reports/candidates-list.js';
import { readReportData } from '../../src/modules/reports/reports.data.js';
import { buildApp, login } from '../auth/helpers.js';
import { declareClient } from '../declare/helpers.js';
import { PASSWORD } from '../counting/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { HYPERLINK, buildReportWorld } from './world.js';
import type { ReportWorld } from './world.js';

let pool: Pool;
let migrator: Pool;
let world: ReportWorld;

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  world = await buildReportWorld(pool, migrator);
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

async function as(username: string) {
  const agent = request.agent(buildApp(pool));
  expect((await login(agent, username, PASSWORD)).status).toBe(200);
  return agent;
}

type Row = (string | number | null)[];

async function xlsxRows(): Promise<{ sheet: ExcelJS.Worksheet; rows: Row[] }> {
  const dm = await as(world.users.dm);
  const res = await dm
    .get('/api/reports/candidates.xlsx')
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('no sheet');
  const rows: Row[] = [];
  sheet.eachRow((row, n) => {
    if (n > 1) rows.push(CANDIDATE_LIST_HEADERS.map((_, i) => (row.values as Row)[i + 1] ?? null));
  });
  return { sheet, rows };
}

describe('candidate list report', () => {
  it('DM only: ROs get 403, logged out 401, the DM 200 (csv and xlsx)', async () => {
    for (const p of ['/api/reports/candidates.csv', '/api/reports/candidates.xlsx']) {
      for (const u of [world.users.ro1, world.users.zp]) {
        expect((await (await as(u)).get(p)).status, `${u} ${p}`).toBe(403);
      }
      expect((await request(buildApp(pool)).get(p)).status, p).toBe(401);
      expect((await (await as(world.users.dm)).get(p)).status, p).toBe(200);
    }
  });

  it('CSV: UTF-8 BOM, Hindi headers, same columns as the Excel, formula text neutralised', async () => {
    const res = await (await as(world.users.dm)).get('/api/reports/candidates.csv');
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.startsWith('﻿')).toBe(true);
    const header = res.text.slice(1).split('\r\n')[0];
    expect(header).toBe(CANDIDATE_LIST_HEADERS.map((h) => `"${h}"`).join(','));
    expect(res.text).toContain('सीमा देवी');
    expect(res.text).toContain(`"'${HYPERLINK.replaceAll('"', '""')}"`);
  });

  it('Excel: flat sheet, bold frozen header, autofilter, numbers stored as numbers', async () => {
    const { sheet, rows } = await xlsxRows();
    expect(sheet.getRow(1).values).toEqual([undefined, ...CANDIDATE_LIST_HEADERS]);
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.model.merges).toHaveLength(0);
    // NOTA is never listed.
    expect(rows.every((r) => r[5] !== 'नोटा')).toBe(true);
    for (const r of rows) {
      for (const i of [0, 3, 4]) expect(typeof r[i]).toBe('number');
    }
    expect(rows.map((r) => r[0])).toEqual(rows.map((_, i) => i + 1));
  });

  it('sorting: PS name, PS before ZP, ward number numerically, then ballot position', async () => {
    const { rows } = await xlsxRows();
    const churu = rows.filter((r) => r[2] === 'पंचायत समिति चूरू');
    const wardNos = churu.map((r) => r[3] as number);
    expect(wardNos).toEqual([...wardNos].sort((a, b) => a - b));
    expect(wardNos.indexOf(10)).toBeGreaterThan(wardNos.indexOf(9)); // 10 after 9, not after 1
    const first = churu.filter((r) => r[3] === 1);
    expect(first.map((r) => r[4])).toEqual([1, 2]);
    const kinds = rows.map((r) => r[1]);
    expect(kinds.lastIndexOf('पंचायत समिति')).toBeLessThan(kinds.indexOf('जिला परिषद'));
    const names = rows.map((r) => r[2]);
    expect(names.indexOf('पंचायत समिति चूरू')).toBeLessThan(names.indexOf('पंचायत समिति राजगढ़'));
    const zp = rows.filter((r) => r[1] === 'जिला परिषद');
    expect(zp.map((r) => r[5])).toEqual(['सरला', 'प्रकाश']);
    expect(zp[0]?.[2]).toBe('ज़िला परिषद');
  });

  it('Hindi, votes, result and list status are right', async () => {
    const { rows } = await xlsxRows();
    const by = (name: string) => rows.find((r) => r[5] === name);
    // declared ward: 500 vs 400 + 10 NOTA = 910 valid
    expect(by('सीमा देवी')).toMatchObject({ 6: 'पहला दल', 7: 'चिह्न', 8: 'महिला', 9: 'महिला' });
    expect(by('सीमा देवी')?.slice(10)).toEqual([500, 0, 910, 'विजयी', 'लॉक']);
    expect(by(HYPERLINK)?.slice(10, 14)).toEqual([400, 0, 910, 'पराजित']);
    // never entered: 0 votes, not declared
    expect(by('अनिल')?.slice(10, 14)).toEqual([0, 0, 0, 'घोषित नहीं']);
    // unopposed: the engine's UNOPPOSED winner, votes as the engine has them (no entries)
    expect(by('गीता')?.slice(10, 14)).toEqual([0, 0, 0, 'निर्विरोध विजयी']);
    // independent candidate: no party symbol
    expect(by('कमला')?.slice(6, 8)).toEqual(['निर्दलीय', null]);
    // engine refused the ward's data: no vote number is invented
    expect(by('अजय')?.slice(10, 14)).toEqual([null, null, null, 'घोषित नहीं']);
  });

  it('list status: locked -> ready -> in progress', async () => {
    const id = world.w.close1pct?.id ?? 0;
    await migrator.execute(
      `UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL,
              candidates_ready_at = NOW(3),
              candidates_ready_by = (SELECT id FROM users WHERE username = ?) WHERE id = ?`,
      [world.users.ro1, id],
    );
    expect((await xlsxRows()).rows.find((r) => r[5] === 'मोहन')?.[14]).toBe('तैयार');
    await migrator.execute(
      'UPDATE ward SET candidates_ready_at = NULL, candidates_ready_by = NULL WHERE id = ?',
      [id],
    );
    expect((await xlsxRows()).rows.find((r) => r[5] === 'मोहन')?.[14]).toBe('प्रक्रिया में');
  });

  it('postal: मिले वोट = booth + postal, डाक मतपत्र on its own; every row equals the result engine', async () => {
    const pl = world.w.ps2Lead;
    if (!pl) throw new Error('ps2Lead');
    const ro2 = await declareClient(world.app, world.users.ro2);
    const res = await ro2.post(`/wards/${pl.id}/postal`, {
      sheetTotal: 11,
      votes: [
        { candidateId: pl.A, votes: 7 },
        { candidateId: pl.B, votes: 3 },
        { candidateId: pl.NOTA, votes: 1 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const { rows } = await xlsxRows();
    // booth 50 / 40 / NOTA 0 + postal 7 / 3 / 1
    expect(rows.find((r) => r[5] === 'रेखा')?.slice(10, 13)).toEqual([57, 7, 101]);
    expect(rows.find((r) => r[5] === 'मनोज')?.slice(10, 13)).toEqual([43, 3, 101]);
    // No sum of its own: each number is the engine's.
    const raw = await readReportData(pool);
    for (const [wardId, result] of raw.results) {
      if (result === 'UNAVAILABLE') continue;
      for (const c of result.candidates.filter((x) => !x.isNota)) {
        const row = rows.find((r) => r[5] === c.nameHindi && r[4] === c.ballotPosition);
        expect(row?.slice(10, 13), `ward ${String(wardId)} ${c.nameHindi}`).toEqual([
          c.totalVotes,
          c.postalVotes,
          result.totalValidVotes,
        ]);
      }
    }
  });
});
