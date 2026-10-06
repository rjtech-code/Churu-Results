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
  };
}
