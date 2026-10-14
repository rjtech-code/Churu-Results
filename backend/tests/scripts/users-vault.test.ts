import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersCreate } from '../../scripts/users-create.js';
import { runUsersResetPassword } from '../../scripts/users-reset-password.js';
import { decryptPassword } from '../../src/services/master-data/password-vault.js';
import { TEST_RO_PASSWORD_KEY } from '../auth/helpers.js';
import { insert } from '../helpers/db.js';
import { closeHarness, createHarness, makeCtx, resetDb } from './helpers.js';
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
  const district = await insert(
    h.app,
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
    [],
  );
  await insert(
    h.app,
    'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
    [district, 'PS ONE', 'एक'],
  );
});

const printed = (output: string[]) => /^ {6}([A-Za-z0-9]{16})$/m.exec(output.join('\n'))?.[1];
async function copyOf(username: string): Promise<Buffer | null> {
  const [rows] = await h.app.execute<RowDataPacket[]>(
    'SELECT password_enc FROM users WHERE username = ?',
    [username],
  );
  return (rows[0]?.password_enc as Buffer | null) ?? null;
}

async function plainCopy(username: string): Promise<string> {
  const blob = await copyOf(username);
  if (blob === null) throw new Error(`no password copy for ${username}`);
  return decryptPassword(blob, TEST_RO_PASSWORD_KEY);
}

describe('CLI scripts and the encrypted password copy', () => {
  it('users:create / users:reset-password store a readable copy for ROs, never for the DM', async () => {
    const ro = makeCtx(h);
    await runUsersCreate(
      { role: 'PS_RO', username: 'ro_one', ps: 'PS ONE', fullName: 'RO', commit: true },
      ro.ctx,
    );
    const first = printed(ro.output);
    expect(await plainCopy('ro_one')).toBe(first);

    const reset = makeCtx(h);
    await runUsersResetPassword({ username: 'ro_one', commit: true }, reset.ctx);
    const second = printed(reset.output);
    expect(second).not.toBe(first);
    expect(await plainCopy('ro_one')).toBe(second);

    const dm = makeCtx(h);
    await runUsersCreate({ role: 'DM', username: 'dm_one', fullName: 'DM', commit: true }, dm.ctx);
    expect(await copyOf('dm_one')).toBeNull();
    await runUsersResetPassword({ username: 'dm_one', commit: true }, makeCtx(h).ctx);
    expect(await copyOf('dm_one')).toBeNull();
  });
});
