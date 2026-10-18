// /api/ward-forms: who may download which ward's forms, refusals, the audit row and the PDFs.
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';
import { pageCount } from './source.js';
import { USERS, agentFor, buildFormsWorld, exportAudits, getForm } from './world.js';
import type { FormsWorld } from './world.js';

let pool: Pool;
let migrator: Pool;
let fw: FormsWorld;

beforeAll(async () => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
  await resetData(migrator);
  fw = await buildFormsWorld(pool);
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});

type Agent = Awaited<ReturnType<typeof agentFor>>;
const agents = new Map<keyof typeof USERS, Agent>();
/** One login per user for the whole file (many logins would hit the login rate limit). */
async function as(user: keyof typeof USERS): Promise<Agent> {
  const known = agents.get(user);
  if (known !== undefined) return known;
  const agent = await agentFor(fw.app, USERS[user]);
  agents.set(user, agent);
  return agent;
}
const part2 = (wardId: number) => `/api/ward-forms/${String(wardId)}/part2.pdf`;
const prarup7 = (wardId: number) => `/api/ward-forms/${String(wardId)}/prarup7.pdf`;

describe('access', () => {
  it('logged out: 401', async () => {
    const res = await getForm(request.agent(fw.app), part2(fw.w.psW1));
    expect(res.status).toBe(401);
  });

  it('the ward’s own RO and the DM may download; nobody else (403)', async () => {
    const { psW1, zW1 } = fw.w;
    const cases: [keyof typeof USERS, string, number][] = [
      ['dm', part2(psW1), 200],
      ['dm', part2(zW1), 200],
      ['dm', prarup7(zW1), 200],
      ['dm', prarup7(psW1), 200],
      ['ro1', part2(psW1), 200],
      ['ro1', prarup7(psW1), 200],
      ['zp', part2(zW1), 200],
      ['zp', prarup7(zW1), 200],
      ['ro2', part2(psW1), 403], // another PS's ward
      ['ro2', prarup7(psW1), 403],
      ['ro1', part2(zW1), 403], // a PS_RO never gets ZP ward forms
      ['ro1', prarup7(zW1), 403],
      ['zp', part2(psW1), 403], // a ZP_RO never gets PS ward forms
      ['zp', prarup7(psW1), 403],
    ];
    for (const [user, path, status] of cases) {
      const res = await getForm(await as(user), path);
      expect([user, path, res.status]).toEqual([user, path, status]);
    }
  });

  it('an unknown ward is 404; a bad id or a query string is 400', async () => {
    const dm = await as('dm');
    expect((await getForm(dm, part2(999999))).status).toBe(404);
    expect((await getForm(dm, '/api/ward-forms/abc/part2.pdf')).status).toBe(400);
    expect((await getForm(dm, `${part2(fw.w.psW1)}?x=1`)).status).toBe(400);
  });
});

describe('refusals', () => {
  it('an undeclared ward: 409 NOT_DECLARED, and nothing is audited', async () => {
    const before = (await exportAudits(pool)).length;
    const res = await getForm(await as('ro2'), part2(fw.w.psW2));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'NOT_DECLARED' });
    expect(await exportAudits(pool)).toHaveLength(before);
  });

  it('an uncontested ward has no Part-II, but has Prarup-7 (a PS ward too)', async () => {
    const ro1 = await as('ro1');
    expect((await getForm(ro1, part2(fw.w.psW3))).body).toEqual({ error: 'WARD_UNOPPOSED' });
    const ps = await getForm(ro1, prarup7(fw.w.psW3));
    expect(ps.status).toBe(200);
    expect(pageCount(ps.body as Buffer)).toBe(1);
  });

  it('the availability read gives the same answers (for the buttons)', async () => {
    const dm = await as('dm');
    expect((await getForm(dm, `/api/ward-forms/${String(fw.w.zW1)}`)).body).toEqual({
      forms: {
        part2: { available: true, reason: null },
        prarup7: { available: true, reason: null },
      },
    });
    expect((await getForm(dm, `/api/ward-forms/${String(fw.w.psW1)}`)).body).toEqual({
      forms: {
        part2: { available: true, reason: null },
        prarup7: { available: true, reason: null },
      },
    });
    expect((await getForm(dm, `/api/ward-forms/${String(fw.w.psW2)}`)).body).toEqual({
      forms: {
        part2: { available: false, reason: 'NOT_DECLARED' },
        prarup7: { available: false, reason: 'NOT_DECLARED' },
      },
    });
  });
});

describe('downloads', () => {
  it.each([
    ['part2', 'Part-II'],
    ['prarup7', 'Prarup-7'],
  ])('%s: a one-page PDF, not cached, audited with section and ward id', async (form, stem) => {
    const before = (await exportAudits(pool)).length;
    const res = await getForm(await as('zp'), `/api/ward-forms/${String(fw.w.zW1)}/${form}.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${stem}_ZP-ward-1_${String(fw.w.zW1)}.pdf"`,
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);

    const audits = await exportAudits(pool);
    expect(audits).toHaveLength(before + 1);
    expect(audits.at(-1)).toEqual({
      userId: fw.w.users.zp,
      entity: 'ward',
      entityId: fw.w.zW1,
      newValue: {
        section: `ward-form-${form}`,
        format: 'pdf',
        ward_id: fw.w.zW1,
        declaration_version: 1,
      },
    });
  });
});

describe('Prarup-7 of a PS ward', () => {
  it('its own PS_RO gets a one-page PDF, audited like the ZP form', async () => {
    const before = (await exportAudits(pool)).length;
    const res = await getForm(await as('ro1'), prarup7(fw.w.psW1));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Prarup-7_PS-ward-1_${String(fw.w.psW1)}.pdf"`,
    );
    expect(pageCount(res.body as Buffer)).toBe(1);
    const audits = await exportAudits(pool);
    expect(audits).toHaveLength(before + 1);
    expect(audits.at(-1)).toMatchObject({
      userId: fw.w.users.ro1,
      entityId: fw.w.psW1,
      newValue: { section: 'ward-form-prarup7', ward_id: fw.w.psW1, declaration_version: 1 },
    });
  });
});
