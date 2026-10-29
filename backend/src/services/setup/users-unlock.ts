// npm run users:unlock -- --username <u> --by "<name>" [--commit]
// Clears a login lockout (locked_until and failed_login_count). Does not change the password.
import type { RowDataPacket } from 'mysql2/promise';
import { clearLoginLock } from '../master-data/accounts.js';
import { writeAudit } from './audit.js';
import { inTransaction } from './db.js';
import { Report } from './report.js';
import { finishReport, reportFailure } from './run.js';
import type { ScriptContext, ScriptResult } from './run.js';
import { normalizeText } from '../master-data/text.js';

export interface UnlockUserOptions {
  username?: string | undefined;
  by?: string | undefined;
  commit?: boolean | undefined;
}

export async function runUsersUnlock(
  options: UnlockUserOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('users-unlock', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const username = options.username ?? '';
  if (username === '') report.error('--username <u> is required.');
  const by = options.by === undefined ? '' : normalizeText(options.by);
  if (by === '') report.error('--by "<name>" is required.');
  else if (by.length > 100) report.error('--by must be at most 100 characters.');

  if (report.isOk()) {
    try {
      const result = await inTransaction(ctx.pool, async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, username, failed_login_count, locked_until,
                  (locked_until IS NOT NULL AND locked_until > NOW(3)) AS locked_now
             FROM users WHERE username = ? FOR UPDATE`,
          [username],
        );
        const user = rows[0];
        if (!user) {
          report.error(`No user "${username}".`);
          return { commit: false, value: undefined };
        }
        const failed = Number(user.failed_login_count);
        const lockedUntil = user.locked_until instanceof Date ? user.locked_until : null;
        if (lockedUntil === null && failed === 0) {
          report.line(`"${username}" is not locked (no lock, no failed logins). Nothing to do.`);
          return { commit: false, value: undefined };
        }
        report.line(
          Number(user.locked_now) === 1
            ? `"${username}" is LOCKED; the lock and ${failed} failed login(s) will be cleared.`
            : `"${username}" is not locked now; leftover values (failed logins: ${failed}${lockedUntil === null ? '' : ', an expired lock'}) will be cleared.`,
        );
        await clearLoginLock(conn, Number(user.id));
        await writeAudit(
          conn,
          {
            action: 'USER_UNLOCKED',
            entity: 'users',
            entityId: Number(user.id),
            oldValue: {
              failed_login_count: failed,
              locked_until: lockedUntil === null ? null : lockedUntil.toISOString(),
            },
            newValue: { username, unlocked_by_name: by, failed_login_count: 0, locked_until: null },
          },
          ctx.actor,
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
