// Serves the built operator dashboard (frontend/dist). Mounted BEFORE sessions: static files never
// read or create a session. GET/HEAD only, never under /api. helmet's strict CSP covers index.html.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';

const isApi = (path: string) => path === '/api' || path.startsWith('/api/');

/** The dist folder if it holds a build (index.html), else null (API-only run). */
export function findFrontendDist(dir: string): string | null {
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

export function frontendStatic(distDir: string): Router {
  const router = Router();
  const indexFile = join(distDir, 'index.html');

  // Only GET/HEAD for non-/api paths are ours; everything else continues to the API stack.
  router.use((req, _res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi(req.path)) {
      next('router');
      return;
    }
    next();
  });

  // Hashed build assets: cache for a year; a missing asset is a plain 404, never index.html.
  router.use(
    '/assets',
    express.static(join(distDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
      index: false,
      fallthrough: true,
    }),
    (_req, res) => {
      res.status(404).set('Cache-Control', 'no-store').end();
    },
  );

  // Other files in dist (if any) and the SPA fallback: always revalidate.
  router.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-cache');
      },
    }),
  );
  router.use((_req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(indexFile);
  });

  return router;
}
