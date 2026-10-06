import { readFile } from 'node:fs/promises';
import bcrypt from 'bcrypt';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersCreate } from '../../scripts/users-create.js';
import { runUsersList } from '../../scripts/users-list.js';
import { runUsersResetPassword } from '../../scripts/users-reset-password.js';
import { runUsersSetActive } from '../../scripts/users-set-active.js';
import { generatePassword } from '../../scripts/lib/password.js';
import { insert } from '../helpers/db.js';
import {
  auditCount,
  closeHarness,
  count,
  createHarness,
  makeCtx,
  reportFiles,
  resetDb,
} from './helpers.js';
import type { Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

/** 14 Panchayat Samitis (one more than the real 13, to test the PS_RO cap). */
const PS = Array.from({ length: 14 }, (_, i) => `PS NUMBER ${i + 1}`);

beforeEach(async () => {
  await resetDb(h);
  const district = await insert(
    h.app,
    "INSERT INTO district (code, name_english, name_hindi) VALUES ('CHURU', 'Churu', 'चूरू')",
    [],
  );
  for (const name of PS) {
    await insert(
      h.app,
      'INSERT INTO panchayat_samiti (district_id, name_english, name_hindi) VALUES (?, ?, ?)',
      [district, name, `${name} हिंदी`],
    );
  }
});

/** The banner prints the password alone on an indented line. */
function printedPassword(output: string[]): string {
  const match = /^ {6}([A-Za-z0-9]{16})$/m.exec(output.join('\n'));
  if (!match?.[1]) throw new Error('no password printed');
  return match[1];
}

async function create(opts: Parameters<typeof runUsersCreate>[0]) {
  const { ctx, output } = makeCtx(h);
  const result = await runUsersCreate({ commit: true, ...opts }, ctx);
  return { result, output, text: await readFile(result.reportPath, 'utf8') };
}

async function hashOf(username: string): Promise<string> {
  const [rows] = await h.app.execute<RowDataPacket[]>(
    'SELECT password_hash FROM users WHERE username = ?',
    [username],
  );
  return String(rows[0]?.password_hash);
}

const users = () => count(h, 'SELECT COUNT(*) AS n FROM users');

describe('users:create', () => {
  it('creates a user, prints the password once, and stores only a cost-12 bcrypt hash', async () => {
    const { result, output } = await create({
      role: 'DM',
      username: 'dm_churu',
      fullName: '  श्री   जिला कलेक्टर ',
    });
    expect(result.ok).toBe(true);
    const password = printedPassword(output);
    const hash = await hashOf('dm_churu');
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      'SELECT full_name, role, panchayat_samiti_id FROM users',
    );
    expect(rows).toEqual([
      { full_name: 'श्री जिला कलेक्टर', role: 'DM', panchayat_samiti_id: null },
    ]);
    expect(output.join('\n').split(password)).toHaveLength(2); // printed exactly once
  });

  it('never writes the password or hash to audit_log or report files', async () => {
    const { output } = await create({
      role: 'PS_RO',
      username: 'ro_ps1',
      ps: PS[0],
      fullName: 'RO One',
    });
    const password = printedPassword(output);
    await runUsersResetPassword({ username: 'ro_ps1', commit: true }, makeCtx(h).ctx);
    const hash = await hashOf('ro_ps1');

    const [audit] = await h.app.query<RowDataPacket[]>('SELECT * FROM audit_log');
    expect(audit.map((a) => String(a.action))).toEqual(['USER_CREATE', 'USER_RESET_PASSWORD']);
    const auditText = JSON.stringify(audit);
    const files = (await reportFiles(h)).join('\n');
    for (const secret of [password, hash, '$2b$']) {
      expect(auditText).not.toContain(secret);
      expect(files).not.toContain(secret);
    }
  });

  it('a dry run creates nothing and prints no password', async () => {
    const { ctx, output } = makeCtx(h);
    const result = await runUsersCreate({ role: 'DM', username: 'dm_churu', fullName: 'DM' }, ctx);
    expect(result).toMatchObject({ ok: true, committed: false });
    expect(output.join('\n')).not.toContain('NEW PASSWORD');
    expect(await users()).toBe(0);
    expect(await auditCount(h)).toBe(0);
  });

  it('refuses a 14th PS_RO', async () => {
    for (let i = 0; i < 13; i++) {
      await insert(
        h.app,
        "INSERT INTO users (username, full_name, password_hash, role, panchayat_samiti_id) SELECT ?, 'RO', 'x', 'PS_RO', id FROM panchayat_samiti WHERE name_english = ?",
        [`ro_${i + 1}`, PS[i] ?? ''],
      );
    }
    const { result, text } = await create({
      role: 'PS_RO',
      username: 'ro_14',
      ps: PS[13],
      fullName: 'RO 14',
    });
    expect(result.ok).toBe(false);
    expect(text).toContain('There are already 13 PS_RO account(s); the limit is 13');
    expect(await users()).toBe(13);
  });

  it('refuses a second PS_RO for the same PS, even when the first is disabled', async () => {
    await create({ role: 'PS_RO', username: 'ro_one', ps: PS[0], fullName: 'RO' });
    await runUsersSetActive('disable', { username: 'ro_one', commit: true }, makeCtx(h).ctx);
    const { result, text } = await create({
      role: 'PS_RO',
      username: 'ro_two',
      ps: PS[0],
      fullName: 'RO 2',
    });
    expect(result.ok).toBe(false);
    expect(text).toContain('PS NUMBER 1 already has a PS_RO account (one per PS)');
  });

  it('refuses a second ZP_RO and a second DM', async () => {
    await create({ role: 'ZP_RO', username: 'zp_ro', fullName: 'ZP RO' });
    await create({ role: 'DM', username: 'dm_one', fullName: 'DM' });
    const zp = await create({ role: 'ZP_RO', username: 'zp_ro_two', fullName: 'ZP RO 2' });
    const dm = await create({ role: 'DM', username: 'dm_two', fullName: 'DM 2' });
    expect(zp.result.ok).toBe(false);
    expect(zp.text).toContain('the limit is 1');
    expect(dm.result.ok).toBe(false);
    expect(await users()).toBe(2);
  });

  it('refuses a PS_RO without --ps and a DM or ZP_RO with --ps', async () => {
    const ro = await create({ role: 'PS_RO', username: 'ro_nops', fullName: 'RO' });
    expect(ro.text).toContain('A PS_RO needs --ps');
    const dm = await create({ role: 'DM', username: 'dm_ps', ps: PS[0], fullName: 'DM' });
    expect(dm.text).toContain('A DM must not have --ps');
    const zp = await create({ role: 'ZP_RO', username: 'zp_ps', ps: PS[0], fullName: 'ZP' });
    expect(zp.text).toContain('A ZP_RO must not have --ps');
    expect(await users()).toBe(0);
  });

  it.each(['Dm_one', 'abc', 'a'.repeat(31), 'dm-one', 'डीएम_एक'])(
    'refuses the username "%s"',
    async (username) => {
      const { result, text } = await create({ role: 'DM', username, fullName: 'DM' });
      expect(result.ok).toBe(false);
      expect(text).toContain('--username must be 4-30 characters');
    },
  );

  it('refuses a duplicate username, unknown role, unknown PS and missing full name', async () => {
    await create({ role: 'DM', username: 'taken', fullName: 'DM' });
    expect((await create({ role: 'ZP_RO', username: 'taken', fullName: 'X' })).text).toContain(
      'already exists',
    );
    expect((await create({ role: 'ADMIN', username: 'admin1', fullName: 'X' })).text).toContain(
      '--role must be one of',
    );
    expect(
      (await create({ role: 'PS_RO', username: 'ro_x', ps: 'NOWHERE', fullName: 'X' })).text,
    ).toContain('Unknown Panchayat Samiti');
    expect((await create({ role: 'ZP_RO', username: 'zp_x', fullName: '  ' })).text).toContain(
      '--full-name',
    );
  });
});

