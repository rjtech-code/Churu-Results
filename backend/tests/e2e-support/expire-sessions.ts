// tsx tests/e2e-support/expire-sessions.ts <age|delete> <username>
// E2E ONLY (Playwright, Part 8): simulates a session running out, for one user's sessions only.
//   age    -> moves loginAt back past the absolute lifetime (server answers 401 SESSION_EXPIRED)
//   delete -> removes the session rows (server answers 401 UNAUTHENTICATED)
// Refuses anything but a *_test database.
import type { RowDataPacket } from 'mysql2/promise';
import { createTestMigrationPool, testEnv } from '../helpers/db.js';

const [mode, username] = process.argv.slice(2);
if ((mode !== 'age' && mode !== 'delete') || username === undefined) {
  throw new Error('usage: tsx tests/e2e-support/expire-sessions.ts <age|delete> <username>');
}
const pool = createTestMigrationPool();
try {
  const [db] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS db');
  const name: unknown = db[0]?.db;
  if (typeof name !== 'string' || !name.endsWith('_test') || name !== testEnv.TEST_DB) {
    throw new Error('expire-sessions refused: not connected to the *_test database');
  }
  const [users] = await pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
    username,
  ]);
  const userId = Number(users[0]?.id);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error(`no such user: ${username}`);
  const match = "JSON_VALID(data) AND CAST(JSON_EXTRACT(data, '$.userId') AS UNSIGNED) = ?";
  const [res] =
    mode === 'age'
      ? await pool.execute(
          `UPDATE sessions SET data = JSON_SET(data, '$.loginAt', 1) WHERE ${match}`,
          [userId],
        )
      : await pool.execute(`DELETE FROM sessions WHERE ${match}`, [userId]);
  console.log(
    `${mode}: ${String((res as { affectedRows: number }).affectedRows)} session(s) of ${username}`,
  );
} finally {
  await pool.end();
}
