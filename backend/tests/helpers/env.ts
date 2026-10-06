import dotenv from 'dotenv';
import { z } from 'zod';
import { migrationEnvSchema, parseEnv } from '../../src/config/env.js';

const testEnvSchema = migrationEnvSchema.extend({
  DB_APP_PASSWORD: z.string().min(1),
});
export type TestEnv = z.infer<typeof testEnvSchema>;

/**
 * Loads backend/.env and returns config for the TEST database only.
 * Throws (aborting the run) unless the test database name ends with "_test":
 * tests must never touch the development or production database.
 */
export function loadTestEnv(): TestEnv & { TEST_DB: string } {
  dotenv.config({ quiet: true });
  const result = parseEnv(testEnvSchema, process.env);
  if (!result.ok) {
    throw new Error(`Test environment invalid: ${result.problems.join('; ')}`);
  }
  const testDb = result.env.DB_NAME_TEST;
  if (!testDb.endsWith('_test') || testDb === result.env.DB_NAME) {
    throw new Error(`Refusing to run tests: database "${testDb}" is not a *_test database`);
  }
  return { ...result.env, TEST_DB: testDb };
}
