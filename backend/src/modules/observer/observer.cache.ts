// The observer dashboard's one data source. ONE build gathers the SAME objects the DM reports are
// rendered from — readReportData() -> buildReport() (the DM summary) and readCountingStatusRaw()
// -> buildCountingStatus() (the DM Counting Status Report) — so an observer figure can never differ
// from the DM's: nothing here adds or recomputes a number. The build is cached (OBSERVER_CACHE_MS)
// and concurrent requests share one in-flight build, so observers cannot slow counting down.
import type { Pool } from 'mysql2/promise';
import type { CountingStatusReport } from '../../services/counting-status.js';
import { buildReport } from '../../services/reports.js';
import type { ReportRaw, ReportSummary } from '../../services/reports.js';
import { istIso } from '../../services/public-views.js';
import { readCountingStatus } from '../reports/counting-status.data.js';
import { readReportData } from '../reports/reports.data.js';

export const OBSERVER_CACHE_MS = 10_000;

/** One declared result (newest first). Result-level facts only: never who declared or why. */
export interface DeclarationFeedItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  isCorrection: boolean;
  winner: { name: string; party: { shortName: string | null; nameHindi: string } | null };
  margin: number;
  declaredAt: string;
}

/** Plain row counts from the same consistent read (zero-state structure numbers). */
export interface StructureCounts {
  panchayatSamitis: number;
  psWards: number;
  zpWards: number;
  booths: number;
  candidates: number;
  parties: number;
}

/** What search needs: ward refs and ballot names only (no personal candidate details). */
export interface SearchIndex {
  wards: { id: number; kind: 'PS' | 'ZP'; wardNo: number; psId: number | null; psName: string | null }[];
  candidates: { wardId: number; name: string; party: string | null }[];
}

export interface ObserverBuild {
  builtAt: string;
  /** The DM report summary, byte-identical pipeline to GET /api/reports/summary. */
  summary: ReportSummary;
  /** The DM Counting Status Report, byte-identical pipeline to GET /api/reports/counting-status. */
  status: CountingStatusReport;
  structure: StructureCounts;
  declarationsFeed: DeclarationFeedItem[];
  searchIndex: SearchIndex;
}

export function searchIndex(raw: ReportRaw): SearchIndex {
  const psNames = new Map(raw.ps.map((p) => [p.id, p.name]));
  const parties = new Map(raw.parties.map((p) => [p.id, p.shortName]));
  return {
    wards: raw.wards.map((w) => ({
      id: w.id,
      kind: w.kind,
      wardNo: w.wardNo,
      psId: w.panchayatSamitiId,
      psName: w.panchayatSamitiId === null ? null : (psNames.get(w.panchayatSamitiId) ?? null),
    })),
    candidates: raw.candidates
      .filter((c) => !c.isNota)
      .map((c) => ({
        wardId: c.wardId,
        name: c.name,
        party: c.partyId === null ? null : (parties.get(c.partyId) ?? null),
      })),
  };
}

/** The feed is the raw ward_declarations rows of the report read, newest first, sanitized. */
export function declarationsFeed(raw: ReportRaw): DeclarationFeedItem[] {
  const wards = new Map(raw.wards.map((w) => [w.id, w]));
  const psNames = new Map(raw.ps.map((p) => [p.id, p.name]));
  const candidates = new Map(raw.candidates.map((c) => [c.id, c]));
  const parties = new Map(raw.parties.map((p) => [p.id, p]));
  return raw.declarations
    .map((d): DeclarationFeedItem | null => {
      const ward = wards.get(d.wardId);
      if (ward === undefined) return null;
      const winner = candidates.get(d.winnerCandidateId);
      const party = winner?.partyId == null ? null : (parties.get(winner.partyId) ?? null);
      return {
        wardId: d.wardId,
        kind: ward.kind,
        wardNo: ward.wardNo,
        psName:
          ward.panchayatSamitiId === null ? null : (psNames.get(ward.panchayatSamitiId) ?? null),
        version: d.version,
        status: d.status,
        isCorrection: d.version > 1,
        winner: {
          name: winner?.name ?? '',
          party: party === null ? null : { shortName: party.shortName, nameHindi: party.nameHindi },
        },
        margin: d.margin,
        declaredAt: istIso(d.declaredAt),
      };
    })
    .filter((d): d is DeclarationFeedItem => d !== null)
    .sort((a, b) => (a.declaredAt < b.declaredAt ? 1 : a.declaredAt > b.declaredAt ? -1 : 0));
}

/**
 * The build, rebuilt at most every OBSERVER_CACHE_MS; concurrent requests share one build
 * (same pattern as the DM's ReportCache).
 */
export class ObserverCache {
  private value: { at: number; build: ObserverBuild } | null = null;
  private inFlight: Promise<ObserverBuild> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly ttlMs: number = OBSERVER_CACHE_MS,
  ) {}

  async get(): Promise<ObserverBuild> {
    const now = Date.now();
    if (this.value !== null && now - this.value.at < this.ttlMs) return this.value.build;
    this.inFlight ??= (async () => {
      try {
        const raw = await readReportData(this.pool);
        const summary = buildReport(raw, { now: new Date() });
        const status = await readCountingStatus(this.pool);
        const build: ObserverBuild = {
          builtAt: istIso(new Date()),
          summary,
          status,
          structure: {
            panchayatSamitis: raw.ps.length,
            psWards: raw.wards.filter((w) => w.kind === 'PS').length,
            zpWards: raw.wards.filter((w) => w.kind === 'ZP').length,
            booths: raw.booths.length,
            candidates: raw.candidates.filter((c) => !c.isNota).length,
            parties: raw.parties.length,
          },
          declarationsFeed: declarationsFeed(raw),
          searchIndex: searchIndex(raw),
        };
        this.value = { at: Date.now(), build };
        return build;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
