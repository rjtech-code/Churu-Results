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

const ID = '[1-9][0-9]{0,14}';
/**
 * Part 13: the DM's master-data tools (parties, candidate lists, ballot lock, RO accounts, booths
 * and wards). POST only, exact paths, nothing under /api/counting or /api/declare. Every one of
 * these routes also has requireRole('DM') and (for writes) a password re-check.
 */
const DM_ADMIN_WRITE = new RegExp(
  '^/api/admin/(?:' +
    [
      'parties/(?:check|save|add)',
      'candidates/(?:check|save)',
      `wards/${ID}/(?:send-back|category)`,
      'lock',
      'users/create',
      'users/generate-password',
      `users/${ID}/(?:replace|view-password|update-credentials|disable|enable|unlock)`,
      `booths/${ID}`,
      `booths/${ID}/move`,
    ].join('|') +
    ')$',
);

/** True for a DM write that is on the allow-list (exported for tests). */
export function dmWriteAllowed(method: string, path: string): boolean {
  if (DM_WRITE_ALLOWED.has(path)) return true;
  return method === 'POST' && DM_ADMIN_WRITE.test(path);
}

/**
 * Global guard: a DM is read-only. Mounted before all routes, so a later route that forgets
 * requireRole still cannot be used by a DM to change data.
 */
export const dmWriteGuard: RequestHandler = (req, res, next) => {
  if (
    req.user?.role === 'DM' &&
    isStateChanging(req.method) &&
    !dmWriteAllowed(req.method, req.path)
  ) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
};
