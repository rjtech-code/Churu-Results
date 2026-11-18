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
import { canReadWard, checkMemoScope } from '../../services/access.js';
import type { MemoScope } from '../../services/access.js';
import { writeAudit } from '../../services/audit.js';
import { FormDoesNotFitError } from '../../services/pdf/fit.js';
import { REFUSAL_STATUS, formRefusal } from '../../services/ward-forms/eligibility.js';
import type { FormSource } from '../../services/ward-forms/form-data.js';
import { boothLabel } from '../../services/booth-no.js';
import { renderCheckMemoXlsx } from '../../services/ward-forms/render-check-memo.xlsx.js';
import {
  mapBlankBoothPart2,
  mapBoothPart2,
  mapPart2,
} from '../../services/ward-forms/map-part2.js';
import { mapBlankPrarup7, mapPrarup7 } from '../../services/ward-forms/map-prarup7.js';
import { renderPart2 } from '../../services/ward-forms/render-part2.js';
import { renderPart2Xlsx } from '../../services/ward-forms/render-part2.xlsx.js';
import { renderPrarup7 } from '../../services/ward-forms/render-prarup7.js';
import {
  PART2_TEMPLATES,
  PRARUP7_TEMPLATES,
  WARD_FORMS,
  WARD_FORM_NAMES,
} from '../../services/ward-forms/templates/registry.js';
import type { WardFormName } from '../../services/ward-forms/templates/registry.js';
import type { AuthUser } from '../../types/auth.js';
import { idParam, parse } from '../admin/http.js';
import { readCheckMemo } from './check-memo.data.js';
import { readPsNames } from './st-format.data.js';
import {
  readBoothBlank,
  readBoothScope,
  readBoothSheet,
  readFormSource,
  readFormWard,
} from './ward-forms.data.js';

const noQuery = z.object({}).strict();
const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The booth प्रारूप–14 is offered in both formats; same data, same words, same permissions. */
export type BoothFormFormat = 'pdf' | 'xlsx';

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

/**
 * The Returning Officer's name printed under the Prarup-7 signature: the downloading RO's own
 * users.full_name. A DM download keeps the line blank (as before; to be decided by the DEO).
 */
export const roNameFor = (user: AuthUser): string | null =>
  user.role === 'DM' ? null : user.fullName;

