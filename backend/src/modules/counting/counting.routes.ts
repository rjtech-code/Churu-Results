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
  boothHistory,
  combinedBooth,
  entryHistory,
  getBoothEntry,
  getPostalEntry,
  listBooths,
  listWards,
  postalEntryView,
  postalHistory,
  wardBallot,
} from './counting.read.js';
import { canReadWard } from '../../services/access.js';
import {
  createBoothEntry,
  createCombinedEntry,
  previewCombinedEntry,
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
const combinedSection = z.object({ sheetTotal: count, votes }).strict();
const combinedCreate = z
  .object({
    boothId: id,
    roundNo,
    ps: combinedSection.optional(),
    zp: combinedSection.optional(),
  })
  .strict()
  .refine((b) => b.ps !== undefined || b.zp !== undefined, { message: 'ps or zp is required' });
const voidBody = z.object({ rowVersion: id, reason }).strict();
const historyQuery = z.object({ ballotFor: z.enum(['PS', 'ZP']) }).strict();
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

  /**
   * The ward's result, or null when this user may not read that ward: a PS_RO entering ZP booth
   * sheets of its own PS (Part 14) never sees ZP ward totals or the leader.
   */
  const wardResultFor = async (req: Request, wardId: number) =>
    (await canReadWard(pool, currentUser(req), wardId)) ? await loadWardResult(pool, wardId) : null;

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
  router.get('/booths/:boothId/history', async (req, res) => {
    const { ballotFor } = parse(historyQuery, req.query);
    res.json({
      history: await boothHistory(pool, currentUser(req), param(req, 'boothId'), ballotFor),
    });
  });
  router.get('/wards/:wardId/postal/history', async (req, res) => {
    res.json({ history: await postalHistory(pool, currentUser(req), param(req, 'wardId')) });
  });
  router.get('/postal/:entryId', async (req, res) => {
    res.json({ entry: await getPostalEntry(pool, currentUser(req), param(req, 'entryId')) });
  });
  router.get('/postal/:entryId/history', async (req, res) => {
    res.json({
      history: await entryHistory(pool, currentUser(req), 'POSTAL', param(req, 'entryId')),
    });
  });

  router.get('/booths/:boothId/combined', async (req, res) => {
    res.json(await combinedBooth(pool, currentUser(req), param(req, 'boothId')));
  });

  // ---- combined PS + ZP sheet of one booth (PS_RO, Part 14): both parts or nothing
  router.post('/entries/combined/preview', async (req, res) => {
    res.json(await previewCombinedEntry(pool, ctx(req), parse(combinedCreate, req.body)));
  });
  router.post('/entries/combined', async (req, res) => {
    const out = await createCombinedEntry(pool, ctx(req), parse(combinedCreate, req.body));
    res.status(201).json({
      entries: await Promise.all(out.entries.map((e) => boothEntryView(pool, e.entryId))),
      warnings: out.warnings,
    });
  });

  // ---- booth entries
  router.post('/entries/preview', async (req, res) => {
    const body = parse(boothCreate, req.body);
    const preview = await previewBoothEntry(pool, ctx(req), body);
    res.json(
      (await canReadWard(pool, currentUser(req), body.wardId))
        ? preview
        : { summary: preview.summary, warnings: preview.warnings },
    );
  });
  router.post('/entries', async (req, res) => {
    const out = await createBoothEntry(pool, ctx(req), parse(boothCreate, req.body));
    res.status(201).json({
      entry: await boothEntryView(pool, out.entryId),
      wardResult: await wardResultFor(req, out.wardId),
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
      wardResult: await wardResultFor(req, out.wardId),
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
      wardResult: await wardResultFor(req, out.wardId),
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
      wardResult: await wardResultFor(req, out.wardId),
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
      wardResult: await wardResultFor(req, out.wardId),
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
      wardResult: await wardResultFor(req, out.wardId),
    });
  });

  return router;
}
