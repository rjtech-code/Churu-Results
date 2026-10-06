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

export const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: port,
  ...dbConnection,
  DB_APP_USER: identifier,
  DB_APP_PASSWORD: password,
});
export type AppEnv = z.infer<typeof appEnvSchema>;

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