/** The PDF bytes; a ward whose text cannot fit the one page is 409. */
async function render(form: WardFormName, src: FormSource, user: AuthUser): Promise<Buffer> {
  try {
    if (form === 'part2') {
      const t = PART2_TEMPLATES[src.ward.kind];
      return await renderPart2(mapPart2(src, t), t);
    }
    const t = PRARUP7_TEMPLATES[src.ward.kind];
    return await renderPrarup7(mapPrarup7(src, t, roNameFor(user)), t);
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
    const user = req.user;
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
    const src = await readFormSource(pool, wardId);
    const reason = refusal(form, src);
    if (reason !== null) throw new ApiError(REFUSAL_STATUS, reason);
    await sendExport(pool, req, res, {
      body: await render(form, src, user),
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

/**
 * GET /:wardId/prarup7-blank.pdf — the same प्ररूप–7 sheet with the counting results left empty, to
 * print and fill in by hand.
 *
 * Offered for ANY ward the user may read, whatever its status: blank forms are printed before there
 * are results, so the filled form's "declared only" rule must not apply. The permissions, the audit
 * row and the one-page rule are the filled form's; a ballot too long for the page is refused the
 * same way it is refused there.
 */
function prarup7BlankDownload(pool: Pool): RequestHandler {
  return async (req, res) => {
    const wardId = await allowedWard(pool, req);
    const user = req.user;
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
    const src = await readFormSource(pool, wardId);
    const kind = src.ward.kind;
    if (src.candidates.length > WARD_FORMS.prarup7.capacity(kind)) {
      throw new ApiError(REFUSAL_STATUS, 'TOO_MANY_CANDIDATES');
    }
    const t = PRARUP7_TEMPLATES[kind];
    let body: Buffer;
    try {
      body = await renderPrarup7(mapBlankPrarup7(src, t, roNameFor(user)), t);
    } catch (err) {
      if (err instanceof FormDoesNotFitError) throw new ApiError(409, 'FORM_DOES_NOT_FIT');
      throw err;
    }
    await sendExport(pool, req, res, {
      body,
      contentType: PDF,
      fileName: `${WARD_FORMS.prarup7.fileStem}_Blank_${kind}-ward-${String(src.ward.wardNo)}_${String(wardId)}.pdf`,
      wardId,
      details: {
        section: `${WARD_FORMS.prarup7.auditSection}-blank`,
        format: 'pdf',
        ward_id: wardId,
        candidates: src.candidates.length,
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

const boothParams = z.object({ boothId: idParam, ballotFor: z.enum(['PS', 'ZP']) });

/**
 * Who may print a booth's प्रारूप–14: the DM any booth; the PS_RO both ballots of the booths of
 * their own PS (they enter them); the ZP_RO the ZP ballot of any booth. Nobody else.
 */
export function boothFormAllowed(
  user: AuthUser,
  boothPsId: number,
  ballotFor: 'PS' | 'ZP',
): boolean {
  switch (user.role) {
    case 'DM':
      return true;
    case 'PS_RO':
      return user.panchayatSamitiId !== null && user.panchayatSamitiId === boothPsId;
    case 'ZP_RO':
      return ballotFor === 'ZP';
    case 'SUPER_ADMIN':
    case 'OBSERVER':
      return false;
  }
}

/**
 * GET /booths/:boothId/:ballotFor/prarup14.(pdf|xlsx) — one booth's live entry as प्रारूप–14 भाग–II.
 * Both formats share this one handler, so the permissions, the data, the words and the audit row
 * can never drift apart; only the renderer, the content type and the extension differ.
 */
function boothDownload(pool: Pool, format: BoothFormFormat): RequestHandler {
  return async (req, res) => {
    parse(noQuery, req.query);
    const { boothId, ballotFor } = parse(boothParams, req.params);
    const user = req.user;
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
    const scope = await readBoothScope(pool, boothId);
    if (scope === null) throw new ApiError(404, 'NOT_FOUND');
    if (!boothFormAllowed(user, scope.psId, ballotFor)) throw new ApiError(403, 'FORBIDDEN');
    const { head, sheet, wardId, entryId } = await readBoothSheet(pool, boothId, ballotFor);
    const t = PART2_TEMPLATES[head.kind];
    const data = mapBoothPart2(head, sheet, t);
    let body: Buffer;
    try {
      // The .xlsx has no one-page limit, so only the PDF can refuse to fit.
      body = format === 'pdf' ? await renderPart2(data, t) : await renderPart2Xlsx(data, t);
    } catch (err) {
      if (err instanceof FormDoesNotFitError) throw new ApiError(409, 'FORM_DOES_NOT_FIT');
      throw err;
    }
    const label = boothLabel(sheet.boothNo, sheet.boothSuffix);
    await sendExport(pool, req, res, {
      body,
      contentType: format === 'pdf' ? PDF : XLSX,
      fileName: `Prarup14_${head.kind}_${String(head.wardNo)}_Booth${label}.${format}`,
      wardId,
      details: {
        section: 'booth-form-prarup14',
        format,
        ward_id: wardId,
        booth_id: boothId,
        ballot_for: ballotFor,
        entry_id: entryId,
      },
    });
  };
}

/**
 * GET /booths/:boothId/:ballotFor/prarup14-blank.(pdf|xlsx) — the SAME प्रारूप–14 भाग–II sheet with
 * the figures left out, to print and fill in by hand at the counting table.
 *
 * Unlike the filled sheet it needs NO entry: blank forms are printed before counting starts, so any
 * booth of the ward prints, entered or not. Everything else — who may print it, the words, the audit
 * row — is the filled sheet's, so the two can never drift apart.
 */
function boothBlankDownload(pool: Pool, format: BoothFormFormat): RequestHandler {
  return async (req, res) => {
    parse(noQuery, req.query);
    const { boothId, ballotFor } = parse(boothParams, req.params);
    const user = req.user;
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
    const scope = await readBoothScope(pool, boothId);
    if (scope === null) throw new ApiError(404, 'NOT_FOUND');
    if (!boothFormAllowed(user, scope.psId, ballotFor)) throw new ApiError(403, 'FORBIDDEN');
    const { head, sheet, wardId } = await readBoothBlank(pool, boothId, ballotFor);
    const t = PART2_TEMPLATES[head.kind];
    const data = mapBlankBoothPart2(head, sheet, t);
    let body: Buffer;
    try {
      body = format === 'pdf' ? await renderPart2(data, t) : await renderPart2Xlsx(data, t);
    } catch (err) {
      if (err instanceof FormDoesNotFitError) throw new ApiError(409, 'FORM_DOES_NOT_FIT');
      throw err;
    }
    const label = boothLabel(sheet.boothNo, sheet.boothSuffix);
    await sendExport(pool, req, res, {
      body,
      contentType: format === 'pdf' ? PDF : XLSX,
      fileName: `Prarup14_Blank_${head.kind}_${String(head.wardNo)}_Booth${label}.${format}`,
      wardId,
      details: {
        section: 'booth-form-prarup14-blank',
        format,
        ward_id: wardId,
        booth_id: boothId,
        ballot_for: ballotFor,
        candidates: sheet.candidates.length,
      },
    });
  };
}

/**
 * GET /:wardId/check-memo.xlsx — "अंतिम परिणाम हेतु चेक मीमो" of one ward.
 *
 * Unlike Part-II and Prarup-7 this one is NOT limited to declared wards: its whole purpose is to
 * check the counting as it stands (a partly counted ward prints with empty booth rows).
 *
 * It reaches further than the other ward forms, so it has its own rule (access.ts checkMemoScope)
 * instead of allowedWard(): the DM and the ZP_RO get the whole ward, and a PS_RO gets — besides
 * their own PS wards — the booths of THEIR Panchayat Samiti in any ZP ward, with no postal row and
 * with the notice on the sheet itself. Same audit row as every other download.
 */
function checkMemoDownload(pool: Pool): RequestHandler {
  return async (req, res) => {
    parse(noQuery, req.query);
    const wardId = parse(idParam, req.params.wardId);
    const user = req.user;
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
    const ward = await readFormWard(pool, wardId);
    if (ward === null) throw new ApiError(404, 'NOT_FOUND');
    // The scope comes from the SESSION only. There is no ?ps on this route (noQuery refuses any
    // query string), so changing the ward id can move an officer between wards, never between
    // Panchayat Samitis.
    const scope = checkMemoScope(user, {
      wardType: ward.kind,
      panchayatSamitiId: ward.psId,
    });
    if (scope === null) throw new ApiError(403, 'FORBIDDEN');
    const data = await readCheckMemo(pool, wardId, scope);
    await sendExport(pool, req, res, {
      body: await renderCheckMemoXlsx(data),
      contentType: XLSX,
      fileName: `CheckMemo_${data.kind}_${String(data.wardNo)}${await psFileTag(pool, scope)}.xlsx`,
      wardId,
      details: {
        section: 'check-memo',
        format: 'xlsx',
        ward_id: wardId,
        ward_kind: data.kind,
        ward_no: data.wardNo,
        booths: data.booths.length,
        candidates: data.candidates.length,
        // Which Panchayat Samiti's booths this copy held, and whether it was the partial sheet.
        ps_id: scope.kind === 'PS' ? scope.psId : null,
        partial: scope.kind === 'PS',
      },
    });
  };
}

/**
 * `_PS-Rajgarh` for a Panchayat Samiti's own copy, '' for the whole ward's sheet. The English name,
 * stripped to A-Z0-9: a Content-Disposition file name must stay ASCII (same rule as सारणी-"ख").
 */
async function psFileTag(pool: Pool, scope: MemoScope): Promise<string> {
  if (scope.kind === 'FULL') return '';
  const name = (await readPsNames(pool)).find((p) => p.id === scope.psId)?.nameEnglish ?? '';
  const safe = name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `_PS-${safe === '' ? String(scope.psId) : safe}`;
}

export function wardFormsRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireRole('DM', 'PS_RO', 'ZP_RO'));
  router.get('/booths/:boothId/:ballotFor/prarup14.pdf', boothDownload(pool, 'pdf'));
  router.get('/booths/:boothId/:ballotFor/prarup14.xlsx', boothDownload(pool, 'xlsx'));
  router.get('/booths/:boothId/:ballotFor/prarup14-blank.pdf', boothBlankDownload(pool, 'pdf'));
  router.get('/booths/:boothId/:ballotFor/prarup14-blank.xlsx', boothBlankDownload(pool, 'xlsx'));
  router.get('/:wardId', availability(pool));
  router.get('/:wardId/prarup7-blank.pdf', prarup7BlankDownload(pool));
  for (const form of WARD_FORM_NAMES) router.get(`/:wardId/${form}.pdf`, download(pool, form));
  router.get('/:wardId/check-memo.xlsx', checkMemoDownload(pool));
  return router;
}
