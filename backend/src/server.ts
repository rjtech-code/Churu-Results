import { createApp } from './app.js';
import { appConfigFromEnv } from './config/app-config.js';
import { createPool } from './config/db.js';
import { loadEnvOrExit, serverEnvSchema } from './config/env.js';
import { createSessionStore } from './middleware/session.js';

const env = loadEnvOrExit(serverEnvSchema);
const config = appConfigFromEnv(env);

const pool = createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_APP_USER,
  password: env.DB_APP_PASSWORD,
});
const sessionStore = createSessionStore(pool, { clearExpired: true });

const app = createApp({ pool, config, sessionStore });
const server = app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    sessionStore
      .close()
      .then(() => pool.end())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          console.error('Error during shutdown', err);
          process.exit(1);
        },
      );
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
