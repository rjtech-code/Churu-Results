// /api/candidates — the RO's candidate lists (Part 13). PS_RO: PS wards of its own PS; ZP_RO: ZP
// wards (checked per ward on the server). The DM gets 403 here; the DM uses /api/admin.
// After the ballot lock only "नाम सुधारें" (name-change.service.ts) can change anything, and only the name.
import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import {
  actor,
  candidateDetailsFields,
  idParam,
  noStore,
  parse,
  password,
  reason,
} from '../admin/http.js';
import {
  authorizeOwnWard,
  listOwnWards,
  markReady,
  readOwnWard,
  saveOwnWard,
} from './candidates.service.js';
import {
  correctCandidateName,
  visibleNameChanges,
  wardNameChanges,
} from './name-change.service.js';

const candidate = z
  .object({
    ballotPosition: z.number().int().min(1).max(255),
    nameHindi: z.string().max(400),
    partyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    gender: z.enum(['M', 'F', 'O']),
    // Optional private details (checked with a Hindi message by checkDetails). Left out = empty.
    ...candidateDetailsFields,
  })
  .strict();
// The list size rule (at most 59) is checked by checkWardList, with a Hindi message.
const listBody = z.object({ candidates: z.array(candidate).max(100) }).strict();
const readyBody = z.object({}).strict();
// Generous text limits here; the exact name rules (Hindi messages) are in services/candidate-name.ts.
const nameBody = z
  .object({
    currentName: z.string().min(1).max(400),
    newName: z.string().max(1000),
    reason,
    password,
  })
  .strict();

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
    parse(readyBody, req.body ?? {});
    await markReady(pool, actor(req), wardId(req));
    res.json({ ok: true });
  });
  // "नाम सुधारें" (locked ward only): password re-check + reason + compare-and-set.
  router.post('/wards/:wardId/candidates/:candidateId/name', async (req, res) => {
    const id = wardId(req);
    const candidateId = parse(idParam, req.params.candidateId);
    const body = parse(nameBody, req.body);
    noStore(res);
    res.json(await correctCandidateName(pool, actor(req), id, candidateId, body));
  });
  router.get('/wards/:wardId/name-changes', async (req, res) => {
    const id = wardId(req);
    await authorizeOwnWard(pool, actor(req), id);
    res.json({ changes: await wardNameChanges(pool, id) });
  });
  router.get('/name-changes', async (req, res) => {
    res.json({ changes: await visibleNameChanges(pool, actor(req).user) });
  });
  return router;
}
