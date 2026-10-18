// /api/admin/settings — the DM's election settings. Mounted inside adminRouter, so requireRole('DM')
// has already run; the POST path is on the DM write allow-list (middleware/auth.ts).
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { isoDate, readElectionDate, setElectionDate } from '../../services/election-date.js';
import { actor, busyAsConflict, parse } from './http.js';

/** '' clears the date (the forms then print it blank). */
const electionDateBody = z.object({ date: z.union([z.literal(''), isoDate]) }).strict();
const noQuery = z.object({}).strict();

export function settingsRouter(pool: Pool): Router {
  const router = Router();
  router.get('/election-date', async (req, res) => {
    parse(noQuery, req.query);
    res.set('Cache-Control', 'no-store').json({ date: await readElectionDate(pool) });
  });
  router.post('/election-date', async (req, res) => {
    const { date } = parse(electionDateBody, req.body);
    const who = actor(req);
    await busyAsConflict(() =>
      setElectionDate(pool, { userId: who.user.id, ip: who.ip }, date === '' ? null : date),
    );
    res.json({ ok: true });
  });
  return router;
}
