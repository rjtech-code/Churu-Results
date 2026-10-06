import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimitConfig } from '../config/app-config.js';

// In-memory counters: correct for ONE Node process (our deployment). Several processes or servers
// would each count separately and would need a shared store (see README).

function limiter(config: RateLimitConfig, skip?: (path: string) => boolean): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(skip ? { skip: (req) => skip(req.path) } : {}),
    handler: (_req, res) => {
      res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    },
  });
}

/** Generous per-IP limit for all /api routes, so a bug or loop cannot flood the server. */
export function apiRateLimit(config: RateLimitConfig): RequestHandler {
  return limiter(config, (path) => path === '/health' || path.startsWith('/health/'));
}

/** Login attempts per IP. Counts every attempt (also invalid bodies); per-account lockout is the main defence. */
export function loginRateLimit(config: RateLimitConfig): RequestHandler {
  return limiter(config);
}
