// /api/superadmin — the Super Admin setup panel (SUPER_ADMIN only; the global superAdminGuard keeps
// that role out of everything else). Tasks: test-data reset, master-data replace, booths, DM account,
// counting lock, sample files. Password rules: see superadmin.service.ts (confirmDanger).
import express, { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { MAX_UPLOAD_BASE64 } from '../../services/master-data/upload.js';
import {
  addBooth,
  checkBoothAdd,
  checkBoothDelete,
  deleteBooth,
  listBooths,
  wardsForBooths,
} from '../../services/setup/booths.js';
import { SAMPLE_NAMES, sampleFile } from '../../services/setup/samples.js';
import type { SampleName } from '../../services/setup/samples.js';
import { actor, busyAsConflict, idParam, noStore, parse, password } from '../admin/http.js';
import {
  MAX_JSON_UPLOAD_CHARS,
  backupNow,
  checkMasterData,
  confirmDanger,
  overview,
  replaceMasterData,
  resetDmPassword,
  resetTestData,
  setCountingLock,
  setDmEmail,
  unlockDm,
} from './superadmin.service.js';

/** The master-data routes carry two Excel files and two JSON files (parsed after the role check). */
export const SUPERADMIN_UPLOAD_PATHS: ReadonlySet<string> = new Set([
  '/api/superadmin/master-data/check',
  '/api/superadmin/master-data/run',
]);
const UPLOAD_BODY_LIMIT = 2 * MAX_UPLOAD_BASE64 + 2 * MAX_JSON_UPLOAD_CHARS + 64 * 1024;

const fileName = z.string().trim().min(1).max(255);
const xlsxUpload = z
  .object({ fileName, fileBase64: z.string().min(1).max(MAX_UPLOAD_BASE64) })
  .strict();
const jsonUpload = z
  .object({ fileName, text: z.string().min(1).max(MAX_JSON_UPLOAD_CHARS) })
  .strict();
const uploads = {
  geography: xlsxUpload,
  voters: xlsxUpload,
  fixes: jsonUpload.optional(),
  psNames: jsonUpload.optional(),
  noFixes: z.boolean().optional(),
};
/** Inside the 15-minute confirm window the password may be left out. */
const optionalPassword = password.optional();
const masterCheck = z.object(uploads).strict();
const masterRun = z
  .object({ ...uploads, password: optionalPassword, confirmText: z.literal('RESET') })
  .strict();
const resetBody = z
  .object({ password: optionalPassword, confirmText: z.literal('RESET') })
  .strict();
const dmPasswordBody = z.object({ password: optionalPassword }).strict();
const emptyBody = z.object({}).strict();
const emailBody = z.object({ email: z.string().trim().max(190) }).strict();
const voters = z.number().int().min(0).max(1_000_000);
const boothAddBody = z
  .object({
    psId: z.number().int().positive(),
    boothNo: z.number().int().min(1).max(65_535),
    nameHindi: z.string().max(600),
    nameEnglish: z.string().max(600).nullable(),
    psWardNo: z.number().int().min(1).max(65_535),
    zpWardNo: z.number().int().min(1).max(65_535),
    votersMale: voters,
    votersFemale: voters,
    votersOther: voters,
  })
  .strict();
const boothDeleteBody = z
  .object({ password: optionalPassword, confirmText: z.string().max(10) })
  .strict();
const lockBody = z.discriminatedUnion('on', [
  z.object({ on: z.literal(true) }).strict(),
  z
    .object({ on: z.literal(false), password: optionalPassword, confirmText: z.literal('UNLOCK') })
    .strict(),
]);
const psQuery = z.object({ psId: idParam }).strict();
const noQuery = z.object({}).strict();

export function superAdminRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  router.use(requireRole('SUPER_ADMIN'));
  // Only after the role check: the large upload bodies are read only for the Super Admin.
  const uploadJson = express.json({ limit: UPLOAD_BODY_LIMIT });

  router.get('/overview', async (req, res) => {
    parse(noQuery, req.query);
    noStore(res);
    res.json(await overview(pool, config, req));
  });

  // ---- DM account (only the new password needs the password)
  router.post('/dm/reset-password', async (req, res) => {
    const body = parse(dmPasswordBody, req.body);
    const out = await resetDmPassword(pool, config, req, actor(req), body.password);
    noStore(res);
    res.json(out);
  });
  router.post('/dm/unlock', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    res.json(await unlockDm(pool, config, actor(req)));
  });
  router.post('/dm/email', async (req, res) => {
    const body = parse(emailBody, req.body);
    res.json(await setDmEmail(pool, config, actor(req), body.email));
  });

  // ---- test-data reset
  router.post('/test-data/reset', async (req, res) => {
    const body = parse(resetBody, req.body);
    res.json(
      await busyAsConflict(() => resetTestData(pool, config, req, actor(req), body.password)),
    );
  });

  // ---- master-data replace (dry run first)
  router.post('/master-data/check', uploadJson, async (req, res) => {
    const body = parse(masterCheck, req.body);
    res.json(await checkMasterData(pool, config, actor(req), body));
  });
  router.post('/master-data/run', uploadJson, async (req, res) => {
    const { password: pw, confirmText: _confirm, ...files } = parse(masterRun, req.body);
    res.json(
      await busyAsConflict(() => replaceMasterData(pool, config, req, actor(req), files, pw)),
    );
  });

  // ---- booths: every check runs before the backup, and again inside the transaction
  router.get('/booths', async (req, res) => {
    const q = parse(psQuery, req.query);
    res.json({ booths: await listBooths(pool, q.psId) });
  });
  router.get('/wards', async (req, res) => {
    const q = parse(psQuery, req.query);
    res.json(await wardsForBooths(pool, q.psId));
  });
  router.post('/booths/add', async (req, res) => {
    const booth = parse(boothAddBody, req.body);
    const who = actor(req);
    await checkBoothAdd(pool, booth);
    const backupFile = await backupNow(config, pool, 'booth-add');
    const boothId = await busyAsConflict(() =>
      addBooth(pool, { userId: who.user.id, ip: who.ip }, booth),
    );
    res.status(201).json({ boothId, backupFile });
  });
  router.post('/booths/:boothId/delete', async (req, res) => {
    const boothId = parse(idParam, req.params.boothId);
    const body = parse(boothDeleteBody, req.body);
    const who = actor(req);
    await checkBoothDelete(pool, boothId, body.confirmText);
    await confirmDanger(pool, req, who, body.password);
    const backupFile = await backupNow(config, pool, 'booth-delete');
    await busyAsConflict(() =>
      deleteBooth(pool, { userId: who.user.id, ip: who.ip }, boothId, body.confirmText),
    );
    res.json({ ok: true, backupFile });
  });

  // ---- counting lock (ON: a plain confirm; OFF: password + "UNLOCK")
  router.post('/counting-lock', async (req, res) => {
    const body = parse(lockBody, req.body);
    const who = actor(req);
    if (!body.on) await confirmDanger(pool, req, who, body.password);
    await busyAsConflict(() => setCountingLock(pool, who, body.on));
    res.json({ ok: true, countingLocked: body.on });
  });

  // ---- sample files
  router.get('/samples/:name', async (req, res) => {
    const name = req.params.name;
    if (!(SAMPLE_NAMES as readonly string[]).includes(name)) throw new ApiError(404, 'NOT_FOUND');
    const file = await sampleFile(name as SampleName);
    noStore(res);
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.data);
  });

  return router;
}
