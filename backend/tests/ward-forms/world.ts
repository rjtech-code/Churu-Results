// The counting test district (counting/helpers.ts buildWorld) with its wards declared through the
// real counting/declare API, for the ward-form endpoints:
//   psW1 (PS 1) declared, A wins     psW2 (PS 2) not declared     psW3 (PS 1) uncontested
//   zW1  (ZP, booths of both PS) declared, E wins, rejected postal 2, E with every detail
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import type { Response } from 'supertest';
import { login } from '../auth/helpers.js';
import { PASSWORD, buildWorld, countingApp, v, zW1Sheet } from '../counting/helpers.js';
import type { World } from '../counting/helpers.js';
import { confirmBody, declareClient, fillPsW1, previewResult } from '../declare/helpers.js';
import type { DeclareClient, FilledWard } from '../declare/helpers.js';

export const USERS = { ro1: 'ro_ps1_x1', ro2: 'ro_ps2_x2', zp: 'zp_ro_x3', dm: 'dm_x4' } as const;
export const ZP_RESERVATION = 'सामान्य महिला';
export const E_DETAILS = {
  address: 'ग्राम पोस्ट- साण्डन, तह.- सुजानगढ़',
  occupation: 'कृषि',
  education: 'GRADUATE',
  age: 45,
  category: 'GEN',
} as const;

export interface FormsWorld {
  w: World;
  app: Express;
  psFilled: FilledWard;
}

async function declare(c: DeclareClient, wardId: number): Promise<void> {
  const res = await c.dpost(`/wards/${wardId}`, confirmBody(await previewResult(c, wardId)));
  if (res.status !== 201)
    throw new Error(`declare ${wardId}: ${res.status} ${JSON.stringify(res.body)}`);
}

async function fillZW1(zp: DeclareClient, w: World): Promise<void> {
  for (const booth of [w.b1, w.b2, w.b3, w.b4, w.b5, w.b6]) {
    const res = await zp.post('/entries', zW1Sheet(w, booth));
    if (res.status !== 201)
      throw new Error(`zW1 booth ${booth}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const res = await zp.post(`/wards/${w.zW1}/postal`, {
    sheetTotal: 3,
    rejectedCount: 2,
    votes: v([
      [w.c.E, 2],
      [w.c.F, 1],
      [w.c.N3, 0],
    ]),
  });
  if (res.status !== 201) throw new Error(`zW1 postal: ${res.status}`);
}

export async function buildFormsWorld(pool: Pool): Promise<FormsWorld> {
  const w = await buildWorld(pool);
  const app = countingApp(pool);
  await pool.execute(
    `UPDATE candidate SET gender = 'F', address = ?, occupation = ?, education = ?, age_stated = ?,
            candidate_category = ? WHERE id = ?`,
    [
      E_DETAILS.address,
      E_DETAILS.occupation,
      E_DETAILS.education,
      E_DETAILS.age,
      E_DETAILS.category,
      w.c.E,
    ],
  );
  await pool.execute('UPDATE ward SET reservation_category = ? WHERE id = ?', [
    ZP_RESERVATION,
    w.zW1,
  ]);
  const ro = await declareClient(app, USERS.ro1);
  const psFilled = await fillPsW1(ro, w);
  await declare(ro, w.psW1);
  const zp = await declareClient(app, USERS.zp);
  await fillZW1(zp, w);
  await declare(zp, w.zW1);
  return { w, app, psFilled };
}

/** A logged-in agent for GET requests. */
export async function agentFor(app: Express, username: string) {
  const agent = request.agent(app);
  const res = await login(agent, username, PASSWORD);
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return agent;
}

/** GET with the body kept as bytes (PDF) or parsed JSON (errors). */
export function getForm(agent: ReturnType<typeof request.agent>, path: string): Promise<Response> {
  return agent
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const json = String(res.headers['content-type']).includes('json');
        cb(null, json ? (JSON.parse(body.toString('utf8')) as unknown) : body);
      });
    });
}

/** REPORT_EXPORTED rows (ids as numbers: entity_id is a BIGINT). */
export async function exportAudits(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT user_id, entity, entity_id, new_value FROM audit_log WHERE action = 'REPORT_EXPORTED' ORDER BY id",
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    entity: String(r.entity),
    entityId: Number(r.entity_id),
    newValue: r.new_value as unknown,
  }));
}
