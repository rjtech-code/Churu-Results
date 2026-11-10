// The screen-access gate of the public TV screens. One instance per app (createApp):
// - guard: every /api/public request (data and the live stream) needs a live screen session,
//   else 401 SCREEN_LOCKED. No session cookie of the dashboard is read or created here.
// - the screen cookie (churu.screen): HttpOnly, SameSite=Strict, Secure in production, path /api.
//   It holds a random token; the DB keeps only its SHA-256 (screen_session).
// - revoke: the key's open streams get "locked" and are closed at once (SseHub.endKey); every open
//   stream is also re-checked against the DB every streamRecheckMs (expiry, DM disabled, ...).
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { screenAccessConfig } from '../../config/app-config.js';
import type { AppConfig, ScreenAccessConfig } from '../../config/app-config.js';
import { hashSessionToken, readCookie, screenKeyHashSecret } from '../../services/screen-key.js';
import type { SseHub, StreamSession } from '../public/sse.js';
import { findLiveSession, isSessionLive } from './screen-keys.service.js';
import type { KeySecrets } from './screen-keys.service.js';

export const SCREEN_COOKIE = 'churu.screen';
const COOKIE_PATH = '/api';

export class ScreenAccess {
  readonly settings: ScreenAccessConfig;
  readonly secrets: KeySecrets;

  constructor(
    readonly pool: Pool,
    private readonly config: AppConfig,
    readonly hub: SseHub,
  ) {
    this.settings = screenAccessConfig(config);
    this.secrets = {
      vaultKey: config.roPasswordKey,
      hashSecret: screenKeyHashSecret(config.roPasswordKey),
    };
    hub.setSessionCheck((id) => isSessionLive(pool, id), this.settings.streamRecheckMs);
  }

  /** Gives this browser its screen session (replaces any earlier one). */
  setCookie(res: Response, token: string, maxAgeMs: number): void {
    res.cookie(SCREEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.production,
      path: COOKIE_PATH,
      maxAge: maxAgeMs,
    });
  }

  /** 401 SCREEN_LOCKED unless the request carries a live screen session (res.locals.screenSession). */
  readonly guard: RequestHandler = async (req, res, next) => {
    const token = readCookie(req.get('cookie'), SCREEN_COOKIE);
    const tokenHash = token === null ? null : hashSessionToken(token);
    const session = tokenHash === null ? null : await findLiveSession(this.pool, tokenHash);
    if (session === null) {
      res.status(401).set('Cache-Control', 'no-store').json({ error: 'SCREEN_LOCKED' });
      return;
    }
    const info: StreamSession = session;
    res.locals.screenSession = info;
    next();
  };

  /** Closes the live streams of a key that was just revoked. */
  endKey(keyId: number): void {
    this.hub.endKey(keyId);
  }
}
