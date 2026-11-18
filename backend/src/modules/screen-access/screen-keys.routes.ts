// /api/superadmin/screen-keys — "स्क्रीन सुरक्षा (Screen Keys)": the access keys of the three public
// TV screens. SUPER_ADMIN only (Nov 2026: every screen control sits in the setup panel, so the DM has
// no screen route at all; requireRole here, and the global dmWriteGuard / observerGuard outside).
// Mounted inside superAdminRouter, which already checks the role. Every write is audited (never the
// key). A screen's state is read here as well, so the panel can show on/off beside each key.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { isScreenNumber } from '../../services/setup/screen-power.js';
import { ApiError } from '../../middleware/errors.js';
import { screenPowerRows } from '../superadmin/superadmin.service.js';
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
  router.use(requireRole('SUPER_ADMIN'));
  const { pool, secrets } = access;

  router.get('/', async (req, res) => {
    parse(noQuery, req.query);
    noStore(res);
    res.json({
      keys: await listScreenKeys(pool, secrets.vaultKey),
      screens: await screenPowerRows(pool),
    });
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

  /**
   * The Super Admin's own preview: this browser may open ONE screen without typing a key. Like a
   * key session it is for that screen only, and it ends when the screen is switched off or on.
   */
  router.post('/preview/:screenNo', async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const screenNo = req.params.screenNo;
    if (!isScreenNumber(screenNo)) throw new ApiError(404, 'NOT_FOUND');
    const { previewMaxAgeMs } = access.settings;
    const session = await openPreviewSession(pool, actor(req), screenNo, previewMaxAgeMs);
    access.setCookie(res, screenNo, session.token, previewMaxAgeMs);
    noStore(res);
    res.json({ ok: true });
  });

  return router;
}
