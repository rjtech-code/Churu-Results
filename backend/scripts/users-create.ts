// npm run users:create -- --role <PS_RO|ZP_RO|DM> --username <u> [--ps <name>] --full-name "<name>" [--commit]
import type { ResultSetHeader } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { countOf, inTransaction } from './lib/db.js';
import { loadPanchayatSamitis } from './lib/lookups.js';
import { generatePassword, hashPassword } from './lib/password.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey, normalizeText } from './lib/text.js';
import { ROLES, ROLE_LIMITS, USERNAME_PATTERN, findUser, passwordBanner } from './lib/users.js';
import type { Role } from './lib/users.js';

export interface CreateUserOptions {
  role?: string | undefined;
  username?: string | undefined;
  ps?: string | undefined;
  fullName?: string | undefined;
  commit?: boolean | undefined;
}

export async function runUsersCreate(
  options: CreateUserOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('users-create', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  // Set only after a successful commit; printed once on the terminal, never stored.
  let password: string | null = null;

  const role = options.role as Role;
  if (!ROLES.includes(role)) report.error(`--role must be one of ${ROLES.join(', ')}.`);
  const username = options.username ?? '';
  if (!USERNAME_PATTERN.test(username)) {
    report.error(
      '--username must be 4-30 characters: lowercase letters, digits and underscore only.',
    );
  }
  const fullName = options.fullName === undefined ? '' : normalizeText(options.fullName);
  if (fullName === '') report.error('--full-name "<name>" is required.');
  else if (fullName.length > 100) report.error('--full-name must be at most 100 characters.');
  if (role === 'PS_RO' && options.ps === undefined)
    report.error('A PS_RO needs --ps <Panchayat Samiti name>.');
  if ((role === 'ZP_RO' || role === 'DM') && options.ps !== undefined) {
    report.error(`A ${role} must not have --ps (it is not tied to one Panchayat Samiti).`);
  }

  if (report.isOk()) {
    try {
      const result = await inTransaction<string | null>(ctx.pool, async (conn) => {
        if (await findUser(conn, username)) report.error(`Username "${username}" already exists.`);

        let psId: number | null = null;
        let psName: string | null = null;
        if (role === 'PS_RO' && options.ps !== undefined) {
          const ps = (await loadPanchayatSamitis(conn)).get(matchKey(options.ps));
          if (!ps) report.error(`Unknown Panchayat Samiti "${options.ps}".`);
          else {
            psId = ps.id;
            psName = ps.name_english;
            const forPs = await countOf(
              conn,
              "SELECT COUNT(*) AS n FROM users WHERE role = 'PS_RO' AND panchayat_samiti_id = ?",
              [ps.id],
            );
            if (forPs > 0)
              report.error(`${ps.name_english} already has a PS_RO account (one per PS).`);
          }
        }
        const sameRole = await countOf(conn, 'SELECT COUNT(*) AS n FROM users WHERE role = ?', [
          role,
        ]);
        if (sameRole >= ROLE_LIMITS[role]) {
          report.error(
            `There are already ${sameRole} ${role} account(s); the limit is ${ROLE_LIMITS[role]} (disabled accounts count).`,
          );
        }
        report.line(
          `Account: ${username} — ${role}${psName === null ? '' : ` — ${psName}`} — ${fullName}`,
        );
        if (!report.isOk() || options.commit !== true) return { commit: false, value: null };

        const newPassword = generatePassword();
        const hash = await hashPassword(newPassword);
        const [inserted] = await conn.execute<ResultSetHeader>(
          `INSERT INTO users (username, full_name, password_hash, role, panchayat_samiti_id)
           VALUES (?, ?, ?, ?, ?)`,
          [username, fullName, hash, role, psId],
        );
        await writeAudit(conn, {
          action: 'USER_CREATE',
          entity: 'users',
          entityId: inserted.insertId,
          newValue: { username, full_name: fullName, role, panchayat_samiti: psName },
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
    {
      role: { type: 'string' },
      username: { type: 'string' },
      ps: { type: 'string' },
      'full-name': { type: 'string' },
      commit: { type: 'boolean' },
    },
    'npm run users:create -- --role <PS_RO|ZP_RO|DM> --username <u> [--ps <name>] --full-name "<name>" [--commit]',
  );
  return runUsersCreate({ ...values, fullName: values['full-name'] }, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
