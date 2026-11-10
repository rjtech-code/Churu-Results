// /api/screen-auth — the key popup of the TV screens. Mounted BEFORE sessions (like /api/public):
// a TV never gets a dashboard session. Only POST /unlock exists.
//
// Without a session there is no CSRF token, so instead: the request must carry our own Origin
// header (browsers always send it on a POST fetch), and the body must be JSON (express.json only).
//
// Brute force: two per-IP limiters of their own (separate counters from login, /api and /api/public):
// - failed attempts: SCREEN_ACCESS_DEFAULTS.unlockFailureLimit (10 per 15 min), then 429 until the
//   window ends. Correct keys are not counted. The first refusal of a window writes ONE audit row.
// - all attempts: unlockTotalLimit (100 per 15 min).
// Every wrong key (unknown, revoked, expired, malformed) gets the same 401 WRONG_KEY. The key is
// never logged: errors here are logged without the request body.
import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { ScreenAccess } from './screen-access.js';
import { auditUnlockLockout, unlockWithKey } from './screen-keys.service.js';

const unlockBody = z
  .object({
    key: z.string().max(64),
    /** Which screen asked (audit only). */
    screen: z.enum(['1', '2', '3']).optional(),
  })
  .strict();

function noStore(res: Response): Response {
  return res.set('Cache-Control', 'no-store');
}

export function screenAuthRouter(access: ScreenAccess, appOrigin: string): Router {
  const router = Router();
  const { unlockFailureLimit, unlockTotalLimit, sessionMaxAgeMs } = access.settings;

  router.use((req, res, next) => {
    if (req.method !== 'POST') {
      noStore(res).status(405).set('Allow', 'POST').json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (req.get('origin') !== appOrigin) {
      noStore(res).status(403).json({ error: 'ORIGIN_REJECTED' });
      return;
    }
    next();
  });

  // Audit the lockout once per IP per window (not on every refused request).
  const auditedUntil = new Map<string, number>();
  const tooMany =
    (windowMinutes: number, failures: number | null) => (req: Request, res: Response) => {
      const ip = req.ip ?? 'unknown';
      const now = Date.now();
      // express-rate-limit puts its counter on req.rateLimit (requestPropertyName default).
      const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
      const resetAt = info?.resetTime?.getTime() ?? now + windowMinutes * 60_000;
      if (failures !== null && (auditedUntil.get(ip) ?? 0) <= now) {
        auditedUntil.set(ip, resetAt);
        for (const [k, until] of auditedUntil) if (until <= now) auditedUntil.delete(k);
        void auditUnlockLockout(access.pool, req.ip ?? null, { failures, windowMinutes }).catch(
          () => {
            console.error('[screen-auth] lockout audit failed');
          },
        );
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
      noStore(res)
        .status(429)
        .set('Retry-After', String(retryAfterSeconds))
        .json({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds });
    };

  router.use(
    rateLimit({
      windowMs: unlockTotalLimit.windowMs,
      limit: unlockTotalLimit.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: tooMany(Math.round(unlockTotalLimit.windowMs / 60_000), null),
    }),
  );
  router.use(
    rateLimit({
      windowMs: unlockFailureLimit.windowMs,
      limit: unlockFailureLimit.limit,
      standardHeaders: false,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      handler: tooMany(Math.round(unlockFailureLimit.windowMs / 60_000), unlockFailureLimit.limit),
    }),
  );

  router.post('/unlock', express.json({ limit: '1kb' }), async (req, res) => {
    const parsed = unlockBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      noStore(res).status(400).json({ error: 'VALIDATION_FAILED' });
      return;
    }
    const session = await unlockWithKey(
      access.pool,
      parsed.data.key,
      { ip: req.ip ?? null, screen: parsed.data.screen ?? null, maxAgeMs: sessionMaxAgeMs },
      access.secrets.hashSecret,
    );
    if (session === null) {
      noStore(res).status(401).json({ error: 'WRONG_KEY' });
      return;
    }
    access.setCookie(res, session.token, sessionMaxAgeMs);
    noStore(res).json({ ok: true });
  });

  router.use((_req, res) => {
    noStore(res).status(404).json({ error: 'Not found' });
  });

  // Our own error handler: never logs the request (it holds the key), never leaks details.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : null;
    if (type === 'entity.parse.failed' || type === 'entity.too.large') {
      noStore(res).status(400).json({ error: 'VALIDATION_FAILED' });
      return;
    }
    console.error('[screen-auth] unlock failed:', err instanceof Error ? err.name : 'error');
    if (!res.headersSent) noStore(res).status(500).json({ error: 'Internal error' });
  });

  return router;
}
