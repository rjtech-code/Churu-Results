// The one-time CLI step: `npm run users:create -- --role SUPER_ADMIN ...`.
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersCreate } from '../../scripts/users-create.js';
import { closeHarness, createHarness, makeCtx, resetDb } from '../scripts/helpers.js';

const h = await createHarness();

afterAll(async () => {
  await closeHarness(h);
});

beforeEach(async () => {
  await resetDb(h);
});

describe('users:create --role SUPER_ADMIN', () => {
  it('creates one Super Admin with a bcrypt hash only (no password copy), never a second', async () => {
    const { ctx } = makeCtx(h);
    const first = await runUsersCreate(
      { role: 'SUPER_ADMIN', username: 'super_admin_a1', fullName: 'Setup Officer', commit: true },
      ctx,
    );
    expect(first).toMatchObject({ ok: true, committed: true });
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT password_enc, panchayat_samiti_id FROM users WHERE role = 'SUPER_ADMIN'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ password_enc: null, panchayat_samiti_id: null });

    const second = await runUsersCreate(
      { role: 'SUPER_ADMIN', username: 'super_admin_a2', fullName: 'Another', commit: true },
      ctx,
    );
    expect(second.ok).toBe(false);
    const withPs = await runUsersCreate(
      { role: 'SUPER_ADMIN', username: 'super_admin_a3', ps: 'X', fullName: 'X', commit: true },
      ctx,
    );
    expect(withPs.ok).toBe(false);
  });
});
