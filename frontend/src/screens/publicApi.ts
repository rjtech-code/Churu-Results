// Fetches for the TV screens: no cookies ever (credentials 'omit'), conditional on the version.

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
      credentials: 'omit',
      cache: 'no-store',
      headers: etag === null ? {} : { 'If-None-Match': etag },
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
