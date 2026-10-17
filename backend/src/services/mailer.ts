// Outgoing mail (only the DM profile OTP uses it). SMTP settings come only from the environment.
// No SMTP: production has NO mailer (the profile change is refused, no bypass); outside production
// the mail is printed on the server console so the flow can be tried locally.
import nodemailer from 'nodemailer';
import type { AppEnv } from '../config/env.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Shows an email as c*****u@gmail.com (first and last letter of the name part). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '*****';
  const name = email.slice(0, at);
  const shown = name.length === 1 ? name : `${name.charAt(0)}*****${name.charAt(name.length - 1)}`;
  return `${shown}${email.slice(at)}`;
}

export function createMailer(env: AppEnv): Mailer | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM) {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = TLS from the start; other ports must upgrade (STARTTLS)
      requireTLS: SMTP_PORT !== 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    return {
      send: async (to, subject, text) => {
        await transport.sendMail({ from: MAIL_FROM, to, subject, text });
      },
    };
  }
  return env.NODE_ENV === 'production' ? null : consoleMailer;
}

/** Outside production only: prints the mail (with the OTP) on the server console, sends nothing. */
export const consoleMailer: Mailer = {
  send: (to, subject, text) => {
    console.log(`[dev mail, not sent] to ${maskEmail(to)} | ${subject}\n${text}`);
    return Promise.resolve();
  },
};
