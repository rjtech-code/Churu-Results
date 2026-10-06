// The ONE place that talks to the backend. Same-origin fetch with the session cookie.
// The CSRF token lives in memory only (never localStorage/sessionStorage).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Thrown when the server cannot be reached at all (network down, server stopped). */
export const NETWORK_ERROR = 'NETWORK_ERROR';

let csrfToken: string | null = null;
let sessionLost: ((code: 'UNAUTHENTICATED' | 'SESSION_EXPIRED') => void) | null = null;

/** Called with the code whenever the server says the session is gone (except during login). */
export function setSessionLostHandler(
  handler: ((code: 'UNAUTHENTICATED' | 'SESSION_EXPIRED') => void) | null,
): void {
  sessionLost = handler;
}

/** Forget the token (login, logout and CSRF failures rotate it on the server). */
export function resetCsrf(): void {
  csrfToken = null;
}

async function send(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== null) headers['X-CSRF-Token'] = token;
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR, {});
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchCsrf(): Promise<string> {
  const res = await send('GET', '/api/auth/csrf', undefined, null);
  const data = (await readJson(res)) as { csrfToken?: unknown } | null;
  if (!res.ok || typeof data?.csrfToken !== 'string') {
    throw new ApiError(res.status, errorCode(data, res.status), data ?? {});
  }
  csrfToken = data.csrfToken;
  return csrfToken;
}

function errorCode(data: unknown, status: number): string {
  const code = (data as { error?: unknown } | null)?.error;
  return typeof code === 'string' ? code : `HTTP_${status}`;
}

/**
 * Calls the API. Writes carry the CSRF token; a CSRF_FAILED answer refetches the token and retries
 * the request ONCE. A lost session (401 UNAUTHENTICATED / SESSION_EXPIRED) is reported to the app.
 */
export async function api<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const write = method !== 'GET';
  for (let attempt = 0; ; attempt++) {
    const token = write ? (csrfToken ?? (await fetchCsrf())) : null;
    const res = await send(method, path, write ? (body ?? {}) : undefined, token);
    const data = await readJson(res);
    if (res.ok) return data as T;

    const code = errorCode(data, res.status);
    if (code === 'CSRF_FAILED' && attempt === 0) {
      resetCsrf();
      continue; // retry once with a fresh token
    }
    if (res.status === 401 && (code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED')) {
      resetCsrf();
      sessionLost?.(code);
    }
    throw new ApiError(res.status, code, (data ?? {}) as Record<string, unknown>);
  }
}
