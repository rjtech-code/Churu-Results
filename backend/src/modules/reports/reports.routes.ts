// /api/reports — the DM's read-only reports (Part 10). DM only: other roles 403, logged out 401.
// Exception: the Counting Status Report is also open to the ZP_RO, scoped on the server to Zila
// Parishad wards only (no PS-ward data through any parameter).
// GET only (the global DM guard refuses every write anyway). Viewing is not audited; exports are.
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { buildReport } from '../../services/reports.js';
import type { ReportSummary, ScopeSections } from '../../services/reports.js';
import { writeSheetToBuffer } from '../../services/master-data/xlsx.js';
import { renderCountingStatusPdf } from '../../services/counting-status.pdf.js';
import {
  STATUS_FILTERS,
  ScopeNotFoundError,
  ZP_RO_LEVELS,
  restrictToZp,
  scopeReport,
} from '../../services/counting-status.scope.js';
import type { ReportScope, ScopedReport } from '../../services/counting-status.scope.js';
import { CANDIDATE_LIST_HEADERS, candidateListRows } from './candidates-list.js';
import { readCountingStatus, readScopeOptions, readWardBooths } from './counting-status.data.js';
import { boothCsvRows, wardCsvRows, zpByPsCsvRows } from './counting-status.export.js';
import { istStampForFile, toCsv } from './csv.js';
import type { Cell } from './csv.js';
import { readReportData } from './reports.data.js';
import { wardDetail } from './ward-detail.js';

export const REPORT_CACHE_MS = 5000;

export const CSV_SECTIONS = [
  'alarms',
  'progress',
  'party-seats',
  'women',
  'reservation',
  'nota',
  'close-contests',
  'lottery',
  'corrections',
  'turnout',
] as const;
type CsvSection = (typeof CSV_SECTIONS)[number];

const exportQuery = z
  .object({
    section: z.enum(CSV_SECTIONS),
    scope: z
      .string()
      .regex(/^(ALL_PS|ZP|PS:[1-9]\d{0,9})$/)
      .optional(),
  })
  .strict();
const wardParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

/** The summary, rebuilt at most every 5 s; concurrent requests share one build. */
export class ReportCache {
  private value: { at: number; summary: ReportSummary } | null = null;
  private inFlight: Promise<ReportSummary> | null = null;

  constructor(private readonly pool: Pool) {}

