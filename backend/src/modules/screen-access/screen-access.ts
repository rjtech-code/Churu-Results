// The screen-access gate of the public TV screens. One instance per app (createApp):
// - guard: every /api/public request (data and the live stream) needs a live screen session FOR THE
//   SCREEN IT ASKS ABOUT, else 401 SCREEN_LOCKED. No session cookie of the dashboard is read here.
// - the screen cookie is PER SCREEN (churu.screen1 / churu.screen2 / churu.screen3): HttpOnly,
//   SameSite=Strict, Secure in production, path /api. It holds a random token; the DB keeps only its
//   SHA-256 (screen_session), and the row itself carries the screen. So a key typed on screen 1
//   opens screen 1 and nothing else, and one browser (the Super Admin's preview) can hold a separate
//   session per screen without the screens interfering.
// - a 401 for a screen that is switched OFF says so (`off: true`), and nothing else. That is how a TV
//   whose session has just been ended keeps showing the calm "यह स्क्रीन अस्थायी रूप से बंद है" card
//   instead of a key box, and asks for its key by itself on the first poll after it is switched ON.
//   Only the on/off state of a screen leaves the server without a key — never a result.
// - revoke: the key's open streams get "locked" and are closed at once (SseHub.endKey); a screen
//   switched off or on has its own streams closed the same way (endScreen). Every open stream is
//   also re-checked against the DB every streamRecheckMs (expiry, Super Admin disabled, ...).
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { screenAccessConfig } from '../../config/app-config.js';
import type { AppConfig, ScreenAccessConfig } from '../../config/app-config.js';
import { hashSessionToken, readCookie, screenKeyHashSecret } from '../../services/screen-key.js';
import {
  SCREEN_NUMBERS,
  isScreenNumber,
  readScreensOff,
} from '../../services/setup/screen-power.js';
import type { ScreenNumber } from '../../services/setup/screen-power.js';
import type { MemoryStore } from 'express-rate-limit';
import type { SseHub, StreamSession } from '../public/sse.js';
import { findLiveSession, isSessionLive } from './screen-keys.service.js';
import type { KeySecrets } from './screen-keys.service.js';

/** The cookie that carries the session of ONE screen. */
export function screenCookieName(screen: ScreenNumber): string {
  return `churu.screen${screen}`;
}

/** Kept for the cookie's old single name: it is no longer read, so every TV types its key once. */
export const LEGACY_SCREEN_COOKIE = 'churu.screen';
const COOKIE_PATH = '/api';

/** "/api/public/screens/2" -> "2". */
const SCREEN_PATH = /^\/screens\/([^/]+)$/;

/**
 * The screen a request is about: the path of /screens/:screenNo, else the `screen` query the TV sends
 * on every call it makes. null when the request names none (then it is served from whatever screens
 * this browser does have a session for).
 */
export function requestedScreen(req: Request): ScreenNumber | null {
  const fromPath = SCREEN_PATH.exec(req.path)?.[1];
  if (fromPath !== undefined) return isScreenNumber(fromPath) ? fromPath : null;
  const fromQuery: unknown = req.query.screen;
  return typeof fromQuery === 'string' && isScreenNumber(fromQuery) ? fromQuery : null;
}

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

  /** Gives this browser its session for ONE screen (replaces any earlier one for that screen). */
  setCookie(res: Response, screen: ScreenNumber, token: string, maxAgeMs: number): void {
    res.cookie(screenCookieName(screen), token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.production,
      path: COOKIE_PATH,
      maxAge: maxAgeMs,
    });
  }

  /** The live sessions this browser has, by screen (at most one per screen). */
  private async liveSessions(req: Request): Promise<Map<ScreenNumber, StreamSession>> {
    const header = req.get('cookie');
    const out = new Map<ScreenNumber, StreamSession>();
    for (const screen of SCREEN_NUMBERS) {
      const token = readCookie(header, screenCookieName(screen));
      if (token === null) continue;
      const tokenHash = hashSessionToken(token);
      if (tokenHash === null) continue;
      const session = await findLiveSession(this.pool, tokenHash);
      // The row's own screen decides, not the cookie's name: a token moved to another screen's
      // cookie buys nothing.
      if (session !== null && session.screen === screen) out.set(screen, session);
    }
    return out;
  }

  /** 401 SCREEN_LOCKED, saying `off: true` when the screen it asked about is switched off. */
  private async locked(res: Response, screen: ScreenNumber | null): Promise<void> {
    const off = screen !== null && (await readScreensOff(this.pool)).includes(screen);
    res
      .status(401)
      .set('Cache-Control', 'no-store')
      .json(off ? { error: 'SCREEN_LOCKED', off: true } : { error: 'SCREEN_LOCKED' });
  }

  /**
   * 401 SCREEN_LOCKED unless this browser has a live session for the screen the request is about.
   * Sets res.locals.screenSession (the session that answered) and res.locals.screenScope (the
   * screens this browser may be served): a request that names no screen is served from the screens
   * it does have sessions for, never from the others.
   */
  readonly guard: RequestHandler = async (req, res, next) => {
    const want = requestedScreen(req);
    const sessions = await this.liveSessions(req);
    const session = want === null ? [...sessions.values()][0] : sessions.get(want);
    if (session === undefined) {
      await this.locked(res, want);
      return;
    }
    res.locals.screenSession = session;
    res.locals.screenScope = want === null ? [...sessions.keys()] : [want];
    next();
  };

  /** Closes the live streams of a key that was just revoked. */
  endKey(keyId: number): void {
    this.hub.endKey(keyId);
  }

  /**
   * Closes the live streams of ONE screen (its sessions were just ended). `switchedTo` decides what
   * the TV shows next: the "off" card, or the key box once the screen is on again.
   */
  endScreen(screen: ScreenNumber, switchedTo: 'off' | 'on'): void {
    this.hub.endScreen(screen, switchedTo);
  }

  /**
   * The key popup's attempt counters, handed over by screenAuthRouter so the Super Admin panel can
   * clear a lockout without waiting out the window. They hold nothing but counts.
   */
  private unlockCounters: MemoryStore[] = [];

  registerUnlockCounters(stores: readonly MemoryStore[]): void {
    this.unlockCounters = [...stores];
  }

  /**
   * Clears the key popup's attempt counters — and NOTHING else. No key is read, changed or revoked,
   * no screen session is touched, and no TV's picture changes: a screen that was locked out may
   * simply be unlocked again at once.
   */
  async clearUnlockLockouts(): Promise<void> {
    for (const store of this.unlockCounters) await store.resetAll();
  }
}
