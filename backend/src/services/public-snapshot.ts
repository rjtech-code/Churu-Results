// The public result snapshot: ONE immutable picture of every ward, rebuilt when counting data
// changes. Public endpoints only read the current snapshot (no database query per request).
//
// Rebuild rules:
//  - a 'ward-changed' event schedules a rebuild after `debounceMs` (changes in between are merged);
//  - two published snapshots are never closer than `minSnapshotIntervalMs` (changes in between are
//    merged into the next one; nothing is lost);
//  - a change DURING a rebuild schedules exactly one more rebuild;
//  - a safety rebuild every `safetyRebuildMs` catches changes made by CLI scripts;
//  - the screen-layout setting is polled every `layoutPollMs` (screens:set runs in another process);
//  - a failed rebuild keeps serving the last good snapshot; a half-built one is never published.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { COUNTING_DATE } from '../config/app-config.js';
import type { PublicApiConfig } from '../config/app-config.js';
import { appEvents } from './events.js';
import { readWardInputs, withReadOnlySnapshot } from './result-loader.js';
import { ResultInputError, computeWardResult } from './result.js';
import type { WardResult } from './result.js';
import { SCREEN_LAYOUT_KEY, validateScreenLayout } from './screen-layout.js';
import type { ScreenLayout } from './screen-layout.js';
import {
  istIso,
  leaderOrWinner,
  partyRef,
  partySeats,
  summarize,
  wardCard,
} from './public-views.js';
import type {
  CandidateRef,
  PartyRef,
  PublicStatus,
  SeatRow,
  Summary,
  WardCard,
  WardMeta,
} from './public-views.js';

export interface PsBlock {
  panchayatSamiti: { id: number; name: string };
  summary: Summary;
  wards: WardCard[];
}

export interface RecentItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  psName: string | null;
  wardNo: number;
  status: PublicStatus;
  leaderOrWinner: { candidateId: number; name: string; party: PartyRef | null } | null;
  changedAt: string;
}

export interface WinnerItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  psName: string | null;
  wardNo: number;
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  isCorrection: boolean;
  winner: { candidateId: number; name: string; party: PartyRef | null };
  margin: number;
  declaredAt: string;
}

