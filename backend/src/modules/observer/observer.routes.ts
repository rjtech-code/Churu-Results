// /api/observer — the read-only executive dashboard for OBSERVER accounts (state / Election
// Commission level officers). GET only; OBSERVER only (every other role is 403 here, and an
// OBSERVER is 403 everywhere else — see observerGuard in middleware/auth.ts). Every figure is a
// projection of the SAME objects the DM reports are rendered from (observer.cache.ts); nothing is
// recomputed. Viewing is not audited (like the DM reports); downloads are.
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { renderCountingStatusPdf } from '../../services/counting-status.pdf.js';
import { scopeReport } from '../../services/counting-status.scope.js';
import type { ScopedReport } from '../../services/counting-status.scope.js';
import { boothCsvRows, wardCsvRows, zpByPsCsvRows } from '../reports/counting-status.export.js';
import { istStampForFile, toCsv } from '../reports/csv.js';
import { wardDetail } from '../reports/ward-detail.js';
import { ObserverCache } from './observer.cache.js';
import {
  overviewView,
  psDetailView,
  psListView,
  searchView,
  wardDetailView,
  winnersView,
  womenView,
  zpView,
} from './observer.views.js';

const positiveId = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number);
const searchQuery = z.object({ q: z.string().min(1).max(100) }).strict();

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(400, 'VALIDATION_FAILED');
  return r.data;
}

/** The booth rows with the officer column blanked: an observer never sees who entered a sheet. */
function withoutOfficerNames(report: ScopedReport): ScopedReport {
  return { ...report, booths: report.booths.map((b) => ({ ...b, enteredBy: null })) };
}

type DownloadFormat = 'pdf' | 'csv-ward' | 'csv-booth' | 'csv-zp-ps';

export function observerRouter(pool: Pool, cache = new ObserverCache(pool)): Router {
  const router = Router();
  router.use(requireRole('OBSERVER'));

  const noStore = (res: Response) => res.set('Cache-Control', 'no-store');

  router.get('/overview', async (_req, res) => {
    noStore(res).json(overviewView(await cache.get()));
  });

  router.get('/ps', async (_req, res) => {
    noStore(res).json(psListView((await cache.get()).status));
  });

  router.get('/ps/:psId', async (req, res) => {
    const view = psDetailView((await cache.get()).status, parse(positiveId, req.params.psId));
    if (view === null) throw new ApiError(404, 'NOT_FOUND');
    noStore(res).json(view);
  });

  router.get('/zp', async (_req, res) => {
    noStore(res).json(zpView((await cache.get()).status));
  });

  router.get('/wards/:wardId', async (req, res) => {
    // Fresh consistent read (same reader as the DM ward detail), then the sanitized copy.
    const detail = await wardDetail(pool, parse(positiveId, req.params.wardId));
    noStore(res).json(wardDetailView(detail));
  });

  router.get('/winners', async (_req, res) => {
    noStore(res).json(winnersView(await cache.get()));
  });

  router.get('/women', async (_req, res) => {
    noStore(res).json(womenView(await cache.get()));
  });

  router.get('/search', async (req, res) => {
    const { q } = parse(searchQuery, req.query);
    noStore(res).json({ hits: searchView(await cache.get(), q) });
  });

  // ---- Downloads: the existing Counting Status PDF / CSVs for the whole district, with officer
  // names blanked. Every download is audited with the observer's user id.
  const sendDownload = async (req: Request, res: Response, format: DownloadFormat) => {
    if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
    const build = await cache.get();
    const report = withoutOfficerNames(
      scopeReport(build.status, { level: 'DISTRICT', status: 'ALL' }),
    );
    const body =
      format === 'pdf'
        ? await renderCountingStatusPdf(report)
        : toCsv(
            format === 'csv-ward'
              ? wardCsvRows(report)
              : format === 'csv-booth'
                ? boothCsvRows(report)
                : zpByPsCsvRows(report),
          );
    await writeAudit(pool, {
      userId: req.user.id,
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: { section: 'observer-counting-status', format, reportTime: report.asOf },
      ip: req.ip ?? null,
    });
    const stamp = istStampForFile(new Date(report.asOf));
    const csvName = { 'csv-ward': 'wards', 'csv-booth': 'booths', 'csv-zp-ps': 'zp-by-ps' } as const;
    const file =
      format === 'pdf'
        ? `counting-status-district-${stamp}-IST.pdf`
        : `counting-status-district-${csvName[format]}-${stamp}-IST.csv`;
    res
      .status(200)
      .set({
        'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  };
  router.get('/reports/counting-status.pdf', (req, res) => sendDownload(req, res, 'pdf'));
  router.get('/reports/counting-status/wards.csv', (req, res) => sendDownload(req, res, 'csv-ward'));
  router.get('/reports/counting-status/booths.csv', (req, res) =>
    sendDownload(req, res, 'csv-booth'),
  );
  router.get('/reports/counting-status/zp-by-ps.csv', (req, res) =>
    sendDownload(req, res, 'csv-zp-ps'),
  );

  return router;
}
