import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScreenKey } from '../api/superadminTypes';
import { ScreenKeys, shareText } from '../pages/superadmin/ScreenKeys';
import { KeyPrompt, formatKeyInput } from '../screens/KeyPrompt';
import { LiveFeed } from '../screens/liveFeed';
import type { FeedState, StreamLike } from '../screens/liveFeed';
import { PublicHttpError } from '../screens/publicApi';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// jsdom has no <dialog>.showModal(); a minimal stand-in (the real one is covered by Playwright).
beforeAll(() => {
  for (const [name, open] of [
    ['showModal', true],
    ['close', false],
  ] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute('open', open);
      },
    });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('screen key popup', () => {
  it('formats the key as typed', () => {
    expect(formatKeyInput('k7qf m3xa-9pzr!!extra')).toBe('K7QF-M3XA-9PZR');
  });

  it('wrong key -> "गलत key"; right key -> unlocked; lockout message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: 'WRONG_KEY' }))
      .mockResolvedValueOnce(json(429, { error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 600 }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const onUnlocked = vi.fn();
    render(<KeyPrompt screen={2} onUnlocked={onUnlocked} />);
    expect(screen.getByRole('dialog', { name: 'स्क्रीन key डालें' })).toBeTruthy();
    const input = screen.getByLabelText('स्क्रीन key');
    const user = userEvent.setup();
    // Too short: refused without asking the server.
    await user.type(input, 'abcd');
    await user.click(screen.getByRole('button', { name: 'स्क्रीन खोलें' }));
    expect(screen.getByRole('alert').textContent).toContain('गलत key');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'wrngwrngwrng');
    expect((input as HTMLInputElement).value).toBe('WRNG-WRNG-WRNG');
    await user.click(screen.getByRole('button', { name: 'स्क्रीन खोलें' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('गलत key');
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/screen-auth/unlock');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ key: 'WRNG-WRNG-WRNG', screen: '2' });
    await user.click(screen.getByRole('button', { name: 'स्क्रीन खोलें' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('10 मिनट बाद');
    });
    expect(onUnlocked).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'स्क्रीन खोलें' }));
    await waitFor(() => {
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});

describe('live feed: access ended', () => {
  class Stream implements StreamLike {
    readyState = 1;
    onopen = null;
    onerror = null;
    closed = false;
    locked: ((ev: MessageEvent<string>) => void)[] = [];
    off: ((ev: MessageEvent<string>) => void)[] = [];
    addEventListener(type: 'snapshot' | 'locked' | 'off', l: (ev: MessageEvent<string>) => void) {
      if (type === 'locked') this.locked.push(l);
      if (type === 'off') this.off.push(l);
    }
    close() {
      this.closed = true;
    }
  }

  it('401 from the data API -> locked, data dropped, stream closed', async () => {
    const states: FeedState[] = [];
    const s = new Stream();
    const feed = new LiveFeed(
      1,
      {
        fetchJson: () => Promise.reject(new PublicHttpError(401, 'SCREEN_LOCKED')),
        openStream: () => s,
        now: () => Date.now(),
      },
      (st) => states.push(st),
    );
    feed.start();
    await waitFor(() => {
      expect(states.at(-1)?.locked).toBe(true);
    });
    expect(states.at(-1)?.bundle).toBeNull();
    expect(s.closed).toBe(true);
    feed.stop();
  });

  it('401 that says the screen is OFF -> the off card, feed still running, no key box', async () => {
    const states: FeedState[] = [];
    const s = new Stream();
    const feed = new LiveFeed(
      1,
      {
        // What the server answers a TV whose session the OFF switch ended.
        fetchJson: () => Promise.reject(new PublicHttpError(401, 'SCREEN_LOCKED', true)),
        openStream: () => s,
        now: () => Date.now(),
      },
      (st) => states.push(st),
    );
    feed.start();
    await waitFor(() => {
      expect(states.at(-1)?.off).toBe(true);
    });
    // Not locked: the TV shows "यह स्क्रीन अस्थायी रूप से बंद है" and keeps asking, so it comes back
    // on its own. No results are kept either.
    expect(states.at(-1)?.locked).toBe(false);
    expect(states.at(-1)?.bundle).toBeNull();
    expect(s.closed).toBe(false);
    feed.stop();
  });

  it('after the screen is switched ON the next poll is a plain 401 -> the key box appears', async () => {
    const states: FeedState[] = [];
    const s = new Stream();
    // First poll: switched off. Then (switched on again) the session is gone: a plain 401.
    let off = true;
    const feed = new LiveFeed(
      2,
      {
        fetchJson: () => Promise.reject(new PublicHttpError(401, 'SCREEN_LOCKED', off)),
        openStream: () => s,
        now: () => Date.now(),
      },
      (st) => states.push(st),
    );
    feed.start();
    await waitFor(() => {
      expect(states.at(-1)?.off).toBe(true);
    });
    off = false;
    // The same poll the TV was already making — nobody reloads the page.
    await feed.refresh();
    await waitFor(() => {
      expect(states.at(-1)?.locked).toBe(true);
    });
    expect(states.at(-1)?.off).toBe(false);
    expect(s.closed).toBe(true);
    feed.stop();
  });

  it('the server\'s "off" event -> the off card, not the key box (results dropped)', () => {
    const states: FeedState[] = [];
    const s = new Stream();
    const feed = new LiveFeed(
      1,
      { fetchJson: () => new Promise(() => undefined), openStream: () => s, now: () => Date.now() },
      (st) => states.push(st),
    );
    feed.start();
    // What the server sends every stream of a screen the Super Admin just switched OFF.
    for (const l of s.off) l(new MessageEvent('off', { data: '{}' }));
    expect(states.at(-1)?.off).toBe(true);
    expect(states.at(-1)?.locked).toBe(false);
    expect(states.at(-1)?.bundle).toBeNull();
    feed.stop();
  });

  it('the server\'s "locked" event -> locked', () => {
    const states: FeedState[] = [];
    const s = new Stream();
    const feed = new LiveFeed(
      3,
      { fetchJson: () => new Promise(() => undefined), openStream: () => s, now: () => Date.now() },
      (st) => states.push(st),
    );
    feed.start();
    for (const l of s.locked) l(new MessageEvent('locked', { data: '{}' }));
    expect(states.at(-1)?.locked).toBe(true);
    feed.stop();
  });
});

const KEY: ScreenKey = {
  id: 7,
  label: 'मुख्य हॉल TV',
  key: 'K7QF-M3XA-9PZR',
  status: 'ACTIVE',
  createdAt: '2026-11-19T10:00:00.000Z',
  createdByName: 'Super Admin',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  activeScreens: 2,
};

describe('Super Admin: स्क्रीन keys', () => {
  it('lists keys masked, shows/copies the key, revokes after a confirm', async () => {
    const calls: { method: string; url: string }[] = [];
    const lists = [
      {
        keys: [
          KEY,
          { ...KEY, id: 3, label: 'पुरानी', key: null, status: 'REVOKED', revokedAt: KEY.createdAt },
        ],
      },
      { keys: [{ ...KEY, key: null, status: 'REVOKED', revokedAt: KEY.createdAt }] },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url });
        if (url === '/api/auth/csrf') return Promise.resolve(json(200, { csrfToken: 't' }));
        if (method === 'GET') return Promise.resolve(json(200, lists.shift() ?? lists[0]));
        return Promise.resolve(json(200, { ok: true }));
      }),
    );
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ScreenKeys />
      </MemoryRouter>,
    );
    await screen.findByText('मुख्य हॉल TV');
    // The keys are read from the Super Admin's own endpoint, never the DM's.
    expect(calls[0]?.url).toBe('/api/superadmin/screen-keys');
    expect(screen.getByTestId('sa-screen-urls').textContent).toContain('/screen/3');
    // Each screen has its own key to type: the panel says so, or an officer thinks a TV is broken.
    expect(screen.getByTestId('sa-keys').textContent).toContain('हर स्क्रीन की अपनी key डालनी होती है');
    const value = screen.getByTestId('sa-key-value');
    expect(value.textContent).toBe('••••-••••-••••');
    await user.click(screen.getByRole('button', { name: 'key दिखाएँ' }));
    expect(value.textContent).toBe('K7QF-M3XA-9PZR');
    await user.click(screen.getByTestId('sa-copy-key'));
    await screen.findByText('कॉपी हो गया ✓');
    expect(await navigator.clipboard.readText()).toBe('K7QF-M3XA-9PZR');
    expect(screen.getByTestId('sa-active-screens').textContent).toBe('2');
    expect(screen.getByTestId('sa-old-keys').textContent).toContain('रद्द');

    await user.click(screen.getByRole('button', { name: 'रद्द करें' }));
    expect(screen.getByText(/यह वापस नहीं होगा/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'हाँ, रद्द करें' }));
    await screen.findByTestId('sa-done');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/superadmin/screen-keys/7/revoke')).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'ठीक है' }));
    await waitFor(() => {
      expect(screen.getByTestId('sa-no-keys')).toBeTruthy();
    });
  });

  it('"देखें" asks for a preview of that ONE screen', async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url });
        if (url === '/api/auth/csrf') return Promise.resolve(json(200, { csrfToken: 't' }));
        if (method === 'GET') return Promise.resolve(json(200, { keys: [KEY] }));
        return Promise.resolve(json(200, { ok: true }));
      }),
    );
    vi.stubGlobal(
      'open',
      vi.fn(() => ({ opener: {}, location: { assign: vi.fn() } })),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ScreenKeys />
      </MemoryRouter>,
    );
    await screen.findByText('मुख्य हॉल TV');
    const previews = screen.getAllByRole('button', { name: 'देखें (Preview)' });
    expect(previews).toHaveLength(3);
    const screen3 = previews.at(-1);
    if (screen3 === undefined) throw new Error('no preview button for screen 3');
    await user.click(screen3);
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === '/api/superadmin/screen-keys/preview/3' && c.method === 'POST'),
      ).toBe(true);
    });
  });

  it('the share text has the three URLs, the key, and the per-screen note', () => {
    const text = shareText(KEY);
    for (const n of [1, 2, 3]) expect(text).toContain(`/screen/${String(n)}`);
    expect(text).toContain('K7QF-M3XA-9PZR');
    expect(text).toContain('हर TV पर यह key अलग से डालनी होती है।');
  });
});
