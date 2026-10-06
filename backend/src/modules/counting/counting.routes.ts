import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { loadWardResult } from '../../services/result-loader.js';
import type { AuthUser } from '../../types/auth.js';
import {
  boothEntryView,
  entryHistory,
  getBoothEntry,
  getPostalEntry,
  listBooths,
  listWards,
  postalEntryView,
  wardBallot,
} from './counting.read.js';
import {
  createBoothEntry,
  createPostalEntry,
  previewBoothEntry,
  previewPostalEntry,
  updateBoothEntry,
  updatePostalEntry,
  voidBoothEntry,
  voidPostalEntry,
} from './counting.service.js';
import type { WriteContext } from './counting.service.js';

// ---------------------------------------------------------------- Zod schemas

/** Largest value of an INT UNSIGNED column; keeps every number storable and every sum exact. */
const MAX_COUNT = 4_294_967_295;

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(MAX_COUNT);
const roundNo = z.number().int().min(1).max(99);
const reason = z.string().trim().min(10).max(500);
const votes = z
  .array(z.object({ candidateId: id, votes: count }).strict())
  .min(1)
  .max(60);

const boothCreate = z
  .object({
    wardId: id,
    boothId: id,
    ballotFor: z.enum(['PS', 'ZP']),
    roundNo,
    sheetTotal: count,
    votes,
  })
  .strict();
const boothUpdate = z
  .object({ rowVersion: id, roundNo, sheetTotal: count, votes, reason })
  .strict();
const voidBody = z.object({ rowVersion: id, reason }).strict();
const postalCreate = z
  .object({ sheetTotal: count, rejectedCount: count.optional(), votes })
  .strict();
const postalUpdate = z
  .object({ rowVersion: id, sheetTotal: count, rejectedCount: count.optional(), votes, reason })
  .strict();
const idParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);

/** Zod parse; failures become 400 VALIDATION_FAILED with field paths (never the input values). */
function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

function param(req: Request, name: string): number {
  return parse(idParam, req.params[name]);
}

function currentUser(req: Request): AuthUser {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED'); // requireRole already guarantees a user
  return req.user;
}

// ---------------------------------------------------------------- router

/** /api/counting — PS_RO and ZP_RO only (DM: 403, including reads). */
export function countingRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  router.use(requireRole('PS_RO', 'ZP_RO'));

  const ctx = (req: Request): WriteContext => ({
    user: currentUser(req),
    ip: req.ip ?? null,
    requireVoterCounts: config.requireVoterCounts,
  });

  // ---- reads
  router.get('/wards', async (req, res) => {
    res.json({ wards: await listWards(pool, currentUser(req)) });
  });
  router.get('/wards/:wardId/booths', async (req, res) => {
    res.json(await listBooths(pool, currentUser(req), param(req, 'wardId')));
  });
  router.get('/wards/:wardId/ballot', async (req, res) => {
    res.json({ candidates: await wardBallot(pool, currentUser(req), param(req, 'wardId')) });
  });
  router.get('/entries/:entryId', async (req, res) => {
    res.json({ entry: await getBoothEntry(pool, currentUser(req), param(req, 'entryId')) });
  });
  router.get('/entries/:entryId/history', async (req, res) => {
    res.json({
      history: await entryHistory(pool, currentUser(req), 'BOOTH', param(req, 'entryId')),
    });
  });
  router.get('/postal/:entryId', async (req, res) => {
    res.json({ entry: await getPostalEntry(pool, currentUser(req), param(req, 'entryId')) });
  });
  router.get('/postal/:entryId/history', async (req, res) => {
    res.json({
      history: await entryHistory(pool, currentUser(req), 'POSTAL', param(req, 'entryId')),
    });
  });

  // ---- booth entries
  router.post('/entries/preview', async (req, res) => {
    res.json(await previewBoothEntry(pool, ctx(req), parse(boothCreate, req.body)));
  });
  router.post('/entries', async (req, res) => {
    const out = await createBoothEntry(pool, ctx(req), parse(boothCreate, req.body));
    res.status(201).json({
      entry: await boothEntryView(pool, out.entryId),
      wardResult: await loadWardResult(pool, out.wardId),
      warnings: out.warnings,
    });
  });
  router.put('/entries/:entryId', async (req, res) => {
    const out = await updateBoothEntry(
      pool,
      ctx(req),
      param(req, 'entryId'),
      parse(boothUpdate, req.body),
    );
    res.json({
      entry: await boothEntryView(pool, out.entryId),
      wardResult: await loadWardResult(pool, out.wardId),
      warnings: out.warnings,
    });
  });
  router.post('/entries/:entryId/void', async (req, res) => {
    const out = await voidBoothEntry(
      pool,
      ctx(req),
      param(req, 'entryId'),
      parse(voidBody, req.body),
    );
    res.json({
      voided: { archiveId: out.archiveId, entryId: out.entryId },
      wardResult: await loadWardResult(pool, out.wardId),
    });
  });

  // ---- postal entries (one per ward)
  router.post('/wards/:wardId/postal/preview', async (req, res) => {
    res.json(
      await previewPostalEntry(pool, ctx(req), param(req, 'wardId'), parse(postalCreate, req.body)),
    );
  });
  router.post('/wards/:wardId/postal', async (req, res) => {
    const out = await createPostalEntry(
      pool,
      ctx(req),
      param(req, 'wardId'),
      parse(postalCreate, req.body),
    );
    res.status(201).json({
      entry: await postalEntryView(pool, out.entryId),
      wardResult: await loadWardResult(pool, out.wardId),
      warnings: out.warnings,
    });
  });
  router.put('/postal/:entryId', async (req, res) => {
    const out = await updatePostalEntry(
      pool,
      ctx(req),
      param(req, 'entryId'),
      parse(postalUpdate, req.body),
    );
    res.json({
      entry: await postalEntryView(pool, out.entryId),
      wardResult: await loadWardResult(pool, out.wardId),
      warnings: out.warnings,
    });
  });
  router.post('/postal/:entryId/void', async (req, res) => {
    const out = await voidPostalEntry(
      pool,
      ctx(req),
      param(req, 'entryId'),
      parse(voidBody, req.body),
    );
    res.json({
      voided: { archiveId: out.archiveId, entryId: out.entryId },
      wardResult: await loadWardResult(pool, out.wardId),
    });
  });

  return router;
}
