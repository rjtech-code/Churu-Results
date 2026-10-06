import { appEnvSchema } from '../../src/config/env.js';

/** Scripts only need the database settings of the app user (least privilege). */
export const scriptEnvSchema = appEnvSchema.pick({
  DB_HOST: true,
  DB_PORT: true,
  DB_NAME: true,
  DB_APP_USER: true,
  DB_APP_PASSWORD: true,
});
