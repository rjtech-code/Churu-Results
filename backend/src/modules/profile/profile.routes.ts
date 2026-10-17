// /api/profile — "मेरी प्रोफ़ाइल", the DM's own account only (an RO gets 403). The global DM guard
// allows exactly these POST paths (middleware/auth.ts). The email is shown masked, never edited here.
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { requireRole } from '../../middleware/auth.js';
import { loginRateLimit } from '../../middleware/rate-limit.js';
import { MAX_FULL_NAME_LENGTH } from '../../services/master-data/accounts.js';
import { normalizeText } from '../../services/master-data/text.js';
import type { Mailer } from '../../services/mailer.js';
import { actor, noStore, parse, password } from '../admin/http.js';
import {
  changeName,
  changePassword,
  changeUsername,
  getProfile,
  sendOtp,
} from './profile.service.js';

const otp = z.string().regex(/^\d{6}$/);
const nameBody = z
  .object({
    fullName: z.string().transform(normalizeText).pipe(z.string().min(2).max(MAX_FULL_NAME_LENGTH)),
    password,
  })
  .strict();
const sendOtpBody = z.object({ purpose: z.enum(['USERNAME', 'PASSWORD']) }).strict();
const usernameBody = z.object({ newUsername: z.string().trim().max(50), otp, password }).strict();
const passwordBody = z
  .object({
    otp,
    password,
    newPassword: z.string().max(200),
    confirmPassword: z.string().max(200),
  })
  .strict();

export function profileRouter(pool: Pool, config: AppConfig, mailer: Mailer | null): Router {
  const router = Router();
  router.use(requireRole('DM'));
  // Per-IP limit on sending and checking codes (same limits as login, own counter).
  const otpLimit = loginRateLimit(config.loginRateLimit);

  router.get('/', async (req, res) => {
    noStore(res);
    res.json(await getProfile(pool, actor(req).user.id));
  });
  router.post('/name', async (req, res) => {
    await changeName(pool, actor(req), parse(nameBody, req.body));
    res.json({ ok: true });
  });
  router.post('/send-otp', otpLimit, async (req, res) => {
    const { purpose } = parse(sendOtpBody, req.body);
    res.json(await sendOtp(pool, actor(req), purpose, mailer, config.sessionSecret));
  });
  router.post('/username', otpLimit, async (req, res) => {
    await changeUsername(pool, actor(req), parse(usernameBody, req.body), config.sessionSecret);
    res.json({ ok: true });
  });
  router.post('/password', otpLimit, async (req, res) => {
    const body = parse(passwordBody, req.body);
    await changePassword(pool, actor(req), body, config.sessionSecret, req.sessionID);
    res.json({ ok: true });
  });

  return router;
}
