// Super Admin "मतगणना डेटा download": one .zip with the four CSVs and a README, built from the same
// read service the DM's reports use — so the numbers in the file equal the numbers on the screen.
// Read only (it changes nothing and is allowed even while the counting lock is ON), SUPER_ADMIN
// only, and audited like the other exports.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import JSZip from 'jszip';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_FILES } from '../../src/services/setup/counting-export.js';
import { createUser } from '../auth/helpers.js';
import { PASSWORD, apiClient, buildAdminWorld } from '../admin/helpers.js';
import type { AdminWorld, ApiClient } from '../admin/helpers.js';
import { assignZpPostal, countingApp, zW1Sheet } from '../counting/helpers.js';
import { A_WINS, confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData, testEnv } from '../helpers/db.js';
import { getForm } from '../ward-forms/world.js';

const SA = 'super_admin_e1';
const SA_PASSWORD = 'Super-Admin-Pass-3';
const URL = '/api/superadmin/counting-data/export.zip';
const VOID_REASON = 'Entered on the wrong booth sheet';

let pool: Pool;
let migrator: Pool;
let backupDir: string;
let app: Express;
let w: AdminWorld;
let sa: ApiClient;

async function n(sql: string, params: (string | number)[] = []): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  backupDir = await mkdtemp(join(tmpdir(), 'churu-backups-export-'));
  app = countingApp(pool, {
    loginRateLimit: { limit: 10_000, windowMs: 60_000 },
    setup: {
      backupDir,
      nodeEnv: 'test',
      migrationDb: {
        host: testEnv.DB_HOST,
        port: testEnv.DB_PORT,
        database: testEnv.TEST_DB,
        user: testEnv.DB_MIGRATION_USER,
        password: testEnv.DB_MIGRATION_PASSWORD,
      },
    },
  });
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
  await rm(backupDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetData(migrator);
  await rm(backupDir, { recursive: true, force: true });
  w = await buildAdminWorld(pool);
  await assignZpPostal(pool, w.zW1, w.ps1);
  await createUser(pool, { username: SA, role: 'SUPER_ADMIN', password: SA_PASSWORD });
  sa = await apiClient(app, SA, SA_PASSWORD);
  await mockCounting();
});

/** psW1 fully entered and declared; one ZP booth entry entered and then voided. */
async function mockCounting() {
  const ro = await declareClient(app, 'ro_ps1_x1');
  await fillPsW1(ro, w);
  const dec = await ro.dpost(
    `/wards/${String(w.psW1)}`,
    confirmBody(await previewResult(ro, w.psW1)),
  );
  expect(dec.status).toBe(201);
  const zp = await ro.post('/entries', zW1Sheet(w, w.b1));
  expect(zp.status).toBe(201);
  const zpId = (zp.body as { entry: { id: number } }).entry.id;
  const voided = await ro.post(`/entries/${String(zpId)}/void`, {
    rowVersion: 1,
    reason: VOID_REASON,
  });
  expect(voided.status).toBe(200);
}

// ---------------------------------------------------------------- zip + CSV reading

/** A CSV written by modules/reports/csv.ts: UTF-8 BOM, CRLF rows, every cell quoted. */
function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch ?? '';
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // part of CRLF
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch ?? '';
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface Table {
  headers: string[];
  rows: string[][];
  /** Column value by header name. */
  col(row: string[], header: string): string;
}

function table(rows: string[][]): Table {
  const headers = rows[0] ?? [];
  return {
    headers,
    rows: rows.slice(1),
    col: (row, header) => row[headers.indexOf(header)] ?? '',
  };
}

interface Zip {
  names: string[];
  text(name: string): string;
  csv(name: string): Table;
}

async function download(client: ApiClient = sa): Promise<{ zip: Zip; fileName: string }> {
  const res = await getForm(client.agent, URL);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/zip');
  expect(res.headers['cache-control']).toBe('no-store');
  const archive = await JSZip.loadAsync(res.body as Buffer);
  const files: Record<string, string> = {};
  for (const name of Object.keys(archive.files)) {
    files[name] = await (archive.files[name]?.async('string') ?? Promise.resolve(''));
  }
  const disposition = String(res.headers['content-disposition']);
  return {
    fileName: /filename="([^"]+)"/.exec(disposition)?.[1] ?? '',
    zip: {
      names: Object.keys(files),
      text: (name) => files[name] ?? '',
      csv: (name) => table(parseCsv(files[name] ?? '')),
    },
  };
}

// ---------------------------------------------------------------- tests

