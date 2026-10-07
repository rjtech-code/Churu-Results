import express from 'express';
import helmet from 'helmet';
import type { Express, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { AppConfig } from './config/app-config.js';
import { dmWriteGuard } from './middleware/auth.js';
import { csrfCheck } from './middleware/csrf.js';
import { currentUser } from './middleware/current-user.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { originCheck } from './middleware/origin.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { createSessionStore, sessionMiddleware } from './middleware/session.js';
import type { SessionStore } from './middleware/session.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { countingRouter } from './modules/counting/counting.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { declareRouter } from './modules/declare/declare.routes.js';
import { frontendStatic } from './modules/frontend/static.js';
import { healthRouter } from './modules/health/health.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { SseHub } from './modules/public/sse.js';
import { PublicSnapshotService } from './services/public-snapshot.js';

export interface AppDeps {
  pool: Pool;
  config: AppConfig;
  /** Session store; server.ts passes one that also deletes expired sessions periodically. */
  sessionStore?: SessionStore;
  /** Extra routers mounted in step 11, after the auth routes and behind every guard. */
  routes?: readonly { path: string; router: Router }[];
  /** Public snapshot service (server.ts passes the started one); created lazily otherwise. */
  publicSnapshot?: PublicSnapshotService;
  sseHub?: SseHub;
}

export function createApp({
  pool,
  config,
  sessionStore,
  routes = [],
  publicSnapshot,
  sseHub,
}: AppDeps): Express {
  const app = express();
  const store = sessionStore ?? createSessionStore(pool, { clearExpired: false });
  // Started on the first public request when not passed in (so other apps/tests never start timers).
  const snapshots = publicSnapshot ?? new PublicSnapshotService(pool, config.publicApi);
  const hub =
    sseHub ??
    new SseHub(snapshots, {
      maxConnections: config.publicApi.sseMaxConnections,
      heartbeatMs: config.publicApi.sseHeartbeatMs,
    });
  app.locals.publicSnapshot = snapshots;
  app.locals.sseHub = hub;

  // 1. No framework fingerprint; trust proxy only as configured (never "true").
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // 2. Security headers with a strict CSP. HSTS only in production (HTTPS).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      strictTransportSecurity: config.production
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      xFrameOptions: { action: 'deny' },
    }),
  );

  // 3. Health check: before the rate limiter and sessions, never limited, never creates a session.
  app.use('/api/health', healthRouter(pool));

  // 3b. Public media-room screens: read-only, own rate limit, ends here (never reaches sessions,
  //     so no cookie is read or set and an expired session cannot break a TV screen).
  app.use('/api/public', publicRouter(snapshots, hub, config.publicApi));

  // 3c. The built operator dashboard (static, GET only, never /api): before sessions, so static
  //     files never touch a session. SPA routes fall back to index.html.
  if (config.frontendDist !== null) app.use(frontendStatic(config.frontendDist));

  // 4. Generous global per-IP limit on the API.
  app.use('/api', apiRateLimit(config.apiRateLimit));

  // 5. JSON bodies, max 100 kb.
  app.use(express.json({ limit: '100kb' }));

  // 6. Sessions (MySQL store, churu.sid cookie, 30-min rolling idle timeout).
  app.use(sessionMiddleware(config, store));

  // 7. Absolute session lifetime, then re-load the user from the DB (disabled = out at once).
  app.use(currentUser(pool, config));

  // 8. Origin check on state-changing requests.
  app.use(originCheck(config.appOrigin));

  // 9. CSRF token check on state-changing requests (login and logout included).
  app.use(csrfCheck);

  // 10. A DM can never change data, whatever a later route forgets.
  app.use(dmWriteGuard);

  // 11. Routes. The login route has its own login rate limiter before validation.
  app.use('/api/auth', authRouter(pool, config));
  app.use('/api/counting', countingRouter(pool, config));
  app.use('/api/declare', declareRouter(pool, config));
  app.use('/api/reports', reportsRouter(pool, config));
  for (const { path, router } of routes) app.use(path, router);

  // 12. 404, 13. central error handler.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
