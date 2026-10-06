// npm run users:list — never shows password hashes.
import type { RowDataPacket } from 'mysql2/promise';
import { UsageError, isMainModule, runCli } from './lib/cli.js';
import { Report, formatIst } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { ROLE_LIMITS } from './lib/users.js';

export async function runUsersList(
  ctx: ScriptContext,
): Promise<ScriptResult & { usernames: string[] }> {
  const startedAt = ctx.now();
  const report = new Report('users-list', 'read-only');
  const usernames: string[] = [];
  try {
    const [rows] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT u.username, u.full_name, u.role, ps.name_english AS ps_name, u.is_active, u.last_login_at
         FROM users u LEFT JOIN panchayat_samiti ps ON ps.id = u.panchayat_samiti_id
        ORDER BY FIELD(u.role, 'DM', 'ZP_RO', 'PS_RO'), ps.name_english, u.username`,
    );
    const lines = [
      `${'username'.padEnd(22)}${'role'.padEnd(7)}${'active'.padEnd(8)}${'last login'.padEnd(26)}full name / PS`,
    ];
    for (const r of rows) {
      usernames.push(String(r.username));
      const lastLogin = r.last_login_at instanceof Date ? formatIst(r.last_login_at) : 'never';
      lines.push(
        `${String(r.username).padEnd(22)}${String(r.role).padEnd(7)}${(Number(r.is_active) === 1 ? 'yes' : 'NO').padEnd(8)}` +
          `${lastLogin.padEnd(26)}${r.full_name === null ? '-' : String(r.full_name)}${r.ps_name === null ? '' : ` / ${String(r.ps_name)}`}`,
      );
    }
    report.section(
      `Users (${rows.length} of ${Object.values(ROLE_LIMITS).reduce((a, b) => a + b, 0)} allowed)`,
      lines,
    );
  } catch (err) {
    reportFailure(report, err);
  }
  return { ...(await finishReport(ctx, report, startedAt, false)), usernames };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  if (argv.length > 0) throw new UsageError('Usage: npm run users:list');
  return runUsersList(ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
