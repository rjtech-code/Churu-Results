// Server-Sent Events for the media-room screens. The stream carries ONLY the snapshot version;
// screens then fetch the data with the normal public GETs. No login session; every stream belongs
// to a screen session (the screen-access guard runs first and puts it in res.locals.screenSession).
// A stream whose screen session ends (key revoked or expired, DM preview ended) gets one
// "event: locked" and is closed, so the TV shows the key popup again.
import type { Request, Response } from 'express';
import type { PublicSnapshotData, PublicSnapshotService } from '../../services/public-snapshot.js';

/** The screen session of a stream (set by the screen-access guard). */
export interface StreamSession {
  sessionId: number;
  /** null for a DM preview. */
  keyId: number | null;
  /** Epoch ms when the session (or its key) expires. */
  validUntil: number;
}

/** True while the session may still watch (checked against the DB every `recheckMs`). */
export type SessionCheck = (sessionId: number) => Promise<boolean>;

const LOCKED_EVENT = 'event: locked\ndata: {}\n\n';

export class SseHub {
  private readonly clients = new Map<Response, StreamSession | null>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private recheck: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private sessionCheck: { check: SessionCheck; everyMs: number } | null = null;

  constructor(
    private readonly snapshots: PublicSnapshotService,
    private readonly options: { maxConnections: number; heartbeatMs: number },
  ) {}

  /** Re-checks every open stream's screen session every `everyMs` (set once by createApp). */
  setSessionCheck(check: SessionCheck, everyMs: number): void {
    this.sessionCheck = { check, everyMs };
  }

  /** Sends "locked" to the matching streams and closes them. Returns how many were closed. */
  endWhere(match: (session: StreamSession | null) => boolean): number {
    let n = 0;
    for (const [res, session] of this.clients) {
      if (!match(session)) continue;
      this.clients.delete(res);
      res.write(LOCKED_EVENT);
      res.end();
      n++;
    }
    return n;
  }

  /** Closes every stream of this key (called right after the key was revoked). */
  endKey(keyId: number): number {
    return this.endWhere((s) => s !== null && s.keyId === keyId);
  }

  private async recheckSessions(): Promise<void> {
    const check = this.sessionCheck?.check;
    if (check === undefined) return;
    for (const [res, session] of [...this.clients]) {
      if (session === null || !this.clients.has(res)) continue;
      let live = false;
      try {
        live = await check(session.sessionId);
      } catch {
        live = true; // a DB hiccup must not blank every TV; the next check decides
      }
      if (!live && this.clients.has(res)) this.endWhere((s) => s === session);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  private ensureRunning(): void {
    this.unsubscribe ??= this.snapshots.onPublish((s) => {
      this.broadcast(s);
    });
    if (this.heartbeat === null) {
      this.heartbeat = setInterval(() => {
        const now = Date.now();
        this.endWhere((s) => s !== null && s.validUntil <= now);
        for (const res of this.clients.keys()) res.write(': hb\n\n');
      }, this.options.heartbeatMs);
      this.heartbeat.unref();
    }
    if (this.recheck === null && this.sessionCheck !== null) {
      this.recheck = setInterval(() => {
        void this.recheckSessions();
      }, this.sessionCheck.everyMs);
      this.recheck.unref();
    }
  }

  private static event(s: Pick<PublicSnapshotData, 'version' | 'generatedAt'>): string {
    return `event: snapshot\ndata: ${JSON.stringify({ version: s.version, generatedAt: s.generatedAt })}\n\n`;
  }

  private broadcast(s: PublicSnapshotData): void {
    const message = SseHub.event(s);
    for (const res of this.clients.keys()) res.write(message);
  }

  /** GET /api/public/stream */
  readonly handler = (req: Request, res: Response): void => {
    if (this.clients.size >= this.options.maxConnections) {
      res.status(503).set('Cache-Control', 'no-store').json({ error: 'TOO_MANY_STREAMS' });
      return;
    }
    void this.snapshots.start();
    this.ensureRunning();
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell proxies not to buffer
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const current = this.snapshots.get();
    if (current !== null) res.write(SseHub.event(current));
    this.clients.set(res, (res.locals.screenSession as StreamSession | undefined) ?? null);
    req.on('close', () => {
      this.clients.delete(res);
    });
  };

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.recheck) clearInterval(this.recheck);
    this.recheck = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const res of this.clients.keys()) res.end();
    this.clients.clear();
  }
}
