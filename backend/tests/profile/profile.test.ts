import request from 'supertest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Mailer } from '../../src/services/mailer.js';
import { apiClient, auditOf, buildAdminWorld, PASSWORD } from '../admin/helpers.js';
import type { AdminWorld } from '../admin/helpers.js';
import { login, testAppConfig } from '../auth/helpers.js';
import { createTestAppPool, createTestMigrationPool, resetData } from '../helpers/db.js';

const NEW_PASSWORD = 'Naya-Pass-2026x';
const DM_EMAIL = 'collector.churu@gmail.com';

let pool: Pool;
let migrator: Pool;
let w: AdminWorld;

/** A fake mailer: nothing is sent, the mails are kept for the test to read. */
function fakeMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    send: (to, subject, text) => {
      sent.push({ to, subject, text });
      return Promise.resolve();
    },
  };
  const lastCode = () => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '')?.[1] ?? '';
  return { mailer, sent, lastCode };
}

const appWith = (mailer: Mailer | null) => createApp({ pool, config: testAppConfig(), mailer });

async function setDmEmail(email: string | null) {
  await pool.execute('UPDATE users SET email = ? WHERE id = ?', [email, w.users.dm]);
}

async function otpRows() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT code_hash, attempts, used_at FROM user_otp WHERE user_id = ? ORDER BY id',
    [w.users.dm],
  );
  return rows;
}

beforeAll(() => {
  pool = createTestAppPool();
  migrator = createTestMigrationPool();
});
afterAll(async () => {
  await pool.end();
  await migrator.end();
});
beforeEach(async () => {
  await resetData(migrator);
  w = await buildAdminWorld(pool);
});

describe('DM profile (मेरी प्रोफ़ाइल)', () => {
  it('correct OTP + current password changes the password; other DM sessions end, this one stays', async () => {
    await setDmEmail(DM_EMAIL);
    const mail = fakeMailer();
    const app = appWith(mail.mailer);
    const dm = await apiClient(app, 'dm_x4');
    const otherDevice = await apiClient(app, 'dm_x4');

    const profile = await dm.get('/api/profile');
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual({
      username: 'dm_x4',
      fullName: 'Full dm_x4',
      email: 'c*****u@gmail.com',
    });

    const sent = await dm.post('/api/profile/send-otp', { purpose: 'PASSWORD' });
    expect(sent.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(DM_EMAIL);
    const code = mail.lastCode();
    expect(code).toMatch(/^\d{6}$/);
    // Only a hash is stored; a second send within 60 s is refused.
    expect(JSON.stringify(await otpRows())).not.toContain(code);
    expect((await dm.post('/api/profile/send-otp', { purpose: 'PASSWORD' })).status).toBe(429);

    const res = await dm.post('/api/profile/password', {
      otp: code,
      password: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);

    expect((await dm.get('/api/auth/me')).status).toBe(200);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await login(request.agent(app), 'dm_x4', PASSWORD)).status).toBe(401);
    expect((await login(request.agent(app), 'dm_x4', NEW_PASSWORD)).status).toBe(200);

    // The code works once only.
    const again = await dm.post('/api/profile/password', {
      otp: code,
      password: NEW_PASSWORD,
      newPassword: 'Doosra-Pass-77y',
      confirmPassword: 'Doosra-Pass-77y',
    });
    expect(again.body).toMatchObject({ error: 'OTP_NOT_SENT' });

    const audit = await auditOf(pool, 'DM_PASSWORD_CHANGED');
    expect(audit).toHaveLength(1);
    const logged = JSON.stringify(audit) + JSON.stringify(await auditOf(pool, 'DM_OTP_SENT'));
    for (const secret of [code, NEW_PASSWORD, PASSWORD, DM_EMAIL])
      expect(logged).not.toContain(secret);
    expect(logged).toContain('c*****u@gmail.com');
  });

  it('wrong OTP is counted; after 5 wrong tries the code is dead, even the right one', async () => {
    await setDmEmail(DM_EMAIL);
    const mail = fakeMailer();
    const dm = await apiClient(appWith(mail.mailer), 'dm_x4');
    expect((await dm.post('/api/profile/send-otp', { purpose: 'PASSWORD' })).status).toBe(200);
    const code = mail.lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const body = (otp: string) => ({
      otp,
      password: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    for (const left of [4, 3, 2, 1]) {
      const res = await dm.post('/api/profile/password', body(wrong));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'OTP_INVALID', attemptsLeft: left });
    }
    const fifth = await dm.post('/api/profile/password', body(wrong));
    expect(fifth.body).toEqual({ error: 'OTP_LOCKED' });
    const right = await dm.post('/api/profile/password', body(code));
    expect(right.status).toBe(400);
    expect(right.body).toEqual({ error: 'OTP_LOCKED' });

    expect(await otpRows()).toMatchObject([{ attempts: 5 }]);
    expect(await auditOf(pool, 'DM_PASSWORD_CHANGED')).toHaveLength(0);
    expect((await login(request.agent(appWith(null)), 'dm_x4', PASSWORD)).status).toBe(200);
  });

  it('an RO gets 403 on every profile route', async () => {
    const mail = fakeMailer();
    const app = appWith(mail.mailer);
    for (const username of ['ro_ps1_x1', 'zp_ro_x3']) {
      const ro = await apiClient(app, username);
      expect((await ro.get('/api/profile')).status).toBe(403);
      expect(
        (await ro.post('/api/profile/name', { fullName: 'नया नाम', password: PASSWORD })).status,
      ).toBe(403);
      expect((await ro.post('/api/profile/send-otp', { purpose: 'PASSWORD' })).status).toBe(403);
      expect(
        (
          await ro.post('/api/profile/username', {
            newUsername: 'naya_ro',
            otp: '123456',
            password: PASSWORD,
          })
        ).status,
      ).toBe(403);
    }
    expect(mail.sent).toHaveLength(0);
    expect(await otpRows()).toHaveLength(0);
  });

  it('no saved email, or no mail service: no OTP, no change', async () => {
    const mail = fakeMailer();
    const noEmail = await apiClient(appWith(mail.mailer), 'dm_x4');
    expect((await noEmail.get('/api/profile')).body).toMatchObject({ email: null });
    const r1 = await noEmail.post('/api/profile/send-otp', { purpose: 'USERNAME' });
    expect(r1.status).toBe(409);
    expect(r1.body).toEqual({ error: 'EMAIL_NOT_SET' });
    expect(mail.sent).toHaveLength(0);

    await setDmEmail(DM_EMAIL);
    const noSmtp = await apiClient(appWith(null), 'dm_x4');
    const r2 = await noSmtp.post('/api/profile/send-otp', { purpose: 'PASSWORD' });
    expect(r2.status).toBe(503);
    expect(r2.body).toEqual({ error: 'MAIL_NOT_CONFIGURED' });

    // Without a code nothing changes either.
    const r3 = await noSmtp.post('/api/profile/username', {
      newUsername: 'naya_dm',
      otp: '123456',
      password: PASSWORD,
    });
    expect(r3.body).toEqual({ error: 'OTP_NOT_SENT' });
    expect(await otpRows()).toHaveLength(0);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT username FROM users WHERE id = ?', [
      w.users.dm,
    ]);
    expect(rows[0]?.username).toBe('dm_x4');
  });
});
