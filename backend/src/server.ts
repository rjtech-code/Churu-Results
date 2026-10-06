import { createApp } from './app.js';
import { appConfigFromEnv } from './config/app-config.js';
import { createPool } from './config/db.js';
import { loadEnvOrExit, serverEnvSchema } from './config/env.js';
import { announceVoterCheckConfig } from './config/startup-checks.js';
import { createSessionStore } from './middleware/session.js';
import { SseHub } from './modules/public/sse.js';
import { PublicSnapshotService } from './services/public-snapshot.js';

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

await announceVoterCheckConfig(pool, config);

const publicSnapshot = new PublicSnapshotService(pool, config.publicApi);
void publicSnapshot.start();
const sseHub = new SseHub(publicSnapshot, {
  maxConnections: config.publicApi.sseMaxConnections,
  heartbeatMs: config.publicApi.sseHeartbeatMs,
});

const app = createApp({ pool, config, sessionStore, publicSnapshot, sseHub });
console.log(
  config.frontendDist === null
    ? 'Dashboard: no frontend build found (FRONTEND_DIST); serving the API only.'
    : `Dashboard: serving ${config.frontendDist}`,
);
// Express 5 passes a listen failure (e.g. EADDRINUSE) to this callback. It must stop the process:
// otherwise it keeps running without listening while another process answers on the port.
const server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    const code = 'code' in err ? String(err.code) : '';
    console.error(
      code === 'EADDRINUSE'
        ? `Cannot start: port ${env.PORT} is already in use (is another server still running?). Stop it or set PORT.`
        : `Cannot start: listening on port ${env.PORT} failed (${code || err.message})`,
    );
    process.exit(1);
  }
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  sseHub.stop(); // SSE streams would otherwise keep server.close() waiting
  publicSnapshot.stop();
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