describe('the zip and its files', () => {
  it('has exactly the four CSVs and the README, and a dated .zip name', async () => {
    const { zip, fileName } = await download();
    expect(zip.names.sort()).toEqual([...EXPORT_FILES].sort());
    expect(fileName).toMatch(/^churu-counting-data-\d{8}-\d{6}\.zip$/);
  });

  it('each CSV opens in Excel: a BOM, quoted cells and a header row', async () => {
    const { zip } = await download();
    for (const name of ['booth-entries.csv', 'postal-entries.csv']) {
      expect(zip.text(name).startsWith('﻿')).toBe(true);
      expect(zip.text(name)).toContain('"Ward no"');
    }
    expect(zip.csv('booth-entries.csv').headers).toContain('Booth label');
    expect(zip.csv('booth-entries.csv').headers).toContain('Entered by');
    expect(zip.csv('postal-entries.csv').headers).toContain('Sheet total');
    expect(zip.csv('ward-declarations.csv').headers).toContain('Margin');
    expect(zip.csv('voided-entries.csv').headers).toContain('Void reason');
  });

  it('the README names the district, the download time, that it is TEST data, and the ward-by-ward read', async () => {
    const { zip } = await download();
    const readme = zip.text('README.txt');
    expect(readme).toContain('चूरू');
    expect(readme).toMatch(/Downloaded at: \d{4}-\d{2}-\d{2}T[\d:.]+\+05:30/);
    expect(readme).toContain('THIS IS TEST DATA');
    expect(readme).toContain('ward by ward at download time');
    expect(readme).toContain('Download after entry has stopped');
  });
});

describe('the numbers match the reports exactly', () => {
  it('row counts equal what the panel shows next to the button', async () => {
    const ov = (await sa.get('/api/superadmin/overview')).body as {
      countingExport: {
        rows: {
          boothEntries: number;
          postalEntries: number;
          declarations: number;
          voidedEntries: number;
        };
      };
    };
    const { zip } = await download();
    expect(zip.csv('booth-entries.csv').rows).toHaveLength(ov.countingExport.rows.boothEntries);
    expect(zip.csv('postal-entries.csv').rows).toHaveLength(ov.countingExport.rows.postalEntries);
    expect(zip.csv('ward-declarations.csv').rows).toHaveLength(ov.countingExport.rows.declarations);
    expect(zip.csv('voided-entries.csv').rows).toHaveLength(ov.countingExport.rows.voidedEntries);
  });

  it('booth + postal votes per candidate add up to the DM report, candidate by candidate', async () => {
    const dm = await apiClient(app, 'dm_x4');
    const report = (await dm.get(`/api/reports/wards/${String(w.psW1)}`)).body as {
      candidates: {
        name: string;
        isNota: boolean;
        boothVotes: number;
        postalVotes: number;
        totalVotes: number;
      }[];
    };
    const { zip } = await download();
    const booth = zip.csv('booth-entries.csv');
    const postal = zip.csv('postal-entries.csv');
    const sum = (t: Table, name: string) =>
      t.rows
        .filter((r) => t.col(r, 'Candidate name') === name && t.col(r, 'Ward type') === 'PS')
        .reduce((s, r) => s + Number(t.col(r, 'Votes')), 0);

    for (const c of report.candidates.filter((x) => !x.isNota)) {
      expect(sum(booth, c.name), `${c.name} booth`).toBe(c.boothVotes);
      expect(sum(postal, c.name), `${c.name} postal`).toBe(c.postalVotes);
      expect(sum(booth, c.name) + sum(postal, c.name)).toBe(c.totalVotes);
    }
  });

  it('every booth row carries its own NOTA and the sheet total the RO typed', async () => {
    const { zip } = await download();
    const t = zip.csv('booth-entries.csv');
    const rows = t.rows.filter(
      (r) => t.col(r, 'Booth label') === '1' && t.col(r, 'Ward type') === 'PS',
    );
    const [a, b, nota] = A_WINS.b1;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => Number(t.col(r, 'Votes')))).toEqual([a, b]);
    for (const r of rows) {
      expect(Number(t.col(r, 'NOTA'))).toBe(nota);
      expect(Number(t.col(r, 'Sheet total'))).toBe(a + b + nota);
      expect(t.col(r, 'Entered by')).toBe('Full ro_ps1_x1');
      expect(t.col(r, 'Entered at (IST)')).toMatch(/\+05:30$/);
      expect(t.col(r, 'Panchayat Samiti')).not.toBe('');
    }
  });

  it('the declaration row shows the winner and margin the report shows', async () => {
    const dm = await apiClient(app, 'dm_x4');
    const report = (await dm.get(`/api/reports/wards/${String(w.psW1)}`)).body as {
      declarations: { version: number; margin: number; winner: { name: string } }[];
    };
    const { zip } = await download();
    const t = zip.csv('ward-declarations.csv');
    expect(t.rows).toHaveLength(1);
    const row = t.rows[0] ?? [];
    const dec = report.declarations[0];
    expect(t.col(row, 'Winner')).toBe(dec?.winner.name);
    expect(Number(t.col(row, 'Margin'))).toBe(dec?.margin);
    expect(Number(t.col(row, 'Version'))).toBe(1);
    expect(t.col(row, 'Declared by')).not.toBe('');
  });

  it('the voided entry is there with its reason, its votes and who voided it', async () => {
    const { zip } = await download();
    const t = zip.csv('voided-entries.csv');
    expect(t.rows.length).toBeGreaterThan(0);
    for (const row of t.rows) {
      expect(t.col(row, 'Void reason')).toBe(VOID_REASON);
      expect(t.col(row, 'Entry kind')).toBe('BOOTH');
      expect(t.col(row, 'Ballot')).toBe('ZP');
      expect(t.col(row, 'Booth label')).toBe('1');
      expect(t.col(row, 'Voided by')).toBe('Full ro_ps1_x1');
      expect(t.col(row, 'Voided at (IST)')).toMatch(/\+05:30$/);
    }
    // The ZP sheet was E=100, F=50, NOTA=5: the archived votes, names included.
    const votes = t.rows.map((r) => [t.col(r, 'Candidate name'), Number(t.col(r, 'Votes'))]);
    expect(votes).toEqual([
      ['ई', 100],
      ['एफ', 50],
      ['नोटा', 5],
    ]);
  });
});

