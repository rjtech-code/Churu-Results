import { createApp } from './app.js';
import { appEnvSchema, loadEnvOrExit } from './config/env.js';
import { createPool } from './config/db.js';

const env = loadEnvOrExit(appEnvSchema);

const pool = createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_APP_USER,
  password: env.DB_APP_PASSWORD,
});

const app = createApp({ pool });
const server = app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error('Error closing DB pool', err);
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