export interface PublicSnapshotData {
  version: number;
  generatedAt: string;
  meta: { countingDate: string; screens: { '1': number[]; '2': number[]; '3': 'ZP' } };
  screens: {
    '1': PsBlock[];
    '2': PsBlock[];
    '3': {
      zp: { summary: Summary; wards: WardCard[] };
      partySeats: SeatRow[];
      psPartySeats: SeatRow[];
    };
  };
  /** All changed wards, newest first (endpoints slice by limit). */
  recent: RecentItem[];
  /** All declarations incl. corrections, newest first. */
  winners: WinnerItem[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/** Builds a complete snapshot from ONE consistent read-only database snapshot. */
export async function buildPublicSnapshot(
  pool: Pool,
  version: number,
  log: (message: string, err?: unknown) => void,
): Promise<PublicSnapshotData> {
  const read = await withReadOnlySnapshot(pool, async (conn) => {
    const [wards] = await conn.execute<RowDataPacket[]>(
      `SELECT w.id, w.ward_type, w.ward_no, w.panchayat_samiti_id, w.reservation_category, w.is_unopposed,
              (SELECT COUNT(*) FROM candidate c WHERE c.ward_id = w.id) AS candidates,
              (SELECT COUNT(*) FROM booth b WHERE b.ps_ward_id = w.id OR b.zp_ward_id = w.id) AS booths
         FROM ward w ORDER BY w.ward_type, w.ward_no`,
    );
    const [ps] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name_english, name_hindi FROM panchayat_samiti',
    );
    const [parties] = await conn.execute<RowDataPacket[]>(
      'SELECT id, short_name, name_hindi FROM party',
    );
    const [candidates] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name_hindi, party_id FROM candidate',
    );
    const [layoutRows] = await conn.execute<RowDataPacket[]>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [SCREEN_LAYOUT_KEY],
    );
    const [changed] = await conn.execute<RowDataPacket[]>(
      `SELECT ward_id, MAX(t) AS changed_at FROM (
         SELECT ward_id, entered_at AS t FROM booth_entry
         UNION ALL SELECT ward_id, updated_at FROM booth_entry WHERE updated_at IS NOT NULL
         UNION ALL SELECT ward_id, entered_at FROM postal_entry
         UNION ALL SELECT ward_id, updated_at FROM postal_entry WHERE updated_at IS NOT NULL
         UNION ALL SELECT ward_id, voided_at FROM voided_entry
         UNION ALL SELECT ward_id, declared_at FROM ward_declarations
       ) x GROUP BY ward_id`,
    );
    const [declarations] = await conn.execute<RowDataPacket[]>(
      `SELECT ward_id, version, status, winner_candidate_id, margin, declared_at
         FROM ward_declarations ORDER BY declared_at DESC, id DESC`,
    );
    const withCandidates = wards.filter((w) => Number(w.candidates) > 0).map((w) => Number(w.id));
    const inputs = await readWardInputs(conn, withCandidates);
    return { wards, ps, parties, candidates, layoutRows, changed, declarations, inputs };
  });

  // Lookups.
  const psById = new Map(
    read.ps.map((p) => [
      Number(p.id),
      {
        id: Number(p.id),
        english: String(p.name_english),
        name: String(p.name_hindi ?? p.name_english),
      },
    ]),
  );
  const parties = new Map<number, PartyRef>(
    read.parties.map((p) => [
      Number(p.id),
      { shortName: String(p.short_name), nameHindi: String(p.name_hindi) },
    ]),
  );
  const candidates = new Map<number, CandidateRef>(
    read.candidates.map((c) => [
      Number(c.id),
      { name: String(c.name_hindi), partyId: c.party_id === null ? null : Number(c.party_id) },
    ]),
  );
  const changedAt = new Map(read.changed.map((r) => [Number(r.ward_id), toDate(r.changed_at)]));

  // Results per ward; one bad ward never breaks the others.
  const results = new Map<number, WardResult | 'UNAVAILABLE'>();
  for (const input of read.inputs) {
    try {
      results.set(input.ward.id, computeWardResult(input));
    } catch (err) {
      if (!(err instanceof ResultInputError)) throw err;
      log(`ward ${input.ward.id} is UNAVAILABLE on public screens: ${err.message}`);
      results.set(input.ward.id, 'UNAVAILABLE');
    }
  }

  const metas: WardMeta[] = read.wards.map((w) => ({
    id: Number(w.id),
    kind: w.ward_type === 'ZP' ? 'ZP' : 'PS',
    wardNo: Number(w.ward_no),
    panchayatSamitiId: w.panchayat_samiti_id === null ? null : Number(w.panchayat_samiti_id),
    reservationCategory: w.reservation_category === null ? null : String(w.reservation_category),
    isUnopposed: Number(w.is_unopposed) === 1,
    boothCount: Number(w.booths),
  }));
  const cards = new Map<number, WardCard>();
  for (const meta of metas) {
    const r = results.get(meta.id);
    const result = r === undefined || r === 'UNAVAILABLE' ? null : r;
    const status: PublicStatus =
      r === undefined ? 'NO_CANDIDATES' : r === 'UNAVAILABLE' ? 'UNAVAILABLE' : r.status;
    cards.set(meta.id, wardCard(meta, result, status, candidates, parties));
  }
  const cardsOf = (list: readonly WardMeta[]) =>
    list.map((m) => cards.get(m.id)).filter((c): c is WardCard => c !== undefined);

  // Screen layout (names as stored; unknown/missing PS are skipped and logged, never fatal).
  const layoutRaw: unknown = read.layoutRows[0]?.setting_value;
  let layout: ScreenLayout = { '1': [], '2': [] };
  try {
    const parsed: unknown = JSON.parse(typeof layoutRaw === 'string' ? layoutRaw : '{}');
    const english = [...psById.values()].map((p) => p.english);
    const checked = validateScreenLayout(parsed, english);
    if (checked.layout !== null) layout = checked.layout;
    else if (english.length > 0) {
      log(`screen_layout setting is invalid: ${checked.problems.join(' ')}`);
      // Best effort: keep the valid, known names in their order.
      const known = new Set(english);
      const obj = parsed as Partial<Record<'1' | '2', unknown>>;
      for (const s of ['1', '2'] as const) {
        const list = obj[s];
        layout[s] = Array.isArray(list)
          ? list.filter((n): n is string => typeof n === 'string' && known.has(n))
          : [];
      }
    }
  } catch (err) {
    log('screen_layout setting is not valid JSON', err);
  }
  const psIdByEnglish = new Map([...psById.values()].map((p) => [p.english, p.id]));
  const psBlocks = (names: readonly string[]): PsBlock[] =>
    names
      .map((n) => psIdByEnglish.get(n))
      .filter((id): id is number => id !== undefined)
      .map((id) => {
        const wardCards = cardsOf(
          metas.filter((m) => m.kind === 'PS' && m.panchayatSamitiId === id),
        );
        const p = psById.get(id);
        return {
          panchayatSamiti: { id, name: p?.name ?? '' },
          summary: summarize(wardCards),
          wards: wardCards,
        };
      });

  const zpCards = cardsOf(metas.filter((m) => m.kind === 'ZP'));
  const psCards = cardsOf(metas.filter((m) => m.kind === 'PS'));
  const metaById = new Map(metas.map((m) => [m.id, m]));
  const psNameOf = (m: WardMeta | undefined) =>
    m?.panchayatSamitiId == null ? null : (psById.get(m.panchayatSamitiId)?.name ?? null);

  const recent: RecentItem[] = [...changedAt.entries()]
    .map(([wardId, at]) => ({ wardId, at }))
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.wardId - b.wardId)
    .flatMap(({ wardId, at }) => {
      const card = cards.get(wardId);
      const m = metaById.get(wardId);
      if (!card || !m) return [];
      return [
        {
          wardId,
          kind: m.kind,
          psName: psNameOf(m),
          wardNo: m.wardNo,
          status: card.status,
          leaderOrWinner: leaderOrWinner(card),
          changedAt: istIso(at),
        },
      ];
    });

  const winners: WinnerItem[] = read.declarations.flatMap((d) => {
    const m = metaById.get(Number(d.ward_id));
    if (!m) return [];
    const c = candidates.get(Number(d.winner_candidate_id));
    const version = Number(d.version);
    return [
      {
        wardId: m.id,
        kind: m.kind,
        psName: psNameOf(m),
        wardNo: m.wardNo,
        version,
        status: d.status === 'TIE_RESOLVED' ? 'TIE_RESOLVED' : 'DECLARED',
        isCorrection: version > 1,
        winner: {
          candidateId: Number(d.winner_candidate_id),
          name: c?.name ?? '',
          party: partyRef(c?.partyId ?? null, parties),
        },
        margin: Number(d.margin),
        declaredAt: istIso(toDate(d.declared_at)),
      },
    ];
  });

  const screen1 = psBlocks(layout['1']);
  const screen2 = psBlocks(layout['2']);
  return deepFreeze({
    version,
    generatedAt: istIso(new Date()),
    meta: {
      countingDate: COUNTING_DATE,
      screens: {
        '1': screen1.map((b) => b.panchayatSamiti.id),
        '2': screen2.map((b) => b.panchayatSamiti.id),
        '3': 'ZP' as const,
      },
    },
    screens: {
      '1': screen1,
      '2': screen2,
      '3': {
        zp: { summary: summarize(zpCards), wards: zpCards },
        partySeats: partySeats(zpCards),
        psPartySeats: partySeats(psCards),
      },
    },
    recent,
    winners,
  });
}

