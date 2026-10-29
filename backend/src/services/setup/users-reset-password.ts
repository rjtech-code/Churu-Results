// npm run users:reset-password -- --username <u> [--commit]
import { setNewPassword } from '../master-data/accounts.js';
import { writeAudit } from './audit.js';
import { inTransaction } from './db.js';
import { Report } from './report.js';
import { finishReport, reportFailure } from './run.js';
import type { ScriptContext, ScriptResult } from './run.js';
import { findUser, passwordBanner } from './users.js';

export async function runUsersResetPassword(
  options: { username?: string | undefined; commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult & { password: string | null }> {
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

        const newPassword = await setNewPassword(conn, user.id, ctx.roPasswordKey);
        await writeAudit(
          conn,
          {
            action: 'USER_RESET_PASSWORD',
            entity: 'users',
            entityId: user.id,
            newValue: { username: user.username, failed_login_count: 0, locked_until: null },
          },
          ctx.actor,
        );
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
  // Returned for the Super Admin panel (shown once there); never saved anywhere.
  return { ...outcome, password: committed ? password : null };
}
