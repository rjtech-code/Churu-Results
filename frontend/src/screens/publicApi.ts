// Fetches for the TV screens, conditional on the version. They send the screen cookie (churu.screen,
// HttpOnly, set by the key popup or the DM preview): without it the server answers 401
// SCREEN_LOCKED. Same origin only; the dashboard login is never needed or used.

export class PublicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export type FetchResult = { status: 200; body: unknown } | { status: 304 };

/** GET a public endpoint. 304 = our data is current. Other non-2xx and network failures throw. */
export async function fetchPublic(path: string, etag: string | null): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers:
        etag === null
          ? { 'ngrok-skip-browser-warning': '1' }
          : { 'If-None-Match': etag, 'ngrok-skip-browser-warning': '1' },
    });
  } catch {
    throw new PublicHttpError(0, 'NETWORK_ERROR');
  }
  if (res.status === 304) return { status: 304 };
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // not JSON (e.g. a proxy page): keep the HTTP code
    }
    throw new PublicHttpError(res.status, code);
  }
  return { status: 200, body: (await res.json()) as unknown };
}

/** The answer of the key popup. */
export type UnlockResult =
  { kind: 'ok' } | { kind: 'wrong' } | { kind: 'locked'; retryAfterSeconds: number } | { kind: 'failed' };

/** POST the typed key (the server sets the screen cookie on success). */
export async function unlockScreen(key: string, screen: 1 | 2 | 3): Promise<UnlockResult> {
  let res: Response;
  try {
    res = await fetch('/api/screen-auth/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key, screen: String(screen) }),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (res.ok) return { kind: 'ok' };
  if (res.status === 401) return { kind: 'wrong' };
  if (res.status === 429) {
    let seconds = Number(res.headers.get('Retry-After'));
    try {
      const body = (await res.json()) as { retryAfterSeconds?: unknown };
      if (typeof body.retryAfterSeconds === 'number') seconds = body.retryAfterSeconds;
    } catch {
      // keep the header value
    }
    return { kind: 'locked', retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 900 };
  }
  return { kind: 'failed' };
}
