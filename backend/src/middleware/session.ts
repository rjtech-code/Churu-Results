import type { Request, RequestHandler, Response } from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import type { Pool } from 'mysql2/promise';
import type { AppConfig } from '../config/app-config.js';

export const SESSION_COOKIE = 'churu.sid';

const MySQLStore = MySQLStoreFactory(session);
export type SessionStore = InstanceType<typeof MySQLStore>;

/**
 * Session store on the APP user's pool. The sessions table is created by a migration
 * (createDatabaseTable: false). With clearExpired, expired rows are deleted every 15 minutes;
 * an expired row is never returned to the app even before cleanup.
 */
export function createSessionStore(pool: Pool, options: { clearExpired: boolean }): SessionStore {
  return new MySQLStore(
    {
      createDatabaseTable: false,
      clearExpired: options.clearExpired,
      checkExpirationInterval: 15 * 60_000,
      endConnectionOnClose: false, // the pool belongs to the app
      schema: {
        tableName: 'sessions',
        columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
      },
    },
    // The store only calls query(sql, params) and uses the returned promise.
    pool as unknown as ConstructorParameters<typeof MySQLStore>[1],
  );
}

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.production,
    path: '/',
  };
}

export function sessionMiddleware(config: AppConfig, store: SessionStore): RequestHandler {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false, // no session row until something is stored (e.g. a CSRF token)
    rolling: true, // idle timeout: every response pushes the expiry forward
    unset: 'destroy',
    cookie: { ...cookieOptions(config), maxAge: config.sessionIdleMs },
  });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}

/** Turns express-session's callback style into a promise. */
function settle(resolve: () => void, reject: (err: Error) => void) {
  return (err: unknown) => {
    if (err === undefined || err === null) resolve();
    else reject(err instanceof Error ? err : new Error('session store error'));
  };
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate(settle(resolve, reject));
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save(settle(resolve, reject));
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy(settle(resolve, reject));
  });
}
