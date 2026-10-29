import type { AuthUser, Role } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    userId: number;
    role: Role;
    panchayatSamitiId: number | null;
    /** Epoch milliseconds of the login; enforces the absolute session lifetime. */
    loginAt: number;
    csrfToken: string;
    /** Super Admin only: epoch ms of the last password check for a dangerous action (15-min window). */
    superAdminConfirmedAt?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the current-user middleware for a valid, active, logged-in session. */
      user?: AuthUser;
    }
  }
}

export {};