describe('read only, audited, SUPER_ADMIN only', () => {
  it('changes nothing and still works while the counting lock is ON', async () => {
    expect((await sa.post('/api/superadmin/counting-lock', { on: true })).status).toBe(200);
    const before = {
      boothEntries: await n('SELECT COUNT(*) AS n FROM booth_entry'),
      declarations: await n('SELECT COUNT(*) AS n FROM ward_declarations'),
      voided: await n('SELECT COUNT(*) AS n FROM voided_entry'),
      candidates: await n('SELECT COUNT(*) AS n FROM candidate'),
    };
    const { zip } = await download();
    expect(zip.csv('booth-entries.csv').rows.length).toBeGreaterThan(0);
    expect({
      boothEntries: await n('SELECT COUNT(*) AS n FROM booth_entry'),
      declarations: await n('SELECT COUNT(*) AS n FROM ward_declarations'),
      voided: await n('SELECT COUNT(*) AS n FROM voided_entry'),
      candidates: await n('SELECT COUNT(*) AS n FROM candidate'),
    }).toEqual(before);
    expect(await readdir(backupDir).catch(() => [])).toEqual([]);
  });

  it('one REPORT_EXPORTED audit row per download, with the row counts', async () => {
    await download();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT a.new_value FROM audit_log a JOIN users u ON u.id = a.user_id
        WHERE a.action = 'REPORT_EXPORTED' AND u.username = ? ORDER BY a.id DESC`,
      [SA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.new_value).toMatchObject({
      section: 'counting-data-export',
      format: 'zip',
    });
    await download();
    expect(
      await n(
        `SELECT COUNT(*) AS n FROM audit_log a JOIN users u ON u.id = a.user_id
          WHERE a.action = 'REPORT_EXPORTED' AND u.username = ?`,
        [SA],
      ),
    ).toBe(2);
  });

  it('DM, PS_RO, ZP_RO and OBSERVER get 403; logged out 401', async () => {
    await createUser(pool, { username: 'obs_e1', role: 'OBSERVER', password: PASSWORD });
    for (const user of ['dm_x4', 'ro_ps1_x1', 'zp_ro_x3', 'obs_e1']) {
      const c = await apiClient(app, user);
      expect((await c.get(URL)).status, user).toBe(403);
    }
    expect((await request.agent(app).get(URL)).status).toBe(401);
  });

  it('a reset right after the download still works (the download never blocks it)', async () => {
    await download();
    const res = await sa.post('/api/superadmin/counting-data/reset', {
      password: SA_PASSWORD,
      confirmText: 'RESET',
    });
    expect(res.status).toBe(200);
    // Nothing left to download now: the CSVs keep only their header row.
    const { zip } = await download();
    expect(zip.csv('booth-entries.csv').rows).toEqual([]);
    expect(zip.csv('ward-declarations.csv').rows).toEqual([]);
    expect(zip.text('README.txt')).toContain('THIS IS TEST DATA');
  });
});
