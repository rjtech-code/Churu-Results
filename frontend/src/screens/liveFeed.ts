// The live data of one TV screen: first load, refetch on every newer snapshot version from the SSE
// stream, safety refetch, retries, and the rules for the red "old data" banner. Plain class (no
// React) so the timing rules can be tested with fake timers.
import { PublicHttpError } from './publicApi';
import type { FetchResult } from './publicApi';
import type {
  ListData,
  MetaData,
  PsScreenData,
  RecentItem,
  ScreenBundle,
  ScreenNo,
  WardCard,
  WinnerItem,
  ZpScreenData,
} from './types';

export const TIMING = {
  /** Stream down this long -> stale banner. */
  streamDownMs: 10_000,
  /** No snapshot event this long -> refetch anyway. */
  safetyRefetchMs: 70_000,
  /** No NEW version this long (the server publishes at least every 60 s) -> stale banner. */
  noNewVersionMs: 150_000,
  /** Retry while stale, while unavailable (503) or before the first data. */
  retryMs: 5_000,
  /** How long a changed card is outlined. */
  highlightMs: 3_000,
  /** Reopen a stream the browser gave up on (EventSource CLOSED). */
  reopenMs: 5_000,
  tickMs: 1_000,
};

export interface FeedState {
  bundle: ScreenBundle | null;
  /** Show the red banner: the data on screen may be old. */
  stale: boolean;
  /** 503 SNAPSHOT_UNAVAILABLE before any data. */
  unavailable: boolean;
  /** Any other failure before any data. */
  failed: boolean;
  /** Ward ids whose card changed in the last 3 s. */
  changed: ReadonlySet<number>;
}

/** The part of EventSource the feed uses. */
export interface StreamLike {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: 'snapshot', listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}

export interface FeedDeps {
  fetchJson: (path: string, etag: string | null) => Promise<FetchResult>;
  openStream: () => StreamLike;
  now: () => number;
}

const CLOSED = 2;

export function cardsOf(bundle: ScreenBundle | null): WardCard[] {
  if (bundle === null) return [];
  return bundle.ps?.panchayatSamitis.flatMap((b) => b.wards) ?? bundle.zp?.zp.wards ?? [];
}

/** Ward ids whose card differs from the previous data (none on the first load). */
export function changedWards(before: ScreenBundle | null, after: ScreenBundle): number[] {
  if (before === null) return [];
  const old = new Map(cardsOf(before).map((c) => [c.wardId, JSON.stringify(c)]));
  return cardsOf(after)
    .filter((c) => old.get(c.wardId) !== JSON.stringify(c))
    .map((c) => c.wardId);
}

export class LiveFeed {
  private bundle: ScreenBundle | null = null;
  private stream: StreamLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private inFlight = false;
  private again = false;
  private streamDownSince: number | null = null;
  private reopenAt: number | null = null;
  private lastEventAt: number;
  private lastNewVersionAt: number;
  private lastAttemptAt = 0;
  private staleConnection = false;
  private staleNoNew = false;
  private unavailable = false;
  private failed = false;
  private highlightUntil = new Map<number, number>();
  private lastEmitted = '';

  constructor(
    private readonly screen: ScreenNo,
    private readonly deps: FeedDeps,
    private readonly onState: (state: FeedState) => void,
  ) {
    this.lastEventAt = deps.now();
    this.lastNewVersionAt = deps.now();
  }