type Timer = ReturnType<typeof setTimeout>;

/** Keeps the current public snapshot fresh. One instance per server process. */
export class PublicSnapshotService {
  private current: PublicSnapshotData | null = null;
  private version = 0;
  private started = false;
  private building = false;
  private dirty = false;
  private scheduled: Timer | null = null;
  private lastPublishedAt = 0;
  private safetyTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private layoutStamp: string | null = null;
  private firstBuild: Promise<void> | null = null;
  private readonly listeners = new Set<(s: PublicSnapshotData) => void>();
  /** Number of successfully published snapshots (for tests and logs). */
  publishedCount = 0;
  private readonly onWardChanged = () => {
    this.requestRebuild();
  };

  constructor(
    private readonly pool: Pool,
    private readonly config: PublicApiConfig,
    private readonly log: (message: string, err?: unknown) => void = (message, err) => {
      console.error(`[public-snapshot] ${message}`, err ?? '');
    },
  ) {}

  /** Idempotent: subscribe to changes, start the timers, build the first snapshot now. */
  start(): Promise<void> {
    if (!this.started) {
      this.started = true;
      appEvents.on('ward-changed', this.onWardChanged);
      this.safetyTimer = setInterval(() => {
        this.requestRebuild();
      }, this.config.safetyRebuildMs);
      this.safetyTimer.unref();
      this.pollTimer = setInterval(() => {
        void this.pollLayout();
      }, this.config.layoutPollMs);
      this.pollTimer.unref();
      this.firstBuild = this.runBuild();
    }
    return this.firstBuild ?? Promise.resolve();
  }

