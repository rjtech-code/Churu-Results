import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScreenKey } from '../api/adminTypes';
import { ScreenKeysPage, shareText } from '../pages/admin/ScreenKeysPage';
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
    addEventListener(type: 'snapshot' | 'locked', l: (ev: MessageEvent<string>) => void) {
      if (type === 'locked') this.locked.push(l);
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
  createdByName: 'DEO',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  activeScreens: 2,
};

describe('DM: स्क्रीन सुरक्षा', () => {
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
        <ScreenKeysPage />
      </MemoryRouter>,
    );
    await screen.findByText('मुख्य हॉल TV');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(3);
    expect(screen.getByTestId('screen-urls').textContent).toContain('/screen/3');
    const value = screen.getByTestId('key-value');
    expect(value.textContent).toBe('••••-••••-••••');
    await user.click(screen.getByRole('button', { name: 'key दिखाएँ' }));
    expect(value.textContent).toBe('K7QF-M3XA-9PZR');
    await user.click(screen.getByTestId('copy-key'));
    await screen.findByText('कॉपी हो गया ✓');
    expect(await navigator.clipboard.readText()).toBe('K7QF-M3XA-9PZR');
    expect(screen.getByTestId('active-screens').textContent).toBe('2');
    expect(screen.getByTestId('old-keys').textContent).toContain('रद्द');

    await user.click(screen.getByRole('button', { name: 'रद्द करें' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('तुरंत बंद');
    await user.click(screen.getByRole('button', { name: 'हाँ, रद्द करें' }));
    await screen.findByText(/की key रद्द हो गई/);
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/screen-keys/7/revoke')).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('no-keys')).toBeTruthy();
    });
  });

  it('the share text has the three URLs and the key', () => {
    const text = shareText(KEY);
    for (const n of [1, 2, 3]) expect(text).toContain(`/screen/${String(n)}`);
    expect(text).toContain('K7QF-M3XA-9PZR');
  });
});