  start(): void {
    this.openStream();
    void this.refresh();
    this.timer = setInterval(() => {
      this.tick();
    }, TIMING.tickMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.stream?.close();
    this.stream = null;
  }

  private paths(): string[] {
    const paths = ['/api/public/meta', `/api/public/screens/${this.screen}`, '/api/public/recent?limit=10'];
    if (this.screen === 3) paths.push('/api/public/winners?limit=8');
    return paths;
  }

  private openStream(): void {
    if (this.stopped) return;
    const s = this.deps.openStream();
    this.stream = s;
    s.onopen = () => {
      this.streamDownSince = null;
    };
    s.onerror = () => {
      this.streamDownSince ??= this.deps.now();
      if (s.readyState === CLOSED) {
        // The browser gave up (e.g. an HTTP error): reopen ourselves.
        s.close();
        this.reopenAt = this.deps.now() + TIMING.reopenMs;
      }
    };
    s.addEventListener('snapshot', (ev) => {
      this.streamDownSince = null;
      this.lastEventAt = this.deps.now();
      let version = Number.NaN;
      try {
        version = Number((JSON.parse(ev.data) as { version?: unknown }).version);
      } catch {
        // malformed event: treat as "something changed"
      }
      // Any OTHER version is news: after a server restart the counter starts again at 1.
      if (version !== this.bundle?.version || this.staleConnection || this.staleNoNew) void this.refresh();
    });
  }

  private tick(): void {
    if (this.stopped) return;
    const now = this.deps.now();
    if (this.reopenAt !== null && now >= this.reopenAt) {
      this.reopenAt = null;
      this.openStream();
    }
    if (this.streamDownSince !== null && now - this.streamDownSince > TIMING.streamDownMs) {
      this.staleConnection = true;
    }
    if (this.bundle !== null && now - this.lastNewVersionAt > TIMING.noNewVersionMs) {
      this.staleNoNew = true;
    }
    const needsRetry =
      this.bundle === null || this.staleConnection || this.staleNoNew || this.unavailable || this.failed;
    if (now - this.lastEventAt > TIMING.safetyRefetchMs) {
      this.lastEventAt = now; // one safety refetch per quiet period
      void this.refresh();
    } else if (needsRetry && !this.inFlight && now - this.lastAttemptAt >= TIMING.retryMs) {
      void this.refresh();
    }
    for (const [id, until] of this.highlightUntil) if (until <= now) this.highlightUntil.delete(id);
    this.emit();
  }

  /** Fetch every endpoint of this screen (conditional on the version we show). */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    this.lastAttemptAt = this.deps.now();
    try {
      await this.load(this.bundle === null ? null : `"${this.bundle.version}"`, 0);
      this.unavailable = false;
      this.failed = false;
    } catch (err) {
      if (this.bundle === null) {
        if (err instanceof PublicHttpError && err.code === 'SNAPSHOT_UNAVAILABLE') this.unavailable = true;
        else this.failed = true;
      } else {
        this.staleConnection = true; // keep the last data, say it is old
      }
    } finally {
      this.inFlight = false;
      this.emit();
    }
    if (this.again) {
      this.again = false;
      await this.refresh();
    }
  }

  private async load(etag: string | null, depth: number): Promise<void> {
    const results = await Promise.all(this.paths().map((p) => this.deps.fetchJson(p, etag)));
    const bodies = results.map((r) => (r.status === 200 ? (r.body as { version: number }) : null));
    const fresh = bodies.filter((b): b is { version: number } => b !== null);
    const now = this.deps.now();
    if (fresh.length === 0) {
      // 304 everywhere: what we show is current.
      if (this.streamDownSince === null) this.staleConnection = false;
      return;
    }
    const versions = new Set(fresh.map((b) => b.version));
    if ((fresh.length !== bodies.length || versions.size > 1) && depth < 2) {
      // A snapshot was published between our requests: fetch everything again, unconditionally.
      await this.load(null, depth + 1);
      return;
    }
    const prev = this.bundle;
    const pick = <T>(i: number, current: T | null): T | null => (bodies[i] as T | null) ?? current;
    const meta = pick<MetaData>(0, null);
    const screen = bodies[1] as PsScreenData | ZpScreenData | null;
    const recent = pick<ListData<RecentItem>>(2, null);
    const winners = this.screen === 3 ? pick<ListData<WinnerItem>>(3, null) : null;
    const head = (screen ?? meta ?? fresh[0]) as { version: number; generatedAt?: string };
    const next: ScreenBundle = {
      version: fresh[0]?.version ?? 0,
      generatedAt: head.generatedAt ?? prev?.generatedAt ?? '',
      ps: this.screen === 3 ? null : ((screen as PsScreenData | null) ?? prev?.ps ?? null),
      zp: this.screen === 3 ? ((screen as ZpScreenData | null) ?? prev?.zp ?? null) : null,
      recent: recent?.items ?? prev?.recent ?? [],
      winners: winners?.items ?? prev?.winners ?? [],
    };
    // A 200 to our If-None-Match means the server has a different version than we show: new data
    // (not necessarily a higher number: the counter restarts with the server).
    this.lastNewVersionAt = now;
    this.staleNoNew = false;
    if (this.streamDownSince === null) this.staleConnection = false;
    for (const id of changedWards(prev, next)) this.highlightUntil.set(id, now + TIMING.highlightMs);
    this.bundle = next;
  }

  private emit(): void {
    const state: FeedState = {
      bundle: this.bundle,
      stale: this.bundle !== null && (this.staleConnection || this.staleNoNew),
      unavailable: this.unavailable,
      failed: this.failed,
      changed: new Set(this.highlightUntil.keys()),
    };
    const key = JSON.stringify([
      state.bundle?.version,
      state.bundle?.generatedAt,
      state.stale,
      state.unavailable,
      state.failed,
      [...state.changed],
    ]);
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.onState(state);
  }
}
