// /api/ward-forms — the official forms of one ward as PDF: Part-II (Result of Counting) and
// Prarup-7. The DM (any ward) and the ward's own RO (PS_RO: PS wards of their PS; ZP_RO: ZP wards);
// anyone else 403. Only declared wards (or Prarup-7 of an uncontested ward); every download is
// audited (REPORT_EXPORTED). GET only, read only.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { canReadWard } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import { FormDoesNotFitError } from '../../services/pdf/fit.js';
import { REFUSAL_STATUS, formRefusal } from '../../services/ward-forms/eligibility.js';
import type { FormSource } from '../../services/ward-forms/form-data.js';
import { mapPart2 } from '../../services/ward-forms/map-part2.js';
import { mapPrarup7 } from '../../services/ward-forms/map-prarup7.js';
import { renderPart2 } from '../../services/ward-forms/render-part2.js';
import { renderPrarup7 } from '../../services/ward-forms/render-prarup7.js';
import {
  PART2_TEMPLATES,
  PRARUP7_TEMPLATES,
  WARD_FORMS,
  WARD_FORM_NAMES,
} from '../../services/ward-forms/templates/registry.js';
import type { WardFormName } from '../../services/ward-forms/templates/registry.js';
import { idParam, parse } from '../admin/http.js';
import { readFormSource, readFormWard } from './ward-forms.data.js';

const noQuery = z.object({}).strict();
const PDF = 'application/pdf';

/** The ward id of a request this user may read: 404 unknown ward, 403 not their ward. */
async function allowedWard(pool: Pool, req: Request): Promise<number> {
  parse(noQuery, req.query);
  const wardId = parse(idParam, req.params.wardId);
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
  if ((await readFormWard(pool, wardId)) === null) throw new ApiError(404, 'NOT_FOUND');
  if (!(await canReadWard(pool, req.user, wardId))) throw new ApiError(403, 'FORBIDDEN');
  return wardId;
}

const refusal = (form: WardFormName, src: FormSource) =>
  formRefusal(form, src.result, src.candidates.length);

/** The PDF bytes; a ward whose text cannot fit the one page is 409. */
async function render(form: WardFormName, src: FormSource): Promise<Buffer> {
  try {
    if (form === 'part2') {
      const t = PART2_TEMPLATES[src.ward.kind];
      return await renderPart2(mapPart2(src, t), t);
    }
    const t = PRARUP7_TEMPLATES[src.ward.kind];
    return await renderPrarup7(mapPrarup7(src, t), t);
  } catch (err) {
    if (err instanceof FormDoesNotFitError) throw new ApiError(409, 'FORM_DOES_NOT_FIT');
    throw err;
  }
}

const fileName = (form: WardFormName, src: FormSource): string =>
  `${WARD_FORMS[form].fileStem}_${src.ward.kind}-ward-${String(src.ward.wardNo)}_${String(src.ward.id)}.pdf`;

interface Export {
  body: Buffer;
  contentType: string;
  fileName: string;
  /** The audited ward and what was exported. */
  wardId: number;
  details: Record<string, unknown>;
}

/** Audits the download (REPORT_EXPORTED), then sends the file, never cached. */
async function sendExport(pool: Pool, req: Request, res: Response, e: Export): Promise<void> {
  await writeAudit(pool, {
    userId: req.user?.id ?? null,
    action: 'REPORT_EXPORTED',
    entity: 'ward',
    entityId: e.wardId,
    newValue: e.details,
    ip: req.ip ?? null,
  });
  res
    .status(200)
    .set({
      'Content-Type': e.contentType,
      'Content-Disposition': `attachment; filename="${e.fileName}"`,
      'Cache-Control': 'no-store',
    })
    .send(e.body);
}

/** GET /:wardId/<form>.pdf */
function download(pool: Pool, form: WardFormName): RequestHandler {
  return async (req, res) => {
    const wardId = await allowedWard(pool, req);
    const src = await readFormSource(pool, wardId);
    const reason = refusal(form, src);
    if (reason !== null) throw new ApiError(REFUSAL_STATUS, reason);
    await sendExport(pool, req, res, {
      body: await render(form, src),
      contentType: PDF,
      fileName: fileName(form, src),
      wardId,
      details: {
        section: WARD_FORMS[form].auditSection,
        format: 'pdf',
        ward_id: wardId,
        declaration_version: src.result.declaration?.version ?? null,
      },
    });
  };
}

/** GET /:wardId — which forms this ward offers (the page shows only those buttons). */
function availability(pool: Pool): RequestHandler {
  return async (req, res) => {
    const src = await readFormSource(pool, await allowedWard(pool, req));
    const forms = Object.fromEntries(
      WARD_FORM_NAMES.map((form) => {
        const reason = refusal(form, src);
        return [form, { available: reason === null, reason }];
      }),
    );
    res.set('Cache-Control', 'no-store').json({ forms });
  };
}

export function wardFormsRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireRole('DM', 'PS_RO', 'ZP_RO'));
  router.get('/:wardId', availability(pool));
  for (const form of WARD_FORM_NAMES) router.get(`/:wardId/${form}.pdf`, download(pool, form));
  return router;
}