describe('generatePassword', () => {
  it('is 16 chars of mixed case and digits with no confusing characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[A-Za-z2-9]{16}$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).not.toMatch(/[0O1lIo]/);
    }
  });
});

describe('users:reset-password, disable, enable, list', () => {
  it('reset gives a new working password and clears the lockout', async () => {
    const { output } = await create({ role: 'DM', username: 'dm_churu', fullName: 'DM' });
    const oldPassword = printedPassword(output);
    await h.app.execute(
      "UPDATE users SET failed_login_count = 5, locked_until = NOW() + INTERVAL 1 HOUR WHERE username = 'dm_churu'",
    );

    const reset = makeCtx(h);
    const result = await runUsersResetPassword({ username: 'dm_churu', commit: true }, reset.ctx);
    expect(result.ok).toBe(true);
    const newPassword = printedPassword(reset.output);
    const hash = await hashOf('dm_churu');
    expect(await bcrypt.compare(newPassword, hash)).toBe(true);
    expect(await bcrypt.compare(oldPassword, hash)).toBe(false);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT failed_login_count, locked_until FROM users WHERE username = 'dm_churu'",
    );
    expect(rows).toEqual([{ failed_login_count: 0, locked_until: null }]);
  });

  it('disable and enable toggle the account; repeating is an error', async () => {
    await create({ role: 'DM', username: 'dm_churu', fullName: 'DM' });
    expect(
      (await runUsersSetActive('disable', { username: 'dm_churu', commit: true }, makeCtx(h).ctx))
        .ok,
    ).toBe(true);
    expect(
      await count(
        h,
        "SELECT COUNT(*) AS n FROM users WHERE username = 'dm_churu' AND is_active = 0",
      ),
    ).toBe(1);
    expect(
      (await runUsersSetActive('disable', { username: 'dm_churu', commit: true }, makeCtx(h).ctx))
        .ok,
    ).toBe(false);
    expect(
      (await runUsersSetActive('enable', { username: 'dm_churu', commit: true }, makeCtx(h).ctx))
        .ok,
    ).toBe(true);
    expect(
      await count(
        h,
        "SELECT COUNT(*) AS n FROM users WHERE username = 'dm_churu' AND is_active = 1",
      ),
    ).toBe(1);
    expect(
      (await runUsersSetActive('enable', { username: 'nobody', commit: true }, makeCtx(h).ctx)).ok,
    ).toBe(false);
  });

  it('list shows users and never a hash', async () => {
    await create({ role: 'DM', username: 'dm_churu', fullName: 'DM Sahab' });
    await create({ role: 'PS_RO', username: 'ro_ps1', ps: PS[0], fullName: 'RO One' });
    const { ctx, output } = makeCtx(h);
    const result = await runUsersList(ctx);
    expect(result.usernames).toEqual(['dm_churu', 'ro_ps1']);
    const text = output.join('\n');
    expect(text).toContain('RO One / PS NUMBER 1');
    expect(text).not.toContain('$2b$');
  });
});
