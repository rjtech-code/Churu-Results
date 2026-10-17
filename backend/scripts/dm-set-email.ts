// npm run set-dm-email -- <email> [--commit]
// Sets the DM's email (OTP for the DM profile page goes there). Only the active DM account; the
// page itself can never change it. The audit row keeps the email masked.
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { maskEmail } from '../src/services/mailer.js';
import { writeAudit } from './lib/audit.js';
import { UsageError, isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

const USAGE = 'npm run set-dm-email -- <email> [--commit]';
const emailSchema = z.email().max(190);

export interface SetDmEmailOptions {
  email?: string | undefined;
  commit?: boolean | undefined;
}

export async function runSetDmEmail(
  options: SetDmEmailOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('dm-set-email', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const email = (options.email ?? '').trim().toLowerCase();
  if (email === '') report.error(`An email is required. Usage: ${USAGE}`);
  else if (!emailSchema.safeParse(email).success)
    report.error('That is not a valid email address.');

  if (report.isOk()) {
    try {
      const result = await inTransaction(ctx.pool, async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          "SELECT id, username, email FROM users WHERE role = 'DM' AND is_active = 1 FOR UPDATE",
        );
        const dm = rows[0];
        if (!dm) {
          report.error('No active DM account.');
          return { commit: false, value: undefined };
        }
        const old = dm.email === null ? null : String(dm.email);
        if (old === email) {
          report.line(`The DM already has this email (${maskEmail(email)}). Nothing to do.`);
          return { commit: false, value: undefined };
        }
        const [taken] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? AND id <> ?',
          [email, dm.id],
        );
        if (taken.length > 0) {
          report.error('Another account already has this email.');
          return { commit: false, value: undefined };
        }
        await conn.execute('UPDATE users SET email = ? WHERE id = ?', [email, dm.id]);
        await writeAudit(conn, {
          action: 'DM_EMAIL_SET',
          entity: 'users',
          entityId: Number(dm.id),
          oldValue: { email: old === null ? null : maskEmail(old) },
          newValue: { username: String(dm.username), email: maskEmail(email) },
        });
        report.line(
          `DM "${String(dm.username)}": email ${old === null ? '(none)' : maskEmail(old)} -> ${email}`,
        );
        return { commit: options.commit === true, value: undefined };
      });
      committed = result.committed;
    } catch (err) {
      reportFailure(report, err);
    }
  }
  return finishReport(ctx, report, startedAt, committed);
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values, positionals } = parseCli(argv, { commit: { type: 'boolean' } }, USAGE, true);
  if (positionals.length > 1) {
    throw new UsageError(`Give exactly one email.\n\nUsage: ${USAGE}`);
  }
  return runSetDmEmail({ email: positionals[0], commit: values.commit }, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
