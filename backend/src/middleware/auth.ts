import type { RequestHandler } from 'express';
import type { Role } from '../types/auth.js';
import { isStateChanging } from './http-methods.js';

/** 401 unless the request has a valid, active, logged-in user. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }
  next();
};

/** 401 if not logged in; 403 unless the user has one of the given roles. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

/** The only state-changing routes a DM may call. Exact paths; anything else is refused. */
const DM_WRITE_ALLOWED = new Set(['/api/auth/login', '/api/auth/logout']);

/**
 * Global guard: a DM is read-only. Mounted before all routes, so a later route that forgets
 * requireRole still cannot be used by a DM to change data.
 */
export const dmWriteGuard: RequestHandler = (req, res, next) => {
  if (req.user?.role === 'DM' && isStateChanging(req.method) && !DM_WRITE_ALLOWED.has(req.path)) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
};
