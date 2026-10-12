// /api/candidates — the RO's candidate lists (Part 13). PS_RO: PS wards of its own PS; ZP_RO: ZP
// wards (checked per ward on the server). The DM gets 403 here; the DM uses /api/admin.
import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { actor, idParam, parse, password } from '../admin/http.js';
import { listOwnWards, markReady, readOwnWard, saveOwnWard } from './candidates.service.js';

const candidate = z
  .object({
    ballotPosition: z.number().int().min(1).max(255),
    nameHindi: z.string().max(400),
    partyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    gender: z.enum(['M', 'F', 'O']),
  })
  .strict();
// The list size rule (at most 59) is checked by checkWardList, with a Hindi message.
const listBody = z.object({ candidates: z.array(candidate).max(100) }).strict();
const readyBody = z.object({ password }).strict();

export function candidatesRouter(pool: Pool, _config: AppConfig): Router {
  const router = Router();
  router.use(requireRole('PS_RO', 'ZP_RO'));
  const wardId = (req: Request) => parse(idParam, req.params.wardId);

  router.get('/wards', async (req, res) => {
    res.json({ wards: await listOwnWards(pool, actor(req)) });
  });
  router.get('/wards/:wardId', async (req, res) => {
    res.json(await readOwnWard(pool, actor(req), wardId(req)));
  });
  router.put('/wards/:wardId', async (req, res) => {
    const body = parse(listBody, req.body);
    res.json(await saveOwnWard(pool, actor(req), wardId(req), body.candidates));
  });
  router.post('/wards/:wardId/ready', async (req, res) => {
    const body = parse(readyBody, req.body);
    await markReady(pool, actor(req), wardId(req), body.password);
    res.json({ ok: true });
  });
  return router;
}
