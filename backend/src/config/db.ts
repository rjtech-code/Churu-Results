import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

export interface DbConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// Forced on every new connection so a mis-configured server can never silently weaken
// data checks (non-strict mode would turn a negative vote into 0 instead of rejecting it).
export const SESSION_SQL_MODE = [
  'STRICT_ALL_TABLES',
  'NO_ZERO_IN_DATE',
  'NO_ZERO_DATE',
  'ERROR_FOR_DIVISION_BY_ZERO',
  'NO_ENGINE_SUBSTITUTION',
  'ONLY_FULL_GROUP_BY',
].join(',');

export const SESSION_INIT_SQL = `SET SESSION time_zone = '+05:30', sql_mode = '${SESSION_SQL_MODE}'`;

export function createPool(config: DbConnectionConfig): Pool {
  const pool = mysql.createPool({
    ...config,
    timezone: '+05:30',
    charset: 'UTF8MB4_UNICODE_CI',
    connectionLimit: 10,
    waitForConnections: true,
    connectTimeout: 5000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: false,
  });

  // The promise pool re-emits the core connection, so listen on the core pool for correct typing.
  pool.pool.on('connection', (connection) => {
    connection.query(SESSION_INIT_SQL, (err) => {
      if (err) {
        console.error('DB session init failed; dropping connection:', err.message);
        connection.destroy();
      }
    });
  });

  return pool;
}
