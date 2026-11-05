// tsx tests/e2e-support/ro-bulk-ps.ts <add|remove>
// E2E ONLY (Playwright, RO bulk add): every RO seat of the e2e world is taken, so the bulk-add story
// adds one empty PS (Taranagar, no wards) and removes it again afterwards, together with the RO
// account the story created there (that account never logs in, so no audit row points at it).
// Refuses anything but a *_test database.
import type { RowDataPacket } from 'mysql2/promise';
import { createTestMigrationPool, testEnv } from '../helpers/db.js';

const PS = ['TARANAGAR PANCHAYAT SAMITI', 'पंचायत समिति तारानगर'] as const;

const mode = process.argv[2];
if (mode !== 'add' && mode !== 'remove') {
  throw new Error('usage: tsx tests/e2e-support/ro-bulk-ps.ts <add|remove>');
}
const pool = createTestMigrationPool();
try {
  const [db] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS db');
  const name: unknown = db[0]?.db;
  if (typeof name !== 'string' || !name.endsWith('_test') || name !== testEnv.TEST_DB) {
    throw new Error('ro-bulk-ps refused: not connected to the *_test database');
  }
  // Always start clean (also after an interrupted run).
  const [found] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM panchayat_samiti WHERE name_english = ?',
    [PS[0]],
  );
  for (const row of found) {
    await pool.execute("DELETE FROM users WHERE role = 'PS_RO' AND panchayat_samiti_id = ?", [
      row.id,
    ]);
    await pool.execute('DELETE FROM panchayat_samiti WHERE id = ?', [row.id]);
  }
  if (mode === 'add') {
    await pool.execute(
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) SELECT district_id, ?, ? FROM panchayat_samiti ORDER BY id LIMIT 1',
      [...PS],
    );
  }
  console.log(`ro-bulk-ps: ${mode} done`);
} finally {
  await pool.end();
}