  stop(): void {
    appEvents.off('ward-changed', this.onWardChanged);
    for (const t of [this.safetyTimer, this.pollTimer]) if (t) clearInterval(t);
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = null;
    this.safetyTimer = null;
    this.pollTimer = null;
    this.started = false;
    this.listeners.clear();
  }

  get(): PublicSnapshotData | null {
    return this.current;
  }

  onPublish(listener: (s: PublicSnapshotData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask for a rebuild; bursts are merged by the debounce and the minimum interval. */
  requestRebuild(): void {
    if (!this.started) return;
    if (this.building) {
      this.dirty = true; // exactly one more rebuild after the current one
      return;
    }
    if (this.scheduled !== null) return; // already scheduled: this change will be included
    const sinceLast = Date.now() - this.lastPublishedAt;
    const delay = Math.max(this.config.debounceMs, this.config.minSnapshotIntervalMs - sinceLast);
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      void this.runBuild();
    }, delay);
    this.scheduled.unref();
  }

  private async runBuild(): Promise<void> {
    this.building = true;
    try {
      const data = await buildPublicSnapshot(this.pool, this.version + 1, this.log);
      this.version = data.version;
      this.current = data; // published atomically: one reference swap
      this.lastPublishedAt = Date.now();
      this.publishedCount++;
      for (const listener of this.listeners) {
        try {
          listener(data);
        } catch (err) {
          this.log('a snapshot listener failed', err);
        }
      }
    } catch (err) {
      this.log('rebuild failed; still serving the last good snapshot', err);
    } finally {
      this.building = false;
    }
    if (this.dirty) {
      this.dirty = false;
      this.requestRebuild();
    }
  }

  private async pollLayout(): Promise<void> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT updated_at FROM app_settings WHERE setting_key = ?',
        [SCREEN_LAYOUT_KEY],
      );
      const stamp = rows[0] === undefined ? 'missing' : toDate(rows[0].updated_at).toISOString();
      if (this.layoutStamp !== null && stamp !== this.layoutStamp) this.requestRebuild();
      this.layoutStamp = stamp;
    } catch (err) {
      this.log('layout poll failed', err);
    }
  }
}