  async get(): Promise<ReportSummary> {
    const now = Date.now();
    if (this.value !== null && now - this.value.at < REPORT_CACHE_MS) return this.value.summary;
    this.inFlight ??= (async () => {
      try {
        const raw = await readReportData(this.pool);
        const summary = buildReport(raw, { now: new Date() });
        this.value = { at: Date.now(), summary };
        return summary;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}

const H = {
  scope: 'क्षेत्र',
  ward: 'वार्ड',
  party: 'पार्टी',
} as const;
const wardCells = (w: { psName: string | null; kind: string; wardNo: number }): Cell[] => [
  w.kind === 'ZP' ? 'ज़िला परिषद' : (w.psName ?? ''),
  w.wardNo,
];

/** CSV rows of one section. Summary sections: one row per scope; ward lists: each ward once. */
export function csvRows(
  summary: ReportSummary,
  section: CsvSection,
  scope: string | undefined,
): Cell[][] {
  const scopes = summary.scopes.filter((s) => scope === undefined || s.key === scope);
  if (scope !== undefined && scopes.length === 0) throw new ApiError(400, 'VALIDATION_FAILED');
  const per = (fn: (label: string, s: ScopeSections) => Cell[][]) =>
    scopes.flatMap((sc) => {
      const s = summary.sections[sc.key];
      return s === undefined ? [] : fn(sc.label, s);
    });
  // Ward lists: without a scope, PS wards come from ALL_PS and ZP wards from ZP (no duplicates).
  const listScopes = scope === undefined ? ['ALL_PS', 'ZP'] : [scope];
  const lists = <T>(pick: (s: ScopeSections) => T[]) =>
    listScopes.flatMap((k) => {
      const s = summary.sections[k];
      return s === undefined ? [] : pick(s);
    });

  switch (section) {
    case 'alarms':
      return [
        ['प्रकार', 'पंचायत समिति / ज़िला परिषद', H.ward, 'विवरण', 'समय'],
        ...summary.alarms
          .filter((a) => scope === undefined || a.scope === null || a.scope === scope)
          .map((a): Cell[] => [
            a.kind,
            ...(a.ward === null ? ['', null] : wardCells(a.ward)),
            a.detail,
            a.at,
          ]),
      ];
    case 'progress':
      return [
        [
          H.scope,
          'कुल वार्ड',
          'घोषित',
          'निर्विरोध',
          'मतगणना जारी',
          'शुरू नहीं',
          'उम्मीदवार सूची बाकी',
          'उपलब्ध नहीं',
          'बूथ दर्ज',
          'कुल बूथ',
          'डाक मत दर्ज',
          'डाक मत कुल',
        ],
        ...per((label, s) => {
          const p = s.progress;
          return [
            [
              label,
              p.wardsTotal,
              p.declared,
              p.unopposed,
              p.counting,
              p.notStarted,
              p.noCandidates,
              p.unavailable,
              p.boothsEntered,
              p.boothsTotal,
              p.postalEntered,
              p.postalTotal,
            ],
          ];
        }),
      ];
    case 'party-seats':
      return [
        [H.scope, H.party, 'जीते', 'आगे', 'कुल'],
        ...per((label, s) =>
          s.partySeats.map((r): Cell[] => [label, r.party.nameHindi, r.won, r.leading, r.total]),
        ),
      ];
    case 'women':
      return [
        ['पंचायत समिति / ज़िला परिषद', H.ward, 'विजेता', H.party, 'स्थिति'],
        ...lists((s) => s.women.list).map((w): Cell[] => [
          ...wardCells(w.ward),
          w.name,
          w.party.nameHindi,
          w.status,
        ]),
      ];
    case 'reservation':
      return [
        [H.scope, 'आरक्षण वर्ग', 'वार्ड', 'परिणाम घोषित', 'महिला विजेता'],
        ...per((label, s) =>
          (s.reservation ?? []).map((r): Cell[] => [
            label,
            r.category,
            r.wards,
            r.decided,
            r.womenWinners,
          ]),
        ),
      ];
    case 'nota':
      return [
        [H.scope, 'नोटा मत', 'कुल वैध मत'],
        ...per((label, s) => [[label, s.nota.notaVotes, s.nota.totalValidVotes]]),
        [],
        [
          'नोटा को सर्वाधिक मत: पंचायत समिति / ज़िला परिषद',
          H.ward,
          'नोटा मत',
          'सर्वाधिक उम्मीदवार मत',
          'स्थिति',
        ],
        ...lists((s) => s.nota.highest).map((n): Cell[] => [
          ...wardCells(n.ward),
          n.notaVotes,
          n.topCandidateVotes,
          n.status,
        ]),
      ];
    case 'close-contests':
      return [
        [
          'पंचायत समिति / ज़िला परिषद',
          H.ward,
          'विजेता',
          'दूसरे स्थान पर',
          'अंतर',
          'अंतर %',
          'कुल वैध मत',
        ],
        ...lists((s) => s.close).map((c): Cell[] => [
          ...wardCells(c.ward),
          c.winner,
          c.runnerUp,
          c.margin,
          c.marginPercentText,
          c.totalValidVotes,
        ]),
      ];
    case 'lottery':
      return [
        [
          'पंचायत समिति / ज़िला परिषद',
          H.ward,
          'विजेता',
          'बराबर मत',
          'लॉटरी किसने कराई',
          'विवरण',
          'घोषणा',
          'समय',
        ],
        ...lists((s) => s.lottery).map((l): Cell[] => [
          ...wardCells(l.ward),
          l.winner,
          l.tiedVotes,
          l.conductedBy,
          l.note,
          l.declaredBy,
          l.declaredAt,
        ]),
      ];
    case 'corrections':
      return [
        [
          'पंचायत समिति / ज़िला परिषद',
          H.ward,
          'संस्करण',
          'पहले विजेता',
          'नया विजेता',
          'कारण',
          'किसने',
          'समय',
        ],
        ...lists((s) => s.corrections).map((c): Cell[] => [
          ...wardCells(c.ward),
          c.version,
          c.oldWinner,
          c.newWinner,
          c.reason,
          c.declaredBy,
          c.declaredAt,
        ]),
      ];
    case 'turnout':
      return [
        [H.scope, 'वैध मत', 'पंजीकृत मतदाता', 'मतदान %', 'शामिल वार्ड', 'कुल वार्ड'],
        ...per((label, s) => {
          const t = s.turnout;
          return [
            [
              label,
              t.validVotes,
              t.registeredVoters,
              t.percent ?? 'डेटा उपलब्ध नहीं',
              t.wardsIncluded,
              t.wardsTotal,
            ],
          ];
        }),
      ];
  }
}

function currentUserId(req: Request): number {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
  return req.user.id;
}

const noQuery = z.object({}).strict();
type CountingStatusFormat = 'pdf' | 'csv-ward' | 'csv-booth' | 'csv-zp-ps';

const positiveId = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number);
const statusFilter = z.enum(STATUS_FILTERS).default('ALL');
/** The report scope (query string). No level = the whole district. Unknown keys are refused. */
export const countingStatusQuery = z.preprocess(
  (q) => (typeof q === 'object' && q !== null && !('level' in q) ? { ...q, level: 'DISTRICT' } : q),
  z.discriminatedUnion('level', [
    z.object({ level: z.literal('DISTRICT'), status: statusFilter }).strict(),
    z.object({ level: z.literal('ALL_PS'), status: statusFilter }).strict(),
    z.object({ level: z.literal('ALL_ZP'), status: statusFilter }).strict(),
    z.object({ level: z.literal('PS'), psId: positiveId, status: statusFilter }).strict(),
    z.object({ level: z.literal('WARD'), wardId: positiveId }).strict(),
    z.object({ level: z.literal('BOOTH'), boothId: positiveId }).strict(),
  ]),
);

const isZpRo = (req: Request): boolean => req.user?.role === 'ZP_RO';

/**
 * The scoped report: the one full report, then the scope (an unknown PS / ward / booth is 404).
 * ZP_RO: no level = All ZP wards; a district / PS level or a PS ward is 403; the result is
 * restricted to Zila Parishad data (restrictToZp) for every level.
 */
async function readScoped(pool: Pool, req: Request): Promise<ScopedReport> {
  const zpRo = isZpRo(req);
  const query: unknown =
    zpRo && typeof req.query === 'object' && !('level' in req.query)
      ? { ...req.query, level: 'ALL_ZP' }
      : req.query;
  const scope: ReportScope = parse(countingStatusQuery, query);
  if (zpRo && !ZP_RO_LEVELS.includes(scope.level)) throw new ApiError(403, 'FORBIDDEN');
  let report: ScopedReport;
  try {
    report = scopeReport(await readCountingStatus(pool), scope);
  } catch (err) {
    if (err instanceof ScopeNotFoundError) throw new ApiError(404, 'NOT_FOUND');
    throw err;
  }
  if (!zpRo) return report;
  if (scope.level === 'WARD' && report.wards.some((w) => w.kind !== 'ZP'))
    throw new ApiError(403, 'FORBIDDEN');
  return restrictToZp(report);
}

/** JSON for the page: booth rows only for one ward or one booth (the rest is in the CSV). */
export function countingStatusView(r: ScopedReport): ScopedReport {
  return r.scope.level === 'WARD' || r.scope.level === 'BOOTH' ? r : { ...r, booths: [] };
}

export function reportsRouter(pool: Pool): Router {
  const router = Router();
  const cache = new ReportCache(pool);

  // ---- Counting Status Report: JSON, PDF and every CSV all come from readCountingStatus(), then
  // the same scopeReport(). DM and ZP_RO (ZP wards only, see readScoped). Registered BEFORE the
  // DM-only gate below, which every other report route sits behind.
  const statusRoles = requireRole('DM', 'ZP_RO');
  router.get('/counting-status', statusRoles, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(countingStatusView(await readScoped(pool, req)));
  });

  router.get('/counting-status/options', statusRoles, async (req, res) => {
    parse(noQuery, req.query);
    res
      .set('Cache-Control', 'no-store')
      .json(await readScopeOptions(pool, isZpRo(req) ? 'ZP_ONLY' : 'ALL'));
  });

  router.get('/counting-status/options/wards/:wardId/booths', statusRoles, async (req, res) => {
    parse(noQuery, req.query);
    // DM picks a booth through its PS ward, the ZP_RO through its ZP ward.
    const booths = await readWardBooths(
      pool,
      parse(positiveId, req.params.wardId),
      isZpRo(req) ? 'ZP' : 'PS',
    );
    if (booths === null) throw new ApiError(404, 'NOT_FOUND');
    res.set('Cache-Control', 'no-store').json({ booths });
  });

  const sendCountingStatus = async (req: Request, res: Response, format: CountingStatusFormat) => {
    const r = await readScoped(pool, req);
    const body =
      format === 'pdf'
        ? await renderCountingStatusPdf(r)
        : toCsv(
            format === 'csv-ward'
              ? wardCsvRows(r)
              : format === 'csv-booth'
                ? boothCsvRows(r)
                : zpByPsCsvRows(r),
          );
    await writeAudit(pool, {
      userId: currentUserId(req),
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: { section: 'counting-status', format, reportTime: r.asOf, scope: r.scope },
      ip: req.ip ?? null,
    });
    const stamp = istStampForFile(new Date(r.asOf));
    const level = r.scope.level.toLowerCase().replace('_', '-');
    const csvName = {
      'csv-ward': 'wards',
      'csv-booth': 'booths',
      'csv-zp-ps': 'zp-by-ps',
    } as const;
    const file =
      format === 'pdf'
        ? `counting-status-${level}-${stamp}-IST.pdf`
        : `counting-status-${level}-${csvName[format]}-${stamp}-IST.csv`;
    res
      .status(200)
      .set({
        'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  };
  router.get('/counting-status.pdf', statusRoles, (req, res) =>
    sendCountingStatus(req, res, 'pdf'),
  );
  router.get('/counting-status/wards.csv', statusRoles, (req, res) =>
    sendCountingStatus(req, res, 'csv-ward'),
  );
  router.get('/counting-status/booths.csv', statusRoles, (req, res) =>
    sendCountingStatus(req, res, 'csv-booth'),
  );
  router.get('/counting-status/zp-by-ps.csv', statusRoles, (req, res) =>
    sendCountingStatus(req, res, 'csv-zp-ps'),
  );

  // ---- everything else: DM only
  router.use(requireRole('DM'));

  router.get('/summary', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await cache.get());
  });

  router.get('/wards/:wardId', async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await wardDetail(pool, parse(wardParam, req.params.wardId)));
  });

  router.get('/export.csv', async (req, res) => {
    const q = parse(exportQuery, req.query);
    const summary = await cache.get();
    const body = toCsv(csvRows(summary, q.section, q.scope));
    await writeAudit(pool, {
      userId: currentUserId(req),
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: { section: q.section, scope: q.scope ?? null },
      ip: req.ip ?? null,
    });
    const file = `report-${q.section}-${istStampForFile(new Date())}-IST.csv`;
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  const exportCandidates = async (req: Request, kind: 'csv' | 'xlsx') => {
    const rows = await candidateListRows(pool);
    const body =
      kind === 'csv'
        ? toCsv([[...CANDIDATE_LIST_HEADERS], ...rows])
        : await writeSheetToBuffer([
            {
              name: 'उम्मीदवार सूची',
              headers: CANDIDATE_LIST_HEADERS,
              rows,
              autoFilter: true,
            },
          ]);
    await writeAudit(pool, {
      userId: currentUserId(req),
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: null,
      newValue: { section: 'candidates', format: kind },
      ip: req.ip ?? null,
    });
    return body;
  };

  router.get('/candidates.csv', async (req, res) => {
    parse(z.object({}).strict(), req.query);
    const body = await exportCandidates(req, 'csv');
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="candidates-${istStampForFile(new Date())}-IST.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  router.get('/candidates.xlsx', async (req, res) => {
    parse(z.object({}).strict(), req.query);
    const body = await exportCandidates(req, 'xlsx');
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="candidates-${istStampForFile(new Date())}-IST.xlsx"`,
        'Cache-Control': 'no-store',
      })
      .send(body);
  });

  return router;
}
