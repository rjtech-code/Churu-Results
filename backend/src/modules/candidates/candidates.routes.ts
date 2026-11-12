// /api/candidates — the RO's candidate lists (Part 13). PS_RO: PS wards of its own PS; ZP_RO: ZP
// wards (checked per ward on the server). The DM gets 403 here; the DM uses /api/admin.
// After the ballot lock only "विवरण सुधारें" (name-change.service.ts) can change anything: the
// candidate's details, never the ballot position, the list itself or NOTA.
import { Router } from 'express';
import type { Request, Response } from 'express';
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
  correctCandidateDetails,
  visibleNameChanges,
  wardNameChanges,
} from './name-change.service.js';
import { FROZEN_FIELD_KEYS } from '../../services/candidate-fields.js';
import { ApiError } from '../../middleware/errors.js';

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
// "विवरण सुधारें" (locked ward): the name the RO saw (compare-and-set) plus the fields that changed.
// A field left out is unchanged. Generous limits here; the exact rules (with Hindi messages) are in
// services/candidate-fields.ts and services/candidate-name.ts.
const correctionBody = z
  .object({
    currentName: z.string().min(1).max(400),
    newName: z.string().max(1000).optional(),
    partyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    gender: z.string().max(5).optional(),
    ...candidateDetailsFields,
    reason,
    password,
    confirmPartyChange: z.boolean().optional(),
  })
  .strict();

/**
 * The ballot position, adding / removing a candidate and NOTA can never be corrected after the
 * lock: a request that carries such a key is refused with FIELD_FROZEN naming the field, instead of
 * a bare "unknown field".
 */
function refuseFrozenFields(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  for (const key of Object.keys(body)) {
    const field = FROZEN_FIELD_KEYS[key];
    if (field !== undefined) throw new ApiError(400, 'FIELD_FROZEN', { field });
  }
}

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
  // "विवरण सुधारें" (locked ward only): password re-check + reason + compare-and-set.
  const correct = async (req: Request, res: Response) => {
    const id = wardId(req);
    const candidateId = parse(idParam, req.params.candidateId);
    refuseFrozenFields(req.body);
    const body = parse(correctionBody, req.body);
    noStore(res);
    res.json(await correctCandidateDetails(pool, actor(req), id, candidateId, body));
  };
  // /name is the path this has always had (name-only corrections keep working unchanged).
  router.post('/wards/:wardId/candidates/:candidateId/name', correct);
  router.post('/wards/:wardId/candidates/:candidateId/details', correct);
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
