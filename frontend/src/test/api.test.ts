import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, resetCsrf, setSessionLostHandler } from '../api/api';

interface Reply {
  status: number;
  body: unknown;
}
let replies: Reply[];
let calls: { url: string; init: RequestInit }[];

beforeEach(() => {
  resetCsrf();
  replies = [];
  calls = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 500, body: { error: 'NO_MORE_REPLIES' } };
    return Promise.resolve(new Response(r.body === null ? '' : JSON.stringify(r.body), { status: r.status }));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionLostHandler(null);
});

const header = (i: number) => new Headers(calls[i]?.init.headers).get('X-CSRF-Token');

describe('api client', () => {
  it('fetches a CSRF token for writes and sends it', async () => {
    replies.push({ status: 200, body: { csrfToken: 'T1' } }, { status: 200, body: { ok: true } });
    expect(await api('POST', '/api/x', { a: 1 })).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/csrf', '/api/x']);
    expect(header(1)).toBe('T1');
    expect(calls[1]?.init.credentials).toBe('same-origin');
  });

  it('on CSRF_FAILED refetches the token and retries ONCE (not twice)', async () => {
    replies.push(
      { status: 200, body: { csrfToken: 'OLD' } },
      { status: 403, body: { error: 'CSRF_FAILED' } },
      { status: 200, body: { csrfToken: 'NEW' } },
      { status: 403, body: { error: 'CSRF_FAILED' } },
    );
    await expect(api('POST', '/api/x', {})).rejects.toMatchObject({ code: 'CSRF_FAILED' });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/csrf', '/api/x', '/api/auth/csrf', '/api/x']);
    expect(header(3)).toBe('NEW');
  });

  it('a retried request that succeeds returns normally', async () => {
    replies.push(
      { status: 200, body: { csrfToken: 'OLD' } },
      { status: 403, body: { error: 'CSRF_FAILED' } },
      { status: 200, body: { csrfToken: 'NEW' } },
      { status: 201, body: { saved: 1 } },
    );
    expect(await api('POST', '/api/x', {})).toEqual({ saved: 1 });
  });

  it('401 UNAUTHENTICATED / SESSION_EXPIRED reports the lost session; INVALID_CREDENTIALS does not', async () => {
    const lost: string[] = [];
    setSessionLostHandler((code) => lost.push(code));
    replies.push(
      { status: 401, body: { error: 'SESSION_EXPIRED' } },
      { status: 401, body: { error: 'UNAUTHENTICATED' } },
    );
    await expect(api('GET', '/api/counting/wards')).rejects.toBeInstanceOf(ApiError);
    await expect(api('GET', '/api/auth/me')).rejects.toBeInstanceOf(ApiError);
    replies.push(
      { status: 200, body: { csrfToken: 'T' } },
      { status: 401, body: { error: 'INVALID_CREDENTIALS' } },
    );
    await expect(api('POST', '/api/auth/login', {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(lost).toEqual(['SESSION_EXPIRED', 'UNAUTHENTICATED']);
  });

  it('never stores the CSRF token in localStorage or sessionStorage', async () => {
    replies.push({ status: 200, body: { csrfToken: 'SECRET-TOKEN' } }, { status: 200, body: {} });
    await api('POST', '/api/x', {});
    const dump = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => `${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`);
    expect([...dump(localStorage), ...dump(sessionStorage)].join(';')).not.toContain('SECRET-TOKEN');
  });

  it('a network failure becomes NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('failed')));
    await expect(api('GET', '/api/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
