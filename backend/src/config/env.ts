import dotenv from 'dotenv';
import { z } from 'zod';

// Every environment variable is validated here. On failure we report only the variable NAME
// and what kind of problem it has; values are never printed (they may be secrets).

const nonEmpty = z.string().trim().min(1);
const identifier = nonEmpty.regex(/^[a-z0-9_]+$/, 'must contain only a-z, 0-9 and _');
const password = z.string().min(12, 'must be at least 12 characters');
const port = z.coerce.number().int().min(1).max(65535);

const dbConnection = {
  DB_HOST: nonEmpty,
  DB_PORT: port,
  DB_NAME: identifier,
};

/** An origin exactly like the browser sends it: scheme://host[:port], no path or trailing slash. */
const origin = nonEmpty.refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'must be an origin like https://results.example.in (no path, no trailing slash)');

/** false (default), loopback (proxy on the same server) or a number of proxy hops. Never "true". */
const trustProxy = z
  .string()
  .trim()
  .regex(
    /^(false|loopback|[1-9])$/,
    'must be false, loopback or a number of proxy hops (1-9); never true',
  )
  .transform((v): false | 'loopback' | number =>
    v === 'false' ? false : v === 'loopback' ? 'loopback' : Number(v),
  );

export const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: port,
  ...dbConnection,
  DB_APP_USER: identifier,
  DB_APP_PASSWORD: password,
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  APP_ORIGIN: origin,
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(120).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(14),
  TRUST_PROXY: trustProxy.default(false),
});
export type AppEnv = z.infer<typeof appEnvSchema>;

/**
 * What the server validates at startup: appEnvSchema plus cross-field rules.
 * (Kept separate because Zod cannot .pick() from a refined schema, and scripts pick from appEnvSchema.)
 */
export const serverEnvSchema = appEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.SESSION_IDLE_MINUTES < 5) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_IDLE_MINUTES'],
      message: 'must be at least 5 in production',
    });
  }
});

export const migrationEnvSchema = z.object({
  ...dbConnection,
  DB_NAME_TEST: identifier.regex(/_test$/, 'must end with _test'),
  DB_MIGRATION_USER: identifier,
  DB_MIGRATION_PASSWORD: password,
  // Needed so the grants step knows whom to grant table privileges to.
  DB_APP_USER: identifier,
});
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

export type EnvResult<T> = { ok: true; env: T } | { ok: false; problems: string[] };

/** Pure: validates `raw` against `schema` and returns safe-to-print problem descriptions. */
export function parseEnv<T extends z.ZodObject>(
  schema: T,
  raw: NodeJS.ProcessEnv,
): EnvResult<z.infer<T>> {
  // Treat empty strings as missing so `DB_APP_PASSWORD=` is reported clearly.
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = raw[key];
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (result.success) return { ok: true, env: result.data };

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? '(unknown)');
    return name in cleaned ? `${name} is invalid: ${issue.message}` : `${name} is missing`;
  });
  return { ok: false, problems: [...new Set(problems)].sort() };
}

/** Loads backend/.env (if present, relative to cwd), validates, and exits the process on failure. */
export function loadEnvOrExit<T extends z.ZodObject>(schema: T): z.infer<T> {
  dotenv.config({ quiet: true });
  const result = parseEnv(schema, process.env);
  if (!result.ok) {
    console.error(
      'Configuration error: fix these environment variables (see backend/.env.example):',
    );
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  return result.env;
}
