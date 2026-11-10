// /api/admin/screen-keys — "स्क्रीन सुरक्षा (Screen Keys)": the DM's screen access keys. DM only
// (requireRole; PS_RO / ZP_RO get 403, the Super Admin is stopped by superAdminGuard). The POST
// paths are on the DM write allow-list (middleware/auth.ts). Every write is audited (never the key).
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { actor, idParam, noStore, parse } from '../admin/http.js';
import type { ScreenAccess } from './screen-access.js';
import {
  createScreenKey,
  listScreenKeys,
  openPreviewSession,
  renewScreenKey,
  revokeScreenKey,
} from './screen-keys.service.js';

const noQuery = z.object({}).strict();
const emptyBody = z.object({}).strict();
/** "YYYY-MM-DDTHH:MM" as a datetime-local input sends it (IST). */
const localDateTime = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/);
const createBody = z
  .object({
    label: z
      .string()
      .transform((v) => v.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1).max(60)),
    expiresAt: localDateTime.nullable(),
  })
  .strict();

export function screenKeysRouter(access: ScreenAccess): Router {
  const router = Router();
  router.use(requireRole('DM'));
  const { pool, secrets } = access;

  router.get('/', async (req, res) => {
    parse(noQuery, req.query);
    noStore(res);
    res.json({ keys: await listScreenKeys(pool, secrets.vaultKey) });
  });

  router.post('/create', async (req, res) => {
    const body = parse(createBody, req.body);
    const key = await createScreenKey(pool, actor(req), body, secrets);
    noStore(res);
    res.status(201).json({ key });
  });

  router.post('/:keyId/revoke', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const id = parse(idParam, req.params.keyId);
    await revokeScreenKey(pool, actor(req), id);
    access.endKey(id);
    res.json({ ok: true });
  });

  router.post('/:keyId/renew', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const id = parse(idParam, req.params.keyId);
    const key = await renewScreenKey(pool, actor(req), id, secrets);
    access.endKey(id);
    noStore(res);
    res.status(201).json({ key });
  });

  /** The DM's own preview: this browser may open the screens without typing a key. */
  router.post('/preview', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const { previewMaxAgeMs } = access.settings;
    const session = await openPreviewSession(pool, actor(req), previewMaxAgeMs);
    access.setCookie(res, session.token, previewMaxAgeMs);
    noStore(res);
    res.json({ ok: true });
  });

  return router;
}
