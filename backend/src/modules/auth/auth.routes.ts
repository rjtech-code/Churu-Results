import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireAuth } from '../../middleware/auth.js';
import { ensureCsrfToken, rotateCsrfToken } from '../../middleware/csrf.js';
import { loginRateLimit } from '../../middleware/rate-limit.js';
import {
  clearSessionCookie,
  destroySession,
  regenerateSession,
  saveSession,
} from '../../middleware/session.js';
import { writeAudit } from '../../services/audit.js';
import { meBody } from '../../services/users.js';
import { attemptLogin } from './auth.service.js';

const loginBody = z
  .object({
    username: z.string().regex(/^[a-z0-9_]{4,30}$/),
    password: z.string().min(1).max(128),
  })
  .strict();

export function authRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();

  /** A CSRF token for this session (creates the session if needed). Call again after login/logout. */
  router.get('/csrf', (req, res) => {
    res.json({ csrfToken: ensureCsrfToken(req) });
  });

  // The login limiter runs before validation, so malformed requests count too.
  router.post('/login', loginRateLimit(config.loginRateLimit), async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_FAILED' });
      return;
    }
    const outcome = await attemptLogin(
      pool,
      parsed.data.username,
      parsed.data.password,
      req.ip ?? null,
    );
    if (outcome.kind === 'invalid') {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }
    if (outcome.kind === 'locked') {
      res
        .status(423)
        .json({ error: 'ACCOUNT_LOCKED', retryAfterSeconds: outcome.retryAfterSeconds });
      return;
    }

    // New session id on login (prevents session fixation) and a new CSRF token.
    await regenerateSession(req);
    req.session.userId = outcome.user.id;
    req.session.role = outcome.user.role;
    req.session.panchayatSamitiId = outcome.user.panchayatSamitiId;
    req.session.loginAt = Date.now();
    rotateCsrfToken(req);
    await saveSession(req);
    res.json(meBody(outcome.user));
  });

  router.post('/logout', async (req, res) => {
    if (req.user) {
      await writeAudit(pool, {
        userId: req.user.id,
        action: 'LOGOUT',
        entity: 'users',
        entityId: req.user.id,
        newValue: { username: req.user.username },
        ip: req.ip ?? null,
      });
    }
    await destroySession(req);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    if (!req.user) return; // requireAuth guarantees a user
    res.json(meBody(req.user));
  });

  return router;
}
