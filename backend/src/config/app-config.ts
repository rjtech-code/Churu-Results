import { resolve } from 'node:path';
import { findFrontendDist } from '../modules/frontend/static.js';
import type { AppEnv } from './env.js';

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/** Everything createApp() needs besides the DB pool. Built from env in server.ts; tests build their own. */
export interface AppConfig {
  production: boolean;
  sessionSecret: string;
  appOrigin: string;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  trustProxy: false | 'loopback' | number;
  loginRateLimit: RateLimitConfig;
  apiRateLimit: RateLimitConfig;
  /** true: a booth without a registered-voter count cannot be entered (409 VOTER_COUNT_MISSING).
   *  false: it can, with a VOTER_COUNT_MISSING warning in the response. */
  requireVoterCounts: boolean;
  publicApi: PublicApiConfig;
  /** Folder with the built dashboard (index.html), or null to serve the API only. */
  frontendDist: string | null;
}

/** Public media-room screens (Part 7). */
export interface PublicApiConfig {
  rateLimit: RateLimitConfig;
  sseMaxConnections: number;
  sseHeartbeatMs: number;
  /** Collect ward changes for this long before rebuilding. */
  debounceMs: number;
  /** Never publish two snapshots closer together than this. */
  minSnapshotIntervalMs: number;
  /** Rebuild anyway this often (catches changes made by CLI scripts). */
  safetyRebuildMs: number;
  /** How often to check whether the screen layout setting changed. */
  layoutPollMs: number;
}

export const COUNTING_DATE = '2026-11-20';

export function defaultPublicApiConfig(overrides: Partial<PublicApiConfig> = {}): PublicApiConfig {
  return {
    rateLimit: { limit: 3000, windowMs: 60_000 },
    sseMaxConnections: 50,
    sseHeartbeatMs: 15_000,
    debounceMs: 500,
    minSnapshotIntervalMs: 2000,
    safetyRebuildMs: 60_000,
    layoutPollMs: 2000,
    ...overrides,
  };
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 15 * 60_000 };
export const API_RATE_LIMIT: RateLimitConfig = { limit: 600, windowMs: 60_000 };

export function appConfigFromEnv(env: AppEnv): AppConfig {
  return {
    production: env.NODE_ENV === 'production',
    sessionSecret: env.SESSION_SECRET,
    appOrigin: env.APP_ORIGIN,
    sessionIdleMs: env.SESSION_IDLE_MINUTES * 60_000,
    sessionAbsoluteMs: env.SESSION_ABSOLUTE_HOURS * 3_600_000,
    trustProxy: env.TRUST_PROXY,
    loginRateLimit: LOGIN_RATE_LIMIT,
    apiRateLimit: API_RATE_LIMIT,
    requireVoterCounts: env.REQUIRE_VOTER_COUNTS ?? env.NODE_ENV === 'production',
    publicApi: defaultPublicApiConfig({
      rateLimit: { limit: env.PUBLIC_RATE_LIMIT_PER_MIN, windowMs: 60_000 },
      sseMaxConnections: env.SSE_MAX_CONNECTIONS,
      minSnapshotIntervalMs: env.PUBLIC_MIN_SNAPSHOT_INTERVAL_MS,
    }),
    frontendDist: findFrontendDist(resolve(process.cwd(), env.FRONTEND_DIST)),
  };
}
