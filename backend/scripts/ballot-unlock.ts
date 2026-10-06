// npm run ballot:unlock -- --ward <id> --reason "<text>" --by "<name>" [--commit]
import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { countOf, inTransaction } from './lib/db.js';
import { loadWards, wardLabel } from './lib/lookups.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { normalizeText } from './lib/text.js';

export interface UnlockOptions {
  ward?: string | undefined;
  reason?: string | undefined;
  by?: string | undefined;
  commit?: boolean | undefined;
}

export async function runBallotUnlock(
  options: UnlockOptions,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('ballot-unlock', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const done = () => finishReport(ctx, report, startedAt, committed);

  const wardId =
    options.ward !== undefined && /^\d+$/.test(options.ward) ? Number(options.ward) : null;
  if (wardId === null)
    report.error('--ward <id> is required (a number; see npm run ballot:report).');
  const reason = options.reason === undefined ? '' : normalizeText(options.reason);
  if (reason === '') report.error('--reason "<text>" is required.');
  else if (reason.length > 1000) report.error('--reason must be at most 1000 characters.');
  const by = options.by === undefined ? '' : normalizeText(options.by);
  if (by === '') report.error('--by "<name>" is required.');
  if (!report.isOk() || wardId === null) return done();

  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const ward = (await loadWards(conn)).find((w) => w.id === wardId);
      if (!ward) {
        report.error(`No ward with id ${wardId}.`);
        return { commit: false, value: undefined };
      }
      const label = wardLabel(ward);
      report.line(`Ward: ${label}`);
      if (ward.is_locked !== 1) report.error(`${label} is not locked.`);
      const boothEntries = await countOf(
        conn,
        'SELECT COUNT(*) AS n FROM booth_entry WHERE ward_id = ?',
        [wardId],
      );
      const postalEntries = await countOf(
        conn,
        'SELECT COUNT(*) AS n FROM postal_entry WHERE ward_id = ?',
        [wardId],
      );
      if (boothEntries + postalEntries > 0) {
        report.error(
          `${label} already has ${boothEntries} booth entr(ies) and ${postalEntries} postal entr(ies); it can no longer be unlocked.`,
        );
      }
      if (!report.isOk()) return { commit: false, value: undefined };

      const [before] = await conn.execute<RowDataPacket[]>(
        'SELECT locked_at, locked_by, locked_by_name FROM ward WHERE id = ?',
        [wardId],
      );
      await conn.execute(
        'UPDATE ward SET is_locked = 0, locked_at = NULL, locked_by = NULL, locked_by_name = NULL WHERE id = ?',
        [wardId],
      );
      await writeAudit(conn, {
        action: 'BALLOT_UNLOCK',
        entity: 'ward',
        entityId: wardId,
        oldValue: before[0] ?? null,
        newValue: { ward: label, unlocked_by_name: by },
        reason,
      });
      report.line(`Unlocked by ${by}. Reason: ${reason}`);
      return { commit: options.commit === true, value: undefined };
    });
    committed = result.committed;
  } catch (err) {
    reportFailure(report, err);
  }
  return done();
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    {
      ward: { type: 'string' },
      reason: { type: 'string' },
      by: { type: 'string' },
      commit: { type: 'boolean' },
    },
    'npm run ballot:unlock -- --ward <id> --reason "<text>" --by "<name>" [--commit]',
  );
  return runBallotUnlock(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
