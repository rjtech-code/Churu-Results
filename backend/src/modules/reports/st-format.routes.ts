// /api/st-format — the State Election Commission "ST. FORMAT" returns (Excel, official templates).
//   ZP file: the DM and the ZP_RO.
//   PS file: the DM (all PS, or ?ps=<id>) and a PS_RO (always their own PS only; another ?ps is 403).
// Every other role 403, logged out 401. GET only. Every download is audited (REPORT_EXPORTED).
import { Router } from 'express';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { idParam, parse } from '../admin/http.js';
import { readPsNames, readStFormatPs, readStFormatZp } from './st-format.data.js';
import { psStFileName, readPsTemplate, writePsStFormat } from './st-format-ps.xlsx.js';
import { ZP_ST_FILE_NAME, readZpTemplate, writeZpStFormat } from './st-format.xlsx.js';

const noQuery = z.object({}).strict();
const psQuery = z.object({ ps: idParam.optional() }).strict();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The PS this request may see: a PS_RO only their own (server side), the DM any or all. */
function psScope(req: Request): number | null {
  const q = parse(psQuery, req.query);
  const user = req.user;
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
  if (user.role === 'PS_RO') {
    const own = user.panchayatSamitiId;
    if (own === null || (q.ps !== undefined && q.ps !== own)) throw new ApiError(403, 'FORBIDDEN');
    return own;
  }
  return q.ps ?? null;
}

export function stFormatRouter(pool: Pool): Router {
  const router = Router();
  const zpRoles = requireRole('DM', 'ZP_RO');
  const psRoles = requireRole('DM', 'PS_RO');

  // The warnings shown above the download button (never written into the file).
  router.get('/zp/summary', zpRoles, async (req, res) => {
    parse(noQuery, req.query);
    const data = await readStFormatZp(pool);
    res.set('Cache-Control', 'no-store').json({ warnings: data.warnings });
  });

  router.get('/zp.xlsx', zpRoles, async (req, res) => {
    parse(noQuery, req.query);
    if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
    const data = await readStFormatZp(pool);
    const body = await writeZpStFormat(data, await readZpTemplate());
    await writeAudit(pool, {
      userId: req.user.id,
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: {
        section: 'st-format-zp',
        format: 'xlsx',
        wards_included: data.warnings.includedWards,
        wards_excluded: data.warnings.excludedWards.length,
      },
      ip: req.ip ?? null,
    });
    res
      .status(200)
      .set({
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="${ZP_ST_FILE_NAME}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  // The PS list for the DM's selector (English names, as in the file).
  router.get('/ps/list', psRoles, async (req, res) => {
    parse(noQuery, req.query);
    const scope = req.user?.role === 'PS_RO' ? req.user.panchayatSamitiId : null;
    const list = (await readPsNames(pool)).filter((p) => scope === null || p.id === scope);
    res.set('Cache-Control', 'no-store').json({ ps: list });
  });

  router.get('/ps/summary', psRoles, async (req, res) => {
    const psId = psScope(req);
    const data = await readStFormatPs(pool, psId);
    res.set('Cache-Control', 'no-store').json({ psId, warnings: data.warnings });
  });

  router.get('/ps.xlsx', psRoles, async (req, res) => {
    const psId = psScope(req);
    if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
    const data = await readStFormatPs(pool, psId);
    const body = await writePsStFormat(data, await readPsTemplate());
    await writeAudit(pool, {
      userId: req.user.id,
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: {
        section: 'st-format-ps',
        format: 'xlsx',
        ps_id: psId,
        wards_included: data.warnings.includedWards,
        wards_excluded: data.warnings.excludedWards.length,
      },
      ip: req.ip ?? null,
    });
    const ps = data.ps[0];
    const file = psStFileName(
      psId === null || ps === undefined ? null : { id: ps.psId, nameEnglish: ps.psName },
    );
    res
      .status(200)
      .set({
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  return router;
}
