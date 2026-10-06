import type { RequestHandler } from 'express';
import { isStateChanging } from './http-methods.js';

/**
 * State-changing requests that carry an Origin header must come from our own origin.
 * (Browsers send Origin on cross-site POSTs.) No CORS headers are ever added: same origin only.
 */
export function originCheck(appOrigin: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (isStateChanging(req.method) && origin !== undefined && origin !== appOrigin) {
      res.status(403).json({ error: 'ORIGIN_REJECTED' });
      return;
    }
    next();
  };
}
