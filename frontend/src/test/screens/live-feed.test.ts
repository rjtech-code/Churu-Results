import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveFeed, TIMING, changedWards } from '../../screens/liveFeed';
import type { FeedState, StreamLike } from '../../screens/liveFeed';
import { PublicHttpError } from '../../screens/publicApi';
import type { FetchResult } from '../../screens/publicApi';
import type { ScreenBundle, WardCard } from '../../screens/types';

class FakeStream implements StreamLike {
  readyState = 1;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private listeners: ((ev: MessageEvent<string>) => void)[] = [];
  addEventListener(_type: 'snapshot', l: (ev: MessageEvent<string>) => void) {
    this.listeners.push(l);
  }
  close() {
    this.closed = true;
  }
  snapshot(version: number) {
    for (const l of this.listeners) l({ data: JSON.stringify({ version }) } as MessageEvent<string>);
  }
  fail(closed = false) {
    if (closed) this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
}

const ward = (wardId: number, votes: number): WardCard =>
  ({
    wardId,
    wardNo: wardId,
    status: 'COUNTING',
    top3: [{ candidateId: 1, name: 'ए', party: null, votes, rank: 1, tiedWithPrevious: false }],
  }) as unknown as WardCard;

/** A fake server: the current version and its data; honours If-None-Match. */
class FakeServer {
  version = 1;
  votes = 10;
  down = false;
  unavailable = false;
  calls: { path: string; etag: string | null }[] = [];
  fetch = (path: string, etag: string | null): Promise<FetchResult> => {
    this.calls.push({ path, etag });
    if (this.down) return Promise.reject(new PublicHttpError(0, 'NETWORK_ERROR'));
    if (this.unavailable) return Promise.reject(new PublicHttpError(503, 'SNAPSHOT_UNAVAILABLE'));
    if (etag === `"${this.version}"`) return Promise.resolve({ status: 304 });
    const head = { version: this.version, generatedAt: `2026-11-20T10:00:0${this.version % 10}.000+05:30` };
    if (path.startsWith('/api/public/screens/')) {
      return Promise.resolve({
        status: 200,
        body: {
          ...head,
          panchayatSamitis: [
            { panchayatSamiti: { id: 1, name: 'x' }, summary: {}, wards: [ward(1, this.votes), ward(2, 5)] },
          ],
        },
      });
    }
    if (path.startsWith('/api/public/recent'))
      return Promise.resolve({ status: 200, body: { ...head, items: [] } });
    return Promise.resolve({ status: 200, body: { ...head, countingDate: '2026-11-20' } });
  };
}

let server: FakeServer;
let streams: FakeStream[];
let states: FeedState[];
let feed: LiveFeed;
const last = (): FeedState => {
  const s = states.at(-1);
  if (s === undefined) throw new Error('no state yet');
  return s;
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

beforeEach(async () => {
  vi.useFakeTimers();
  server = new FakeServer();
  streams = [];
  states = [];
  feed = new LiveFeed(
    2,
    {
      fetchJson: server.fetch,
      openStream: () => {
        const s = new FakeStream();
        streams.push(s);
        return s;
      },
      now: () => Date.now(),
    },
    (s) => states.push(s),
  );
  feed.start();
  await flush();
});
afterEach(() => {
  feed.stop();
  vi.useRealTimers();
});

describe('LiveFeed', () => {
  it('first load fetches meta, the screen and /recent (no winners on screen 2), with no If-None-Match', () => {
    expect(server.calls.map((c) => c.path)).toEqual([
      '/api/public/meta',
      '/api/public/screens/2',
      '/api/public/recent?limit=10',
    ]);
    expect(server.calls.every((c) => c.etag === null)).toBe(true);
    expect(last().bundle?.version).toBe(1);
    expect(last().stale).toBe(false);
  });

  it('a snapshot event with a newer version refetches with If-None-Match and highlights changed cards for 3 s', async () => {
    server.version = 2;
    server.votes = 11;
    server.calls = [];
    streams[0]?.snapshot(2);
    await flush();
    expect(server.calls[0]?.etag).toBe('"1"');
    expect(last().bundle?.version).toBe(2);
    expect([...last().changed]).toEqual([1]); // ward 2 did not change
    await advance(TIMING.highlightMs + 1000);
    expect([...last().changed]).toEqual([]);
  });

  it('a snapshot event with the version we have does not refetch; 304 keeps the data', async () => {
    server.calls = [];
    streams[0]?.snapshot(1);
    await flush();
    expect(server.calls).toEqual([]);
  });

  it('after a server restart the version counter starts again: a LOWER version is still new data', async () => {
    server.version = 5;
    streams[0]?.snapshot(5);
    await flush();
    server.version = 1;
    server.votes = 99;
    streams[0]?.snapshot(1);
    await flush();
    expect(last().bundle?.version).toBe(1);
    expect(last().bundle?.ps?.panchayatSamitis[0]?.wards[0]?.top3[0]?.votes).toBe(99);
  });

  it('no snapshot event for 70 s: refetch anyway', async () => {
    server.calls = [];
    await advance(TIMING.safetyRefetchMs + 1500);
    expect(server.calls.length).toBeGreaterThan(0);
  });

  it('stream down for more than 10 s -> stale (data kept); fresh data after reconnect clears it', async () => {
    streams[0]?.fail();
    await advance(9000);
    expect(last().stale).toBe(false);
    await advance(3000);
    expect(last().stale).toBe(true);
    expect(last().bundle?.version).toBe(1); // the last data stays on screen
    // reconnected: the stream sends the current version at once
    server.version = 2;
    streams[0]?.snapshot(2);
    await flush();
    expect(last().stale).toBe(false);
  });

  it('a failing fetch -> stale at once; it retries every 5 s and clears on success', async () => {
    server.down = true;
    server.version = 2;
    streams[0]?.snapshot(2);
    await flush();
    expect(last().stale).toBe(true);
    server.down = false;
    await advance(TIMING.retryMs + 1000);
    expect(last().stale).toBe(false);
    expect(last().bundle?.version).toBe(2);
  });

  it('no NEW version for 150 s although the stream looks fine -> stale; a new version clears it', async () => {
    for (let t = 0; t < 160; t += 30) {
      streams[0]?.snapshot(1); // keep-alive with the same version
      await advance(30_000);
    }
    expect(last().stale).toBe(true);
    server.version = 2;
    streams[0]?.snapshot(2);
    await flush();
    expect(last().stale).toBe(false);
  });

  it('a stream the browser closed is reopened after 5 s', async () => {
    streams[0]?.fail(true);
    expect(streams[0]?.closed).toBe(true);
    await advance(TIMING.reopenMs + 1000);
    expect(streams).toHaveLength(2);
  });
});

describe('LiveFeed before any data', () => {
  it('503 SNAPSHOT_UNAVAILABLE -> "unavailable", retried every 5 s until data arrives', async () => {
    feed.stop();
    server = new FakeServer();
    server.unavailable = true;
    states = [];
    feed = new LiveFeed(
      3,
      { fetchJson: server.fetch, openStream: () => new FakeStream(), now: () => Date.now() },
      (s) => states.push(s),
    );
    feed.start();
    await flush();
    expect(last()).toMatchObject({ bundle: null, unavailable: true, stale: false });
    const before = server.calls.length;
    await advance(TIMING.retryMs + 1000);
    expect(server.calls.length).toBeGreaterThan(before);
    server.unavailable = false;
    await advance(TIMING.retryMs + 1000);
    expect(last().unavailable).toBe(false);
    expect(last().bundle).not.toBeNull();
    expect(server.calls.some((c) => c.path === '/api/public/winners?limit=8')).toBe(true);
  });
});

describe('changedWards', () => {
  it('none on the first load; only cards whose data differs', () => {
    const b = (v: number): ScreenBundle => ({
      version: 1,
      generatedAt: '',
      ps: {
        version: 1,
        generatedAt: '',
        panchayatSamitis: [
          { panchayatSamiti: { id: 1, name: '' }, summary: {} as never, wards: [ward(1, v), ward(2, 5)] },
        ],
      },
      zp: null,
      recent: [],
      winners: [],
    });
    expect(changedWards(null, b(1))).toEqual([]);
    expect(changedWards(b(1), b(1))).toEqual([]);
    expect(changedWards(b(1), b(2))).toEqual([1]);
  });
});
