import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { RO_STATE, STATE_DIR, WORLD_FILE, backendScript, world } from './support';

// Runs after the web server is up: fresh e2e data in churu_test, then one stored RO login.
export default async function globalSetup(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });
  process.stdout.write(backendScript('seed-e2e.ts', [WORLD_FILE]));
  const seededAt = Date.now();
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await ctx.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { username: world().users.ro, password: world().password },
  });
  if (res.status() !== 200) throw new Error(`global setup login failed: ${res.status()}`);
  await ctx.storageState({ path: RO_STATE });
  // The seed writes the screen layout last; wait for a public snapshot generated AFTER the seed
  // finished (the layout poll rebuilds within ~2 s), so the TV screens show the finished data.
  for (let i = 0; ; i++) {
    const meta = (await (await ctx.get('/api/public/meta')).json()) as { generatedAt?: string };
    if (meta.generatedAt !== undefined && Date.parse(meta.generatedAt) > seededAt) break;
    if (i > 40) throw new Error('global setup: public snapshot did not pick up the e2e data');
    await new Promise((r) => setTimeout(r, 500));
  }
  await ctx.dispose();
}
