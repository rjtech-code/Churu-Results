// npm run users:create -- --role <PS_RO|ZP_RO|DM|SUPER_ADMIN|OBSERVER> --username <u> [--ps <name>] --full-name "<name>" [--commit]
// OBSERVER: the password is typed at a hidden prompt (never a CLI argument, never echoed or logged).
import {
  accountIssueTextEn,
  checkChosenPassword,
  checkNewAccount,
  insertAccount,
} from '../src/services/master-data/accounts.js';
import type { ChosenPasswordProblem } from '../src/services/master-data/accounts.js';
import { promptHidden } from './lib/hidden-prompt.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { loadPanchayatSamitis } from './lib/lookups.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey, normalizeText } from './lib/text.js';
import { ROLES, USERNAME_PATTERN, passwordBanner } from './lib/users.js';
import type { Role } from './lib/users.js';

export interface CreateUserOptions {
  role?: string | undefined;
  username?: string | undefined;
  ps?: string | undefined;
  fullName?: string | undefined;
  commit?: boolean | undefined;
  /** Hidden prompt for the OBSERVER password (tests inject their own; default: the terminal). */
  promptPassword?: (label: string) => Promise<string>;
}

/** The same rules the DM's "set password" page shows, in the script's English. */
const PASSWORD_PROBLEM_TEXT: Readonly<Record<ChosenPasswordProblem, string>> = {
  PASSWORD_TOO_SHORT: 'The password must be at least 10 characters.',
  PASSWORD_TOO_LONG: 'The password must be at most 128 characters.',
  PASSWORD_NEEDS_LETTER_AND_DIGIT: 'The password needs at least one letter and one digit.',
  PASSWORD_HAS_USERNAME: 'The password must not contain the username.',
  PASSWORD_TOO_COMMON: 'That password is too common or too easy to guess.',
  PASSWORD_MISMATCH: 'The two entries did not match.',
};

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
  if (role !== 'PS_RO' && options.ps !== undefined) {
    report.error(`A ${role} must not have --ps (it is not tied to one Panchayat Samiti).`);
  }

  // OBSERVER: the password is typed (hidden), checked with the same strength rules the DM's
  // "set password" page uses, and never printed, logged or stored outside the bcrypt hash.
  let chosenPassword: string | undefined;
  if (report.isOk() && role === 'OBSERVER' && options.commit === true) {
    const prompt = options.promptPassword ?? promptHidden;
    try {
      const typed = await prompt(`Password for "${username}" (hidden): `);
      const confirmTyped = await prompt('Type the password again: ');
      const problems = checkChosenPassword(typed, confirmTyped, username);
      for (const problem of problems) report.error(PASSWORD_PROBLEM_TEXT[problem]);
      if (problems.length === 0) chosenPassword = typed;
    } catch (err) {
      reportFailure(report, err);
    }
  }

  if (report.isOk()) {
    try {
      const result = await inTransaction<string | null>(ctx.pool, async (conn) => {
        let psId: number | null = null;
        let psName: string | null = null;
        if (role === 'PS_RO' && options.ps !== undefined) {
          const ps = (await loadPanchayatSamitis(conn)).get(matchKey(options.ps));
          if (!ps) report.error(`Unknown Panchayat Samiti "${options.ps}".`);
          else {
            psId = ps.id;
            psName = ps.name_english;
          }
        }
        for (const issue of await checkNewAccount(conn, { role, username, psId, psName }))
          report.error(accountIssueTextEn(issue));
        report.line(
          `Account: ${username} — ${role}${psName === null ? '' : ` — ${psName}`} — ${fullName}`,
        );
        if (!report.isOk() || options.commit !== true) return { commit: false, value: null };

        const inserted = await insertAccount(
          conn,
          chosenPassword === undefined
            ? { username, fullName, role, psId }
            : { username, fullName, role, psId, chosenPassword },
          ctx.roPasswordKey,
        );
        await writeAudit(conn, {
          action: 'USER_CREATE',
          entity: 'users',
          entityId: inserted.id,
          newValue: { username, full_name: fullName, role, panchayat_samiti: psName },
        });
        return { commit: true, value: inserted.password };
      });
      committed = result.committed;
      password = result.committed ? result.value : null;
    } catch (err) {
      reportFailure(report, err);
    }
  }

  const outcome = await finishReport(ctx, report, startedAt, committed);
  // An observer typed their own password: it is never shown back.
  if (committed && password !== null && chosenPassword === undefined)
    ctx.out(passwordBanner(username, password));
  if (committed && chosenPassword !== undefined)
    ctx.out('The password is the one typed at the prompt. It is not saved or shown anywhere.');
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
    'npm run users:create -- --role <PS_RO|ZP_RO|DM|SUPER_ADMIN|OBSERVER> --username <u> [--ps <name>] --full-name "<name>" [--commit]',
  );
  return runUsersCreate({ ...values, fullName: values['full-name'] }, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
