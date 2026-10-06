// /api/public — read-only data for the media-room screens. Mounted BEFORE sessions: no session is
// read or created and no cookie is ever set. Everything is served from the in-memory snapshot.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PublicApiConfig } from '../../config/app-config.js';
import type { PublicSnapshotData, PublicSnapshotService } from '../../services/public-snapshot.js';
import type { SseHub } from './sse.js';

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const screenParam = z.enum(['1', '2', '3']);

function badRequest(res: Response, issues: z.core.$ZodIssue[]): void {
  res
    .status(400)
    .set('Cache-Control', 'no-store')
    .json({
      error: 'VALIDATION_FAILED',
      details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
}

export function publicRouter(
  snapshots: PublicSnapshotService,
  hub: SseHub,
  config: PublicApiConfig,
): Router {
  const router = Router();

  // Read-only: anything but GET/HEAD is refused here, before any other middleware.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res
        .status(405)
        .set({ Allow: 'GET, HEAD', 'Cache-Control': 'no-store' })
        .json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    next();
  });

  // The stream is capped by connection count, not by the request limiter.
  router.get('/stream', hub.handler);

  router.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).set('Cache-Control', 'no-store').json({ error: 'TOO_MANY_REQUESTS' });
      },
    }),
  );

  // Every data endpoint: current snapshot, no-store, ETag = snapshot version, 304 when unchanged.
  const withSnapshot =
    (send: (snapshot: PublicSnapshotData, req: Request, res: Response) => void) =>
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
      await snapshots.start();
      const snapshot = snapshots.get();
      res.set('Cache-Control', 'no-store');
      if (snapshot === null) {
        res.status(503).json({ error: 'SNAPSHOT_UNAVAILABLE' });
        return;
      }
      const etag = `"${snapshot.version}"`;
      res.set('ETag', etag);
      if (req.get('if-none-match') === etag) {
        res.status(304).end();
        return;
      }
      send(snapshot, req, res);
    };

  router.get(
    '/meta',
    withSnapshot((s, _req, res) => {
      res.json({ version: s.version, generatedAt: s.generatedAt, ...s.meta });
    }),
  );

  router.get(
    '/screens/:screenNo',
    withSnapshot((s, req, res) => {
      const parsed = screenParam.safeParse(req.params.screenNo);
      if (!parsed.success) {
        badRequest(res, parsed.error.issues);
        return;
      }
      const head = { version: s.version, generatedAt: s.generatedAt };
      if (parsed.data === '3') res.json({ ...head, ...s.screens['3'] });
      else res.json({ ...head, panchayatSamitis: s.screens[parsed.data] });
    }),
  );

  const listed = (pick: (s: PublicSnapshotData) => readonly unknown[]) =>
    withSnapshot((s, req, res) => {
      const parsed = limitQuery.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, parsed.error.issues);
        return;
      }
      res.json({
        version: s.version,
        generatedAt: s.generatedAt,
        items: pick(s).slice(0, parsed.data.limit),
      });
    });
  router.get(
    '/recent',
    listed((s) => s.recent),
  );
  router.get(
    '/winners',
    listed((s) => s.winners),
  );

  router.use((_req, res) => {
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found' });
  });

  return router;
}
