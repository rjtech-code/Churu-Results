// Rate limits. In-memory counters: correct for ONE Node process (our deployment). Several processes
// or servers would each count separately and would need a shared store (see README).
//
// COUNTING DAY: the whole venue — 13 PS ROs, the ZP RO, the DM, the observers and the TVs — sits
// behind ONE public IP. A limit counted per IP would therefore be shared by everybody, and one
// officer mistyping would spend it for the rest. So every limit that protects a PERSON is counted
// per person (username at login, user id afterwards), and the per-IP limits are flood ceilings
// only: high enough that normal work never reaches them, low enough to stop a runaway loop.
import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { RateLimitConfig } from '../config/app-config.js';

/**
 * The four limiters, each with the error code it answers with. WHICH one fired decides what to do
 * about it on counting day, so it is in the log line AND in the response:
 *   login-per-user  one officer's failed logins  -> the DM's "RO लॉगिन खोलें" clears it
 *   login-per-ip    the venue's login ceiling    -> an app restart (or a higher limit) clears it
 *   api-per-user    one officer's own requests   -> the DM's "RO लॉगिन खोलें" clears it
 *   api-per-ip      the venue's request ceiling  -> an app restart (or a higher limit) clears it
 */
export const LIMITER_CODES = {
  'login-per-user': 'TOO_MANY_LOGIN_ATTEMPTS',
  'login-per-ip': 'TOO_MANY_LOGIN_ATTEMPTS_HERE',
  'api-per-user': 'TOO_MANY_REQUESTS',
  'api-per-ip': 'TOO_MANY_REQUESTS_HERE',
} as const;
export type LimiterName = keyof typeof LIMITER_CODES;

/** What a refusal logs and answers with. The key is a username or a user id — never a password. */
function refuse(name: LimiterName, keyOf: (req: Request) => string) {
  return (req: Request, res: Response): void => {
    console.warn(
      `[rate-limit] ${name} limit reached for ${keyOf(req)} on ${req.method} ${req.path}`,
    );
    res
      .status(429)
      .set('Cache-Control', 'no-store')
      .json({ error: LIMITER_CODES[name], limiter: name });
  };
}

const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;

/** The counter key of one officer's dashboard requests (api-per-user). */
export const apiKeyFor = (userId: number): string => `user:${String(userId)}`;

/** The counter key of one officer's failed logins (login-per-user). */
export const loginKeyFor = (username: string): string =>
  `login:${username.trim().toLowerCase().slice(0, 60)}`;

function limiter(
  name: LimiterName,
  config: RateLimitConfig,
  keyOf: (req: Request) => string,
  options: { skip?: (req: Request) => boolean; failuresOnly?: boolean } = {},
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyOf,
    ...(options.skip ? { skip: options.skip } : {}),
    ...(options.failuresOnly === true ? { skipSuccessfulRequests: true } : {}),
    handler: refuse(name, keyOf),
  });
}

/** The venue's flood ceiling for all /api traffic together. Runs before sessions and before JSON. */
export function apiIpRateLimit(config: RateLimitConfig): RequestHandler {
  return limiter('api-per-ip', config, ipKey, {
    skip: (req) => req.path === '/health' || req.path.startsWith('/health/'),
  });
}

/**
 * One logged-in officer's own budget for the dashboard. Runs AFTER the session is loaded, so it can
 * count per user id; a request with no user yet (login page, /api/auth/me) counts per IP.
 */
export function apiUserRateLimit(config: RateLimitConfig): RateLimitRequestHandler {
  return limiter('api-per-user', config, (req) =>
    req.user === undefined ? ipKey(req) : apiKeyFor(req.user.id),
  );
}

/** The username a login request is for, as the counter sees it (never the password). */
export function loginKeyOf(req: Request): string {
  const body: unknown = req.body;
  const username =
    typeof body === 'object' && body !== null && 'username' in body
      ? (body as { username?: unknown }).username
      : null;
  return typeof username === 'string' && username.trim() !== ''
    ? loginKeyFor(username)
    : ipKey(req);
}

/**
 * FAILED login attempts of ONE officer. A login that works does not count: on counting day an
 * officer may sign in several times for honest reasons (an idle session expired, the browser was
 * closed, they moved to another device), and none of that should spend their allowance. The
 * per-account lockout (5 wrong passwords = 15 minutes, in the database) is still the real
 * brute-force defence; this only stops one username being hammered after it is already locked.
 */
export function loginUserRateLimit(config: RateLimitConfig): RateLimitRequestHandler {
  return limiter('login-per-user', config, loginKeyOf, { failuresOnly: true });
}

/** Login attempts from one address, for everyone on it together: a flood ceiling. */
export function loginIpRateLimit(config: RateLimitConfig): RequestHandler {
  return limiter('login-per-ip', config, ipKey);
}

/**
 * The two counters that belong to ONE officer, so the DM's "RO लॉगिन खोलें" can clear them with the
 * database lock it already clears. Without this the button would look like it worked and the
 * officer would keep getting 429 until the window ran out.
 *
 * The per-IP ceilings are deliberately NOT here: they belong to the whole venue, not to a person,
 * and clearing them from one officer's unlock would hide a flood.
 */
export interface UserLimitCounters {
  clearForUser: (username: string, userId: number) => void;
}

export function userLimitCounters(
  loginPerUser: RateLimitRequestHandler,
  apiPerUser: RateLimitRequestHandler,
): UserLimitCounters {
  return {
    clearForUser: (username, userId) => {
      loginPerUser.resetKey(loginKeyFor(username));
      apiPerUser.resetKey(apiKeyFor(userId));
    },
  };
}
