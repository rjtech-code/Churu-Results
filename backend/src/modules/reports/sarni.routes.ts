// /api/sarni — the two official summary tables of elected members, as Excel:
//   सारणी-"क" (सदस्य जिला परिषद): one file for the district — the DM and the ZP_RO.
//   सारणी-"ख" (सदस्य पंचायत समिति): one file per Panchayat Samiti — the DM (any, with ?ps=<id>)
//   and a PS_RO (their own Panchayat Samiti only; another ?ps is 403).
// Exactly the permissions and the audit row of the ST Format downloads. GET only, read only.
import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { buildSarni } from '../../services/sarni.js';
import type { Sarni } from '../../services/sarni.js';
import { sarniFileName, writeSarni } from '../../services/sarni.xlsx.js';
import { idParam, parse } from '../admin/http.js';
import { readReportData } from './reports.data.js';
import { readPsNames } from './st-format.data.js';

const noQuery = z.object({}).strict();
const psQuery = z.object({ ps: idParam.optional() }).strict();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The Panchayat Samiti this request may have: a PS_RO only its own, the DM the one it asked for. */
function psScope(req: Request): number {
  const q = parse(psQuery, req.query);
  const user = req.user;
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
  if (user.role === 'PS_RO') {
    const own = user.panchayatSamitiId;
    if (own === null || (q.ps !== undefined && q.ps !== own)) throw new ApiError(403, 'FORBIDDEN');
    return own;
  }
  // The table is per Panchayat Samiti, so the DM names one.
  if (q.ps === undefined) throw new ApiError(400, 'VALIDATION_FAILED');
  return q.ps;
}

async function send(
  pool: Pool,
  req: Request,
  res: Parameters<Parameters<Router['get']>[1]>[1],
  data: Sarni,
  section: 'sarni-k' | 'sarni-kh',
  psId: number | null,
  psNameEnglish: string | null = null,
): Promise<void> {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
  const body = await writeSarni(data);
  await writeAudit(pool, {
    userId: req.user.id,
    action: 'REPORT_EXPORTED',
    entity: 'report',
    entityId: null,
    newValue: {
      section,
      format: 'xlsx',
      ps_id: psId,
      wards: data.rows.length,
      decided: data.decided,
      unmapped_categories: data.unmappedCategories.length,
    },
    ip: req.ip ?? null,
  });
  res
    .status(200)
    .set({
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="${sarniFileName(data, psNameEnglish)}"`,
      'Cache-Control': 'no-store',
    })
    .send(body);
}

export function sarniRouter(pool: Pool): Router {
  const router = Router();
  const zpRoles = requireRole('DM', 'ZP_RO');
  const psRoles = requireRole('DM', 'PS_RO');

  /** What the page shows beside the button: how much is still pending, and odd classifications. */
  router.get('/zp/summary', zpRoles, async (req, res) => {
    parse(noQuery, req.query);
    const data = buildSarni(await readReportData(pool), 'ZP');
    res.set('Cache-Control', 'no-store').json({
      wards: data.rows.length,
      decided: data.decided,
      unmappedCategories: data.unmappedCategories,
    });
  });

  router.get('/zp.xlsx', zpRoles, async (req, res) => {
    parse(noQuery, req.query);
    await send(pool, req, res, buildSarni(await readReportData(pool), 'ZP'), 'sarni-k', null);
  });

  router.get('/ps/summary', psRoles, async (req, res) => {
    const psId = psScope(req);
    const data = buildSarni(await readReportData(pool), { psId });
    if (data.psName === null) throw new ApiError(404, 'NOT_FOUND');
    res.set('Cache-Control', 'no-store').json({
      psId,
      psName: data.psName,
      wards: data.rows.length,
      decided: data.decided,
      unmappedCategories: data.unmappedCategories,
    });
  });

  router.get('/ps.xlsx', psRoles, async (req, res) => {
    const psId = psScope(req);
    const data = buildSarni(await readReportData(pool), { psId });
    if (data.psName === null) throw new ApiError(404, 'NOT_FOUND');
    const english = (await readPsNames(pool)).find((p) => p.id === psId)?.nameEnglish ?? null;
    await send(pool, req, res, data, 'sarni-kh', psId, english);
  });

  return router;
}
