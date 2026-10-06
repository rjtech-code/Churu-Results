// npm run users:disable -- --username <u> [--commit]
// npm run users:enable  -- --username <u> [--commit]
import { writeAudit } from './lib/audit.js';
import { UsageError, isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { findUser } from './lib/users.js';

export async function runUsersSetActive(
  action: 'enable' | 'disable',
  options: { username?: string | undefined; commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report(`users-${action}`, options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const username = options.username ?? '';
  if (username === '') report.error('--username <u> is required.');
  const active = action === 'enable';

  if (report.isOk()) {
    try {
      const result = await inTransaction(ctx.pool, async (conn) => {
        const user = await findUser(conn, username);
        if (!user) {
          report.error(`No user "${username}".`);
          return { commit: false, value: undefined };
        }
        report.line(
          `Account: ${user.username} — ${user.role}${user.ps_name === null ? '' : ` — ${user.ps_name}`}`,
        );
        if ((user.is_active === 1) === active) {
          report.error(`"${username}" is already ${active ? 'enabled' : 'disabled'}.`);
          return { commit: false, value: undefined };
        }
        await conn.execute('UPDATE users SET is_active = ? WHERE id = ?', [
          active ? 1 : 0,
          user.id,
        ]);
        await writeAudit(conn, {
          action: active ? 'USER_ENABLE' : 'USER_DISABLE',
          entity: 'users',
          entityId: user.id,
          oldValue: { is_active: !active },
          newValue: { username: user.username, is_active: active },
        });
        report.line(`${active ? 'Enabled' : 'Disabled'}: ${user.username}`);
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
  const usage = 'npm run users:disable|users:enable -- --username <u> [--commit]';
  const { values, positionals } = parseCli(
    argv,
    { username: { type: 'string' }, commit: { type: 'boolean' } },
    usage,
    true,
  );
  const action = positionals[0];
  if ((action !== 'enable' && action !== 'disable') || positionals.length !== 1) {
    throw new UsageError(`Usage: ${usage}`);
  }
  return runUsersSetActive(action, values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
