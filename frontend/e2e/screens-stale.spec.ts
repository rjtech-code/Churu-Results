import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from './support';

// Stopping the backend must show the red "old data" banner; starting it again must remove it.
// Playwright's own web server cannot be stopped, so this spec runs its OWN backend (port 3198,
// same churu_test data, same production build).
const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const BACKEND = resolve(import.meta.dirname, '../../backend');

function startServer(): ChildProcess {
  return spawn(resolve(BACKEND, 'node_modules/.bin/tsx'), ['src/server.ts'], {
    cwd: BACKEND,
    detached: true, // own process group: tsx and its node child stop together
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DB_NAME: 'churu_test',
      APP_ORIGIN: BASE,
      FRONTEND_DIST: resolve(import.meta.dirname, '../dist'),
      REQUIRE_VOTER_COUNTS: 'false',
    },
  });
}

async function untilUp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not start');
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  process.kill(-child.pid, 'SIGTERM');
  await exited;
}

test('backend stopped -> red stale banner within ~15 s; started again -> banner gone', async ({ page }) => {
  test.setTimeout(90_000);
  let server = startServer();
  try {
    await untilUp();
    await page.goto(`${BASE}/screen/1?interval=120`);
    await expect(page.getByTestId('page-title')).toHaveText('चूरू');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    const shownTime = await page.locator('.tv-updated').innerText();

    await stopServer(server);
    const banner = page.getByTestId('stale-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('कनेक्शन टूटा — अंतिम अपडेट');
    await expect(banner).toContainText('(पुराना डेटा)');
    await expect(banner).toContainText(shownTime.replace('अंतिम अपडेट ', ''));
    await expect(page.locator('.tv-live')).toContainText('लाइव नहीं');
    await expect(page.locator('article.tv-card').first()).toBeVisible(); // the last data stays

    server = startServer();
    await untilUp();
    await expect(banner).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.tv-live')).toHaveText(/● लाइव$/);
  } finally {
    await stopServer(server);
  }
});
