import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { RO_STATE, STATE_DIR, WORLD_FILE, backendScript, world } from './support';

// Runs after the web server is up: fresh e2e data in churu_test, then one stored RO login.
export default async function globalSetup(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });
  process.stdout.write(backendScript('seed-e2e.ts', [WORLD_FILE]));
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await ctx.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { username: world().users.ro, password: world().password },
  });
  if (res.status() !== 200) throw new Error(`global setup login failed: ${res.status()}`);
  await ctx.storageState({ path: RO_STATE });
  await ctx.dispose();
}
