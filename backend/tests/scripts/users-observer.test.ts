// users:create for the OBSERVER role: the password is typed at a hidden prompt (injected here),
// checked with the chosen-password rules, hashed with bcrypt only (no encrypted copy), and never
// printed. users:disable works on an observer like on any account.
import bcrypt from 'bcrypt';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUsersCreate } from '../../scripts/users-create.js';
import { runUsersSetActive } from '../../scripts/users-set-active.js';
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
});

const GOOD_PASSWORD = 'Nirvachan-2026-view-7';

function promptFor(password: string, confirm = password) {
  const answers = [password, confirm];
  let calls = 0;
  const prompt = (label: string): Promise<string> => {
    expect(label.toLowerCase()).toContain('password');
    calls++;
    return Promise.resolve(answers.shift() ?? '');
  };
  return { prompt, calls: () => calls };
}

describe('users:create --role OBSERVER', () => {
  it('creates the account with the typed password; bcrypt only; nothing printed', async () => {
    const { ctx, output } = makeCtx(h);
    const { prompt, calls } = promptFor(GOOD_PASSWORD);
    const result = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_state1',
        fullName: 'State Observer One',
        commit: true,
        promptPassword: prompt,
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    expect(calls()).toBe(2); // password + confirmation, both hidden
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT role, password_hash, password_enc, is_active, active_slot FROM users WHERE username = 'observer_state1'",
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.role).toBe('OBSERVER');
    expect(rows[0]?.password_enc).toBeNull(); // never an encrypted copy
    expect(rows[0]?.active_slot).toBeNull(); // several active observers allowed
    expect(await bcrypt.compare(GOOD_PASSWORD, String(rows[0]?.password_hash))).toBe(true);
    // The typed password appears NOWHERE in the output or the report.
    expect(output.join('\n')).not.toContain(GOOD_PASSWORD);
    expect(output.join('\n')).not.toContain('NEW PASSWORD');
  });

  it('several observers can exist at once; the 26th is refused by the role limit', async () => {
    const { ctx } = makeCtx(h);
    for (const name of ['observer_a1', 'observer_a2', 'observer_a3']) {
      const { prompt } = promptFor(GOOD_PASSWORD);
      const r = await runUsersCreate(
        { role: 'OBSERVER', username: name, fullName: name, commit: true, promptPassword: prompt },
        ctx,
      );
      expect(r.ok, name).toBe(true);
    }
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'OBSERVER' AND is_active = 1",
    );
    expect(Number(rows[0]?.n)).toBe(3);

    // Fill up to the limit of 25 (disabled accounts count), then one more is refused.
    for (let i = 4; i <= 25; i++) {
      await h.app.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, 'x', 'OBSERVER')",
        [`observer_bulk_${String(i)}`],
      );
    }
    const over = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_26',
        fullName: 'Too Many',
        commit: true,
        promptPassword: promptFor(GOOD_PASSWORD).prompt,
      },
      ctx,
    );
    expect(over.ok).toBe(false);
    expect(over.errors.join(' ')).toContain('limit is 25');
  });

  it('refuses a weak or mismatched password and creates nothing', async () => {
    const { ctx } = makeCtx(h);
    const weak = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_weak',
        fullName: 'Weak',
        commit: true,
        promptPassword: promptFor('churu2026!').prompt,
      },
      ctx,
    );
    expect(weak.ok).toBe(false);
    const mismatch = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_mis',
        fullName: 'Mismatch',
        commit: true,
        promptPassword: promptFor(GOOD_PASSWORD, 'Different-2026-x9').prompt,
      },
      ctx,
    );
    expect(mismatch.ok).toBe(false);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM users WHERE username LIKE 'observer_%'",
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('a dry run never asks for a password', async () => {
    const { ctx } = makeCtx(h);
    const { prompt, calls } = promptFor(GOOD_PASSWORD);
    const r = await runUsersCreate(
      { role: 'OBSERVER', username: 'observer_dry', fullName: 'Dry', promptPassword: prompt },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(false);
    expect(calls()).toBe(0);
  });

  it('an observer must not have --ps', async () => {
    const { ctx } = makeCtx(h);
    const r = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_ps',
        fullName: 'With PS',
        ps: 'CHURU',
        commit: true,
        promptPassword: promptFor(GOOD_PASSWORD).prompt,
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it('users:disable works for an observer', async () => {
    const { ctx } = makeCtx(h);
    const create = await runUsersCreate(
      {
        role: 'OBSERVER',
        username: 'observer_off',
        fullName: 'To Disable',
        commit: true,
        promptPassword: promptFor(GOOD_PASSWORD).prompt,
      },
      ctx,
    );
    expect(create.ok).toBe(true);
    const r = await runUsersSetActive(
      'disable',
      { username: 'observer_off', commit: true },
      makeCtx(h).ctx,
    );
    expect(r.ok).toBe(true);
    const [rows] = await h.app.execute<RowDataPacket[]>(
      "SELECT is_active FROM users WHERE username = 'observer_off'",
    );
    expect(Number(rows[0]?.is_active)).toBe(0);
  });
});
