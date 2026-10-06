import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E runs the PRODUCTION build (npm run build) served by the real backend on the churu_test database.
// The backend refuses nothing here by itself, so the database name is fixed below; the seed and helper
// scripts additionally refuse any database whose name does not end in _test.
export const PORT = 3199;
export const BASE_URL = `http://localhost:${PORT}`;
const backend = resolve(import.meta.dirname, '../backend');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // one shared database
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'hi-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx tsx src/server.ts',
    cwd: backend,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DB_NAME: 'churu_test',
      APP_ORIGIN: BASE_URL,
      FRONTEND_DIST: resolve(import.meta.dirname, 'dist'),
      REQUIRE_VOTER_COUNTS: 'false',
    },
  },
});
