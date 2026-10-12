// /api/admin — the DM's master-data tools (Part 13). DM only (requireRole), and the global DM guard
// allows exactly these POST paths (middleware/auth.ts). The DM still can never enter votes, edit or
// void entries, declare or correct: those routers stay closed to the DM.
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { MAX_FULL_NAME_LENGTH } from '../../services/master-data/accounts.js';
import { loadParties } from '../../services/master-data/parties.js';
import { TEMPLATE_NAMES, templateSheets } from '../../services/master-data/templates.js';
import type { TemplateName } from '../../services/master-data/templates.js';
import { MAX_UPLOAD_BASE64 } from '../../services/master-data/upload.js';
import { writeSheetToBuffer } from '../../services/master-data/xlsx.js';
import { normalizeText } from '../../services/master-data/text.js';
import {
  listWardsForEdit,
  moveBooth,
  searchBooths,
  updateBooth,
  updateWardCategory,
} from './booths.service.js';
import { actor, idParam, noStore, parse, password, reason } from './http.js';
import {
  ballotReport,
  candidateStatus,
  lockArea,
  lockPreview,
  parseArea,
  sendBack,
  wardCandidates,
} from './lists.service.js';
import type { Area } from './lists.service.js';
import {
  addOneParty,
  checkCandidatesUpload,
  checkPartiesUpload,
  saveCandidatesUpload,
  savePartiesUpload,
} from './uploads.service.js';
import {
  createSeatAccount,
  listSeats,
  parseSeat,
  replaceAccount,
  resetAccountPassword,
  setRoActive,
  unlockAccount,
} from './users.service.js';

/** The upload routes: the only bodies above 100 kb (parsed here, after the DM role check). */
export const UPLOAD_PATHS: ReadonlySet<string> = new Set([
  '/api/admin/parties/check',
  '/api/admin/parties/save',
  '/api/admin/candidates/check',
  '/api/admin/candidates/save',
]);
/** 5 MB of file as base64 plus the JSON around it. */
const UPLOAD_BODY_LIMIT = MAX_UPLOAD_BASE64 + 64 * 1024;

const fileName = z.string().trim().min(1).max(255);
const fileBase64 = z.string().min(1).max(MAX_UPLOAD_BASE64);
const uploadCheck = z.object({ fileName, fileBase64 }).strict();
const uploadSave = z.object({ fileName, fileBase64, password }).strict();
const passwordOnly = z.object({ password }).strict();
const fullName = z
  .string()
  .transform(normalizeText)
  .pipe(z.string().min(2).max(MAX_FULL_NAME_LENGTH));
const areaText = z
  .string()
  .max(20)
  .transform((t, ctx) => {
    const area = parseArea(t);
    if (area === null) {
      ctx.addIssue({ code: 'custom', message: 'unknown area' });
      return z.NEVER;
    }
    return area;
  });
const partyBody = z
  .object({
    nameHindi: z.string().max(400),
    nameEnglish: z.string().max(400),
    shortName: z.string().max(100),
    symbol: z.string().max(200),
    password,
  })
  .strict();
const lockBody = z
  .object({
    area: areaText,
    confirmText: z.literal('LOCK'),
    expectedWardIds: z.array(z.number().int().positive()).max(1000),
    password,
  })
  .strict();
const voters = z.number().int().min(0).max(4_294_967_295);
const boothBody = z
  .object({
    nameHindi: z.string().max(600),
    votersMale: voters,
    votersFemale: voters,
    votersOther: voters,
    reason,
    password,
  })
  .strict();
const wardIdBody = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const moveBody = z
  .object({ psWardId: wardIdBody, zpWardId: wardIdBody, reason, password })
  .strict();
const categoryBody = z.object({ category: z.string().max(200), reason, password }).strict();
const sendBackBody = z.object({ reason, password }).strict();
const createBody = z
  .object({
    seat: z
      .string()
      .max(20)
      .transform((t, ctx) => {
        const seat = parseSeat(t);
        if (seat === null) {
          ctx.addIssue({ code: 'custom', message: 'unknown seat' });
          return z.NEVER;
        }
        return seat;
      }),
    fullName,
    password,
  })
  .strict();
const replaceBody = z.object({ fullName, password }).strict();
const areaQuery = z.object({ area: areaText.optional() }).strict();
const reportQuery = z.object({ scope: z.union([z.literal('ALL'), areaText]) }).strict();
const boothQuery = z.object({ psId: idParam, wardNo: idParam.optional() }).strict();
const psQuery = z.object({ psId: idParam }).strict();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, data: Buffer, name: string): void {
  noStore(res);
  res.set('Content-Type', XLSX_TYPE);
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send(data);
}

