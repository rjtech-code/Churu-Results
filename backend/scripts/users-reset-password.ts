// npm run users:reset-password -- --username <u> [--commit]
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { generatePassword, hashPassword } from './lib/password.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { findUser, passwordBanner } from './lib/users.js';

export async function runUsersResetPassword(
  options: { username?: string | undefined; commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('users-reset-password', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  // Set only after a successful commit; printed once on the terminal, never stored.
  let password: string | null = null;
  const username = options.username ?? '';
  if (username === '') report.error('--username <u> is required.');

  if (report.isOk()) {
    try {
      const result = await inTransaction<string | null>(ctx.pool, async (conn) => {
        const user = await findUser(conn, username);
        if (!user) {
          report.error(`No user "${username}".`);
          return { commit: false, value: null };
        }
        report.line(
          `Account: ${user.username} — ${user.role}${user.ps_name === null ? '' : ` — ${user.ps_name}`}`,
        );
        report.line(
          'A new password will be generated; failed-login count and lockout are cleared.',
        );
        if (user.is_active !== 1)
          report.warn('This account is DISABLED; run users:enable to allow login.');
        if (options.commit !== true) return { commit: false, value: null };

        const newPassword = generatePassword();
        await conn.execute(
          'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
          [await hashPassword(newPassword), user.id],
        );
        await writeAudit(conn, {
          action: 'USER_RESET_PASSWORD',
          entity: 'users',
          entityId: user.id,
          newValue: { username: user.username, failed_login_count: 0, locked_until: null },
        });
        return { commit: true, value: newPassword };
      });
      committed = result.committed;
      password = result.committed ? result.value : null;
    } catch (err) {
      reportFailure(report, err);
    }
  }
  const outcome = await finishReport(ctx, report, startedAt, committed);
  if (committed && password !== null) ctx.out(passwordBanner(username, password));
  return outcome;
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { username: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run users:reset-password -- --username <u> [--commit]',
  );
  return runUsersResetPassword(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
