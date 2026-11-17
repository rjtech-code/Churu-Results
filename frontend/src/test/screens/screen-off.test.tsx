// A screen switched off from the Super Admin panel: the TV shows one calm line, and NOT ONE old
// number stays on it. The feed does this on its own, through the data it already polls.
import { describe, expect, it } from 'vitest';
import { LiveFeed } from '../../screens/liveFeed';
import type { FeedState, StreamLike } from '../../screens/liveFeed';

const stream = (): StreamLike => ({
  readyState: 1,
  onopen: null,
  onerror: null,
  addEventListener: () => undefined,
  close: () => undefined,
});

/** The three answers one screen asks for, with the screen body given by the test. */
function feedWith(screenBody: Record<string, unknown>): { feed: LiveFeed; states: FeedState[] } {
  const states: FeedState[] = [];
  const feed = new LiveFeed(
    1,
    {
      fetchJson: (path) => {
        const head = { version: 2, generatedAt: 'T' };
        if (path.startsWith('/api/public/screens/'))
          return Promise.resolve({ status: 200 as const, body: { ...head, ...screenBody } });
        if (path.startsWith('/api/public/meta')) return Promise.resolve({ status: 200 as const, body: head });
        return Promise.resolve({ status: 200 as const, body: { ...head, items: [] } });
      },
      openStream: stream,
      now: () => 1000,
    },
    (s) => states.push(s),
  );
  return { feed, states };
}

const PS_DATA = {
  panchayatSamitis: [{ panchayatSamiti: { id: 1, name: 'चूरू' }, summary: {} as never, wards: [] }],
};

describe('a screen that is off', () => {
  it('the bundle says off and carries no results', async () => {
    const { feed, states } = feedWith({ off: true });
    await feed.refresh();
    const bundle = states.at(-1)?.bundle;
    expect(bundle?.off).toBe(true);
    expect(bundle?.ps).toBeNull();
    expect(bundle?.zp).toBeNull();
    expect(bundle?.recent).toEqual([]);
    expect(bundle?.winners).toEqual([]);
  });

  it('a normal answer keeps off false and the results as they are', async () => {
    const { feed, states } = feedWith(PS_DATA);
    await feed.refresh();
    const bundle = states.at(-1)?.bundle;
    expect(bundle?.off).toBe(false);
    expect(bundle?.ps?.panchayatSamitis).toHaveLength(1);
  });
});
