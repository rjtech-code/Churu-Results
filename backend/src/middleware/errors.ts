import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * An expected API error with a stable code, e.g. new ApiError(409, 'ALREADY_ENTERED').
 * The client gets { "error": code, ...details }. Details must never contain internals.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/** Body-parser errors carry a `type`; they are client errors, not server faults. */
function bodyParserStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  switch (err.type) {
    case 'entity.parse.failed':
      return 400;
    case 'entity.too.large':
      return 413;
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return 415;
    default:
      return undefined;
  }
}

// Clients only ever see a short generic message: no stack traces, SQL or internal details.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof ApiError) {
    if (!res.headersSent) res.status(err.status).json({ ...err.details, error: err.code });
    return;
  }
  const status = bodyParserStatus(err);
  if (status !== undefined) {
    res.status(status).json({ error: status === 413 ? 'Payload too large' : 'Bad request' });
    return;
  }

  console.error(`[error] ${req.method} ${req.path}`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal error' });
};
