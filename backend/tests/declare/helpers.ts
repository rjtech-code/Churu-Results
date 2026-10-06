import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Response } from 'supertest';
import type { AppConfig } from '../../src/config/app-config.js';
import type { WardResult } from '../../src/services/result.js';
import { PASSWORD, clientFor, countingApp, psW1Sheet, v } from '../counting/helpers.js';
import type { Client, World } from '../counting/helpers.js';

export { PASSWORD };

/** psW1 vote plan per booth: [A, B, NOTA] for b1, b2, b4 and postal. */
export interface WardVotes {
  b1: [number, number, number];
  b2: [number, number, number];
  b4: [number, number, number];
  postal: [number, number, number];
}

/** A = 330, B = 210, NOTA = 13 (A wins by 120). */
export const A_WINS: WardVotes = {
  b1: [300, 200, 10],
  b2: [20, 5, 1],
  b4: [5, 5, 1],
  postal: [5, 0, 1],
};

export interface FilledWard {
  entries: { b1: number; b2: number; b4: number; postal: number };
}

/** Enters every booth of psW1 and its postal sheet through the Part 5 API. */
export async function fillPsW1(
  ro: Client,
  w: World,
  votes: WardVotes = A_WINS,
): Promise<FilledWard> {
  const ids: Record<string, number> = {};
  for (const booth of ['b1', 'b2', 'b4'] as const) {
    const [a, b, n] = votes[booth];
    const res = await ro.post('/entries', psW1Sheet(w, w[booth], a, b, n));
    if (res.status !== 201)
      throw new Error(`fill ${booth}: ${res.status} ${JSON.stringify(res.body)}`);
    ids[booth] = (res.body as { entry: { id: number } }).entry.id;
  }
  const [a, b, n] = votes.postal;
  const res = await ro.post(`/wards/${w.psW1}/postal`, {
    sheetTotal: a + b + n,
    votes: v([
      [w.c.A, a],
      [w.c.B, b],
      [w.c.N1, n],
    ]),
  });
  if (res.status !== 201) throw new Error(`fill postal: ${res.status}`);
  ids.postal = (res.body as { entry: { id: number } }).entry.id;
  return {
    entries: { b1: ids.b1 ?? 0, b2: ids.b2 ?? 0, b4: ids.b4 ?? 0, postal: ids.postal },
  };
}

/** A client for /api/declare (same login as counting). */
export interface DeclareClient extends Client {
  dpost(path: string, body?: unknown): Promise<Response>;
  dget(path: string): Promise<Response>;
}

export async function declareClient(app: Express, username: string): Promise<DeclareClient> {
  const c = await clientFor(app, username);
  return {
    ...c,
    dpost: (path, body = {}) =>
      c.agent
        .post(`/api/declare${path}`)
        .set('X-CSRF-Token', c.token)
        .send(body as object),
    dget: (path) => c.agent.get(`/api/declare${path}`),
  };
}

export function appFor(pool: Pool, overrides: Partial<AppConfig> = {}): Express {
  return countingApp(pool, overrides);
}

/** A declare body confirming what the preview shows. */
export function confirmBody(result: WardResult, extra: Record<string, unknown> = {}) {
  return {
    password: PASSWORD,
    confirmWinnerCandidateId: result.leader?.candidateId,
    confirmTotalValidVotes: result.totalValidVotes,
    ...extra,
  };
}

export async function previewResult(c: DeclareClient, wardId: number): Promise<WardResult> {
  const res = await c.dpost(`/wards/${wardId}/preview`, {});
  if (res.status !== 200) throw new Error(`preview: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { result: WardResult }).result;
}