export function adminRouter(pool: Pool, _config: AppConfig): Router {
  const router = Router();
  router.use(requireRole('DM'));
  // Only after the role check: a large upload body is read only for a logged-in DM.
  const uploadJson = express.json({ limit: UPLOAD_BODY_LIMIT });
  const id = (req: Request, name: string) => parse(idParam, req.params[name]);

  // ---- parties
  router.get('/parties', async (_req, res) => {
    res.json({ parties: await loadParties(pool) });
  });
  router.post('/parties/check', uploadJson, async (req, res) => {
    res.json(await checkPartiesUpload(pool, parse(uploadCheck, req.body)));
  });
  router.post('/parties/save', uploadJson, async (req, res) => {
    res.json({ saved: await savePartiesUpload(pool, actor(req), parse(uploadSave, req.body)) });
  });
  router.post('/parties/add', async (req, res) => {
    res.status(201).json(await addOneParty(pool, actor(req), parse(partyBody, req.body)));
  });

  // ---- candidate lists
  router.get('/templates/:name', async (req, res) => {
    const name = req.params.name.replace(/\.xlsx$/, '');
    if (!TEMPLATE_NAMES.includes(name as TemplateName)) throw new ApiError(404, 'NOT_FOUND');
    const data = await writeSheetToBuffer(templateSheets(name as TemplateName));
    sendXlsx(res, data, `${name}-template.xlsx`);
  });
  router.post('/candidates/check', uploadJson, async (req, res) => {
    res.json(await checkCandidatesUpload(pool, parse(uploadCheck, req.body)));
  });
  router.post('/candidates/save', uploadJson, async (req, res) => {
    res.json({ saved: await saveCandidatesUpload(pool, actor(req), parse(uploadSave, req.body)) });
  });
  router.get('/candidate-status', async (req, res) => {
    const q = parse(areaQuery, req.query);
    res.json(await candidateStatus(pool, q.area ?? null));
  });
  router.get('/wards/:wardId/candidates', async (req, res) => {
    res.json(await wardCandidates(pool, id(req, 'wardId')));
  });
  router.post('/wards/:wardId/send-back', async (req, res) => {
    await sendBack(pool, actor(req), id(req, 'wardId'), parse(sendBackBody, req.body));
    res.json({ ok: true });
  });
  router.get('/lock/preview', async (req, res) => {
    const q = parse(z.object({ area: areaText }).strict(), req.query);
    res.json(await lockPreview(pool, q.area));
  });
  router.post('/lock', async (req, res) => {
    const body = parse(lockBody, req.body);
    res.json(await lockArea(pool, actor(req), body));
  });
  router.get('/ballot-report.xlsx', async (req, res) => {
    const q = parse(reportQuery, req.query);
    const scope: Area | { kind: 'ALL' } = q.scope === 'ALL' ? { kind: 'ALL' } : q.scope;
    const out = await ballotReport(pool, actor(req), scope);
    sendXlsx(res, out.data, out.fileName);
  });

  // ---- RO accounts (new passwords: shown once, never cached)
  router.get('/users', async (_req, res) => {
    res.json({ seats: await listSeats(pool) });
  });
  router.post('/users/create', async (req, res) => {
    const out = await createSeatAccount(pool, actor(req), parse(createBody, req.body));
    noStore(res);
    res.status(201).json(out);
  });
  router.post('/users/:userId/replace', async (req, res) => {
    const out = await replaceAccount(
      pool,
      actor(req),
      id(req, 'userId'),
      parse(replaceBody, req.body),
    );
    noStore(res);
    res.status(201).json(out);
  });
  router.post('/users/:userId/reset-password', async (req, res) => {
    const out = await resetAccountPassword(
      pool,
      actor(req),
      id(req, 'userId'),
      parse(passwordOnly, req.body),
    );
    noStore(res);
    res.json(out);
  });
  router.post('/users/:userId/disable', async (req, res) => {
    await setRoActive(pool, actor(req), id(req, 'userId'), false, parse(passwordOnly, req.body));
    res.json({ ok: true });
  });
  router.post('/users/:userId/enable', async (req, res) => {
    await setRoActive(pool, actor(req), id(req, 'userId'), true, parse(passwordOnly, req.body));
    res.json({ ok: true });
  });
  router.post('/users/:userId/unlock', async (req, res) => {
    await unlockAccount(pool, actor(req), id(req, 'userId'), parse(passwordOnly, req.body));
    res.json({ ok: true });
  });

  // ---- booths and wards
  router.get('/booths', async (req, res) => {
    const q = parse(boothQuery, req.query);
    res.json({ booths: await searchBooths(pool, q.psId, q.wardNo ?? null) });
  });
  router.get('/wards', async (req, res) => {
    const q = parse(psQuery, req.query);
    res.json({ wards: await listWardsForEdit(pool, q.psId) });
  });
  router.post('/booths/:boothId', async (req, res) => {
    await updateBooth(pool, actor(req), id(req, 'boothId'), parse(boothBody, req.body));
    res.json({ ok: true });
  });
  router.post('/booths/:boothId/move', async (req, res) => {
    await moveBooth(pool, actor(req), id(req, 'boothId'), parse(moveBody, req.body));
    res.json({ ok: true });
  });
  router.post('/wards/:wardId/category', async (req, res) => {
    await updateWardCategory(pool, actor(req), id(req, 'wardId'), parse(categoryBody, req.body));
    res.json({ ok: true });
  });

  return router;
}
