import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, request } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

export const STATE_DIR = resolve(import.meta.dirname, '.state');
export const WORLD_FILE = resolve(STATE_DIR, 'world.json');
/** Browser storage of the Churu PS RO, logged in once in global setup (keeps logins under the rate limit). */
export const RO_STATE = resolve(STATE_DIR, 'ro.json');
const BACKEND = resolve(import.meta.dirname, '../../backend');

export interface E2eWard {
  id: number;
  wardNo: number;
  booths: Record<string, number>;
  candidates: { A: number; B: number; NOTA: number };
  extraCandidates: number[];
  entries: Record<string, number>;
  postalEntry: number | null;
}
export interface E2eWorld {
  password: string;
  users: { ro: string; roOther: string; zp: string; dm: string };
  wards: Record<'entry' | 'edit' | 'postal' | 'ready' | 'tie' | 'nota' | 'correction' | 'wide', E2eWard>;
  otherPsWard: number;
  screens: {
    psName: string;
    roSardar: string;
    live: {
      wardId: number;
      wardNo: number;
      boothId: number;
      candidates: { A: number; B: number; NOTA: number };
    };
    declaredWardNo: number;
    correctedWardNo: number;
    unopposedWardNo: number;
    lottery: { wardNo: number; winnerId: number; loserId: number };
    zpReady: { wardId: number; wardNo: number };
  };
}

let cached: E2eWorld | undefined;
/** Written by global setup (read lazily: test files are loaded before global setup runs). */
export function world(): E2eWorld {
  cached ??= JSON.parse(readFileSync(WORLD_FILE, 'utf8')) as E2eWorld;
  return cached;
}

/** Runs a backend e2e-support script (tsx, churu_test only). */
export function backendScript(script: string, args: string[]): string {
  return execFileSync('npx', ['tsx', `tests/e2e-support/${script}`, ...args], {
    cwd: BACKEND,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
}

declare global {
  interface Window {
    __cspViolation?: (text: string) => void;
  }
}

/** Every test fails if the page reports any Content-Security-Policy violation. */
export const test = base.extend<{ cspGuard: undefined }>({
  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (msg) => {
        if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(msg.text()))
          violations.push(msg.text());
      });
      await page.exposeFunction('__cspViolation', (text: string) => violations.push(text));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolation?.(`${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      await use(undefined);
      expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function loginUi(page: Page, username: string, password = world().password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('यूज़रनेम').fill(username);
  await page.getByLabel('पासवर्ड').fill(password);
  await page.getByRole('button', { name: 'लॉगिन करें' }).click();
}

/** An API client sharing the RO's browser session (to change data "in the background"). */
export async function roApi(): Promise<{ ctx: APIRequestContext; token: string }> {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3199', storageState: RO_STATE });
  const res = await ctx.get('/api/auth/csrf');
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return { ctx, token: csrfToken };
}

/** Types a whole sheet with the keyboard: A, B, NOTA, total (Enter between fields). */
export async function typeSheet(page: Page, votes: [number, number, number], total: number): Promise<void> {
  await page.getByLabel('अमर सिंह के मत').fill(String(votes[0]));
  await page.getByLabel('भरत कुमार के मत').fill(String(votes[1]));
  await page.getByLabel('नोटा के मत').fill(String(votes[2]));
  await page.getByLabel('कुल योग (पर्ची के अनुसार)').fill(String(total));
}

/** Picks a standard reason and (optionally) types the details. */
export async function giveReason(page: Page, label: string, choice: string, details = ''): Promise<void> {
  await page.getByLabel(label, { exact: true }).selectOption(choice);
  if (details !== '') await page.getByRole('textbox', { name: /^विवरण/ }).fill(details);
}

/** A fresh API client logged in as `username` (for changes the screens must pick up). */
export async function apiLogin(username: string): Promise<{
  post: (path: string, body: object) => Promise<Record<string, unknown>>;
  dispose: () => Promise<void>;
}> {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3199' });
  const csrf = async () =>
    ((await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string }).csrfToken;
  const login = await ctx.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': await csrf() },
    data: { username, password: world().password },
  });
  if (login.status() !== 200) throw new Error(`login ${username}: ${login.status()}`);
  const token = await csrf();
  return {
    post: async (path, body) => {
      const res = await ctx.post(path, { headers: { 'X-CSRF-Token': token }, data: body });
      if (res.status() !== 200 && res.status() !== 201)
        throw new Error(`${path}: ${res.status()} ${await res.text()}`);
      return (await res.json()) as Record<string, unknown>;
    },
    dispose: () => ctx.dispose(),
  };
}

/** Runs a backend npm-script file (tsx) against churu_test, e.g. scripts/ps-set-hindi-names.ts. */
export function backendTool(file: string, args: string[]): string {
  return execFileSync('npx', ['tsx', file, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DB_NAME: 'churu_test', NODE_ENV: 'test' },
    encoding: 'utf8',
  });
}
