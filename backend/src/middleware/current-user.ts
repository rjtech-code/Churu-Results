import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { AppConfig } from '../config/app-config.js';
import { writeAudit } from '../services/audit.js';
import { loadActiveUser } from '../services/users.js';
import { clearSessionCookie, destroySession } from './session.js';

/**
 * Runs on every request after express-session:
 *  1. absolute lifetime: a session older than sessionAbsoluteMs since login is ended
 *     (401 SESSION_EXPIRED, audit SESSION_EXPIRED_ABSOLUTE);
 *  2. the user is re-loaded from the DB; a disabled or deleted user loses access at once
 *     (401 UNAUTHENTICATED). Role and PS always come from the DB, not the session.
 */
export function currentUser(pool: Pool, config: AppConfig): RequestHandler {
  return async (req, res, next) => {
    const userId = req.session.userId;
    if (userId === undefined) {
      next();
      return;
    }

    const loginAt = req.session.loginAt;
    if (loginAt === undefined || Date.now() - loginAt > config.sessionAbsoluteMs) {
      await writeAudit(pool, {
        userId,
        action: 'SESSION_EXPIRED_ABSOLUTE',
        entity: 'users',
        entityId: userId,
        newValue: { login_at: loginAt === undefined ? null : new Date(loginAt).toISOString() },
        ip: req.ip ?? null,
      });
      await destroySession(req);
      clearSessionCookie(res, config);
      res.status(401).json({ error: 'SESSION_EXPIRED' });
      return;
    }

    const user = await loadActiveUser(pool, userId);
    if (!user) {
      await destroySession(req);
      clearSessionCookie(res, config);
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    req.user = user;
    next();
  };
}
