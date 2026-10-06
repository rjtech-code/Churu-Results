import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersUnlock } from '../../scripts/users-unlock.js';
import { insert } from '../helpers/db.js';
import { auditCount, closeHarness, createHarness, makeCtx, resetDb } from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});
beforeEach(async () => {
  await resetDb(h);
  await insert(
    h.app,
    "INSERT INTO users (username, full_name, password_hash, role) VALUES ('dm_churu', 'DM', 'HASH-UNCHANGED', 'DM')",
    [],
  );
});

async function state() {
  const [rows] = await h.app.query<RowDataPacket[]>(
    "SELECT failed_login_count, locked_until, password_hash FROM users WHERE username = 'dm_churu'",
  );
  return rows[0];
}

const lock = () =>
  h.app.execute(
    "UPDATE users SET failed_login_count = 3, locked_until = NOW(3) + INTERVAL 10 MINUTE WHERE username = 'dm_churu'",
  );

describe('npm run users:unlock', () => {
  it('clears the lock and failed count, keeps the password, and writes one USER_UNLOCKED audit row', async () => {
    await lock();
    const result = await runUsersUnlock(
      { username: 'dm_churu', by: 'Sharma, ARO', commit: true },
      makeCtx(h).ctx,
    );
    expect(result).toMatchObject({ ok: true, committed: true });
    expect(await state()).toEqual({
      failed_login_count: 0,
      locked_until: null,
      password_hash: 'HASH-UNCHANGED',
    });
    const [audit] = await h.app.query<RowDataPacket[]>(
      'SELECT action, user_id, old_value, new_value FROM audit_log',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'USER_UNLOCKED',
      user_id: null,
      old_value: { failed_login_count: 3 },
      new_value: { username: 'dm_churu', unlocked_by_name: 'Sharma, ARO' },
    });
    expect(JSON.stringify(audit)).not.toContain('HASH-UNCHANGED');
    expect(await readFile(result.reportPath, 'utf8')).toContain(
      'is LOCKED; the lock and 3 failed login(s) will be cleared',
    );
  });

  it('a user who is not locked is reported, not an error; nothing is written', async () => {
    const result = await runUsersUnlock(
      { username: 'dm_churu', by: 'Sharma', commit: true },
      makeCtx(h).ctx,
    );
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(await readFile(result.reportPath, 'utf8')).toContain(
      'is not locked (no lock, no failed logins). Nothing to do.',
    );
    expect(await auditCount(h)).toBe(0);
  });

  it('leftover failed logins (no active lock) are cleared and audited', async () => {
    await h.app.execute("UPDATE users SET failed_login_count = 2 WHERE username = 'dm_churu'");
    const result = await runUsersUnlock(
      { username: 'dm_churu', by: 'Sharma', commit: true },
      makeCtx(h).ctx,
    );
    expect(result.committed).toBe(true);
    expect((await state())?.failed_login_count).toBe(0);
    expect(await auditCount(h)).toBe(1);
  });

  it('dry run writes nothing; --by and an existing user are required', async () => {
    await lock();
    const dry = await runUsersUnlock({ username: 'dm_churu', by: 'Sharma' }, makeCtx(h).ctx);
    expect(dry).toMatchObject({ ok: true, committed: false });
    expect((await state())?.failed_login_count).toBe(3);
    expect(await auditCount(h)).toBe(0);

    const noBy = await runUsersUnlock({ username: 'dm_churu', commit: true }, makeCtx(h).ctx);
    expect(noBy.ok).toBe(false);
    expect(await readFile(noBy.reportPath, 'utf8')).toContain('--by "<name>" is required.');
    expect(
      (await runUsersUnlock({ username: 'nobody', by: 'x', commit: true }, makeCtx(h).ctx)).ok,
    ).toBe(false);
  });
});
