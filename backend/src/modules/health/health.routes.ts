import { Router } from 'express';
import type { Pool } from 'mysql2/promise';

export function healthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      await pool.execute('SELECT 1');
      res.status(200).json({ status: 'ok', db: 'ok' });
    } catch (err) {
      console.error('[health] database check failed:', err instanceof Error ? err.message : err);
      res.status(503).json({ status: 'error', db: 'down' });
    }
  });

  return router;
}
