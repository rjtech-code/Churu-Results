import { ScriptError } from './db.js';

/**
 * Demo scripts may ONLY run on a development database: never in production, and only when the
 * database name ends in "_dev". Checked before any connection with write rights is opened.
 */
export function assertDemoEnvironment(env: {
  nodeEnv: string | undefined;
  dbName: string | undefined;
}): void {
  if (env.nodeEnv === 'production') {
    throw new ScriptError('Refused: demo scripts never run with NODE_ENV=production.');
  }
  if (env.dbName === undefined || !/^[a-z0-9_]+_dev$/.test(env.dbName)) {
    throw new ScriptError(
      `Refused: demo scripts only run on a database whose name ends in _dev (got "${env.dbName ?? ''}").`,
    );
  }
}
