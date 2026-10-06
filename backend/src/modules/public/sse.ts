// Server-Sent Events for the media-room screens. The stream carries ONLY the snapshot version;
// screens then fetch the data with the normal public GETs. No session, no cookies.
import type { Request, Response } from 'express';
import type { PublicSnapshotData, PublicSnapshotService } from '../../services/public-snapshot.js';

export class SseHub {
  private readonly clients = new Set<Response>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly snapshots: PublicSnapshotService,
    private readonly options: { maxConnections: number; heartbeatMs: number },
  ) {}

  get size(): number {
    return this.clients.size;
  }

  private ensureRunning(): void {
    this.unsubscribe ??= this.snapshots.onPublish((s) => {
      this.broadcast(s);
    });
    if (this.heartbeat === null) {
      this.heartbeat = setInterval(() => {
        for (const res of this.clients) res.write(': hb\n\n');
      }, this.options.heartbeatMs);
      this.heartbeat.unref();
    }
  }

  private static event(s: Pick<PublicSnapshotData, 'version' | 'generatedAt'>): string {
    return `event: snapshot\ndata: ${JSON.stringify({ version: s.version, generatedAt: s.generatedAt })}\n\n`;
  }

  private broadcast(s: PublicSnapshotData): void {
    const message = SseHub.event(s);
    for (const res of this.clients) res.write(message);
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
    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
  };

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
