import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { loadWardResult } from '../../services/result-loader.js';
import type { WriteContext } from '../counting/counting.service.js';
import {
  correctWard,
  declareWard,
  listDeclarations,
  previewCorrection,
  previewDeclaration,
} from './declare.service.js';

const MAX_COUNT = 4_294_967_295; // INT UNSIGNED, as in counting
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(MAX_COUNT);
const votes = z
  .array(z.object({ candidateId: id, votes: count }).strict())
  .min(1)
  .max(60);
const password = z.string().min(1).max(128);
const lottery = z
  .object({
    winnerCandidateId: id,
    conductedBy: z.string().trim().min(3).max(100),
    note: z.string().trim().min(10).max(500),
  })
  .strict();
const decision = {
  confirmWinnerCandidateId: id,
  confirmTotalValidVotes: count,
  lottery: lottery.optional(),
  acknowledgeNotaHighest: z.literal(true).optional(),
};
const declareBody = z.object({ password, ...decision }).strict();

const boothChange = z
  .object({
    kind: z.literal('BOOTH'),
    entryId: id,
    rowVersion: id,
    roundNo: z.number().int().min(1).max(99).optional(),
    sheetTotal: count,
    votes,
  })
  .strict();
const postalChange = z
  .object({
    kind: z.literal('POSTAL'),
    entryId: id,
    rowVersion: id,
    sheetTotal: count,
    rejectedCount: count.nullable().optional(), // omitted: keep; null: clear
    votes,
  })
  .strict();
const changes = z
  .array(z.discriminatedUnion('kind', [boothChange, postalChange]))
  .min(1)
  .max(60);
const correctionBody = z
  .object({ password, reason: z.string().trim().min(10).max(500), changes, ...decision })
  .strict();
const correctionPreviewBody = z.object({ changes }).strict();
const emptyBody = z.object({}).strict();
const idParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** /api/declare — PS_RO (PS wards of own PS) and ZP_RO (ZP wards). DM: 403. */
export function declareRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  router.use(requireRole('PS_RO', 'ZP_RO'));

  const ctx = (req: Request): WriteContext => {
    if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
    return { user: req.user, ip: req.ip ?? null, requireVoterCounts: config.requireVoterCounts };
  };
  const wardId = (req: Request) => parse(idParam, req.params.wardId);
  const declarationsOf = async (req: Request, id: number) => {
    const all = await listDeclarations(pool, ctx(req), id);
    return all[all.length - 1];
  };

  router.post('/wards/:wardId/preview', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    res.json(await previewDeclaration(pool, ctx(req), wardId(req)));
  });

  router.post('/wards/:wardId', async (req, res) => {
    const out = await declareWard(pool, ctx(req), wardId(req), parse(declareBody, req.body));
    res.status(201).json({
      declaration: await declarationsOf(req, out.wardId),
      result: await loadWardResult(pool, out.wardId),
    });
  });

  router.post('/wards/:wardId/correction/preview', async (req, res) => {
    const body = parse(correctionPreviewBody, req.body);
    res.json(await previewCorrection(pool, ctx(req), wardId(req), body.changes));
  });

  router.post('/wards/:wardId/correction', async (req, res) => {
    const out = await correctWard(pool, ctx(req), wardId(req), parse(correctionBody, req.body));
    res.status(201).json({
      declaration: await declarationsOf(req, out.wardId),
      result: await loadWardResult(pool, out.wardId),
      warnings: out.warnings,
    });
  });

  router.get('/wards/:wardId/declarations', async (req, res) => {
    res.json({ declarations: await listDeclarations(pool, ctx(req), wardId(req)) });
  });

  return router;
}
