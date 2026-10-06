import express from 'express';
import helmet from 'helmet';
import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { errorHandler, notFound } from './middleware/errors.js';
import { healthRouter } from './modules/health/health.routes.js';

export interface AppDeps {
  pool: Pool;
}

export function createApp({ pool }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
