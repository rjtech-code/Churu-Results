// Small request helpers shared by the Part 13 routers (/api/admin and /api/candidates).
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { MasterDataBusyError } from '../../services/master-data/lock.js';
import type { AuthUser } from '../../types/auth.js';

export interface Actor {
  user: AuthUser;
  ip: string | null;
}

export function actor(req: Request): Actor {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED');
  return { user: req.user, ip: req.ip ?? null };
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export const idParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);
export const password = z.string().min(1).max(128);
/** The optional candidate details as typed in a form (null or left out = empty). */
export const candidateDetailsFields = {
  dob: z.string().max(10).nullable().optional(),
  ageStated: z.number().int().min(0).max(255).nullable().optional(),
  education: z.string().max(50).nullable().optional(),
  mobile: z.string().max(20).nullable().optional(),
  candidateCategory: z.string().max(30).nullable().optional(),
};
/** Why a change was made (stored in the audit log). */
export const reason = z.string().trim().min(10).max(500);

/** Turns a busy master-data lock into 409 MASTER_DATA_BUSY ("try again shortly"). */
export async function busyAsConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof MasterDataBusyError) throw new ApiError(409, 'MASTER_DATA_BUSY');
    throw err;
  }
}

/** A response that must never be cached anywhere (it carries a new password). */
export function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}
