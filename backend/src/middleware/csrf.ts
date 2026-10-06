import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { isStateChanging } from './http-methods.js';

export const CSRF_HEADER = 'x-csrf-token';

/** Returns the session's CSRF token, creating one if needed (synchronizer token pattern). */
export function ensureCsrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

/** Replaces the token (on login; on logout the whole session is destroyed). */
export function rotateCsrfToken(req: Request): string {
  req.session.csrfToken = randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function tokensMatch(expected: string | undefined, given: string | undefined): boolean {
  if (expected === undefined || given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every POST/PUT/PATCH/DELETE must send the session's token in X-CSRF-Token. */
export const csrfCheck: RequestHandler = (req, res, next) => {
  if (isStateChanging(req.method) && !tokensMatch(req.session.csrfToken, req.get(CSRF_HEADER))) {
    res.status(403).json({ error: 'CSRF_FAILED' });
    return;
  }
  next();
};
