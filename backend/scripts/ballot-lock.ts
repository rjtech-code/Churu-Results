// npm run ballot:lock -- (--ward <id> | --ps <name> | --all) --by "<person name>" [--commit] [--yes]
import type { Pool, PoolConnection } from 'mysql2/promise';
import { applyLock, planLock as sharedPlanLock } from '../src/services/master-data/ballot-lock.js';
import type { LockPlan } from '../src/services/master-data/ballot-lock.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { loadPanchayatSamitis, loadWards, wardLabel } from './lib/lookups.js';
import type { WardRow } from './lib/lookups.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey, normalizeText } from './lib/text.js';

export interface LockOptions {
  ward?: string | undefined;
  ps?: string | undefined;
  all?: boolean | undefined;
  by?: string | undefined;
  commit?: boolean | undefined;
  yes?: boolean | undefined;
}

export interface LockResult extends ScriptResult {
  locked: number[];
  alreadyLocked: number[];
}

/** Works out which wards to lock. Adds errors to the report (all-or-nothing). */
async function planLock(
  conn: Pool | PoolConnection,
  options: LockOptions,
  report: Report,
): Promise<LockPlan> {
  const wards = await loadWards(conn);
  let select: (w: WardRow) => boolean = () => true;
  if (options.ward !== undefined) {
    const id = /^\d+$/.test(options.ward) ? Number(options.ward) : NaN;
    if (!wards.some((w) => w.id === id)) {
      report.error(`No ward with id "${options.ward}". Use npm run ballot:report to see ward ids.`);
      select = () => false;
    } else select = (w) => w.id === id;
  } else if (options.ps !== undefined) {
    const ps = (await loadPanchayatSamitis(conn)).get(matchKey(options.ps));
    if (!ps) {
      report.error(`Unknown Panchayat Samiti "${options.ps}"`);
      select = () => false;
    } else select = (w) => w.ward_type === 'PS' && w.panchayat_samiti_id === ps.id;
  }
  const plan = await sharedPlanLock(conn, select, wards);
  for (const w of plan.noCandidates)
    report.error(`${wardLabel(w)} has no candidates; it cannot be locked`);
  return plan;
}

export async function runBallotLock(options: LockOptions, ctx: ScriptContext): Promise<LockResult> {
  const startedAt = ctx.now();
  const report = new Report('ballot-lock', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  let locked: number[] = [];
  let alreadyLocked: number[] = [];
  const done = async (): Promise<LockResult> => ({
    ...(await finishReport(ctx, report, startedAt, committed)),
    locked,
    alreadyLocked,
  });

  const selectors = [
    options.ward !== undefined,
    options.ps !== undefined,
    options.all === true,
  ].filter(Boolean);
  if (selectors.length !== 1)
    report.error('Give exactly one of --ward <id>, --ps <name> or --all.');
  const by = options.by === undefined ? '' : normalizeText(options.by);
  if (by === '') report.error('--by "<person name>" is required.');
  else if (by.length > 100) report.error('--by must be at most 100 characters.');
  if (!report.isOk()) return done();

  try {
    // First pass (read only) so the operator sees what will be locked before confirming.
    const preview = await planLock(ctx.pool, options, report);
    report.section(`Wards to LOCK (${preview.toLock.length})`, preview.toLock.map(wardLabel));
    report.section(
      `Already locked — skipped (${preview.alreadyLocked.length})`,
      preview.alreadyLocked.map(wardLabel),
    );
    if (!report.isOk()) return await done();

    if (options.commit === true && options.yes !== true && preview.toLock.length > 0) {
      ctx.out(`About to LOCK ${preview.toLock.length} ward ballot(s), locked by: ${by}`);
      for (const w of preview.toLock) ctx.out(`  - ${wardLabel(w)}`);
      const answer = await ctx.confirm('Type LOCK to confirm: ');
      if (answer.trim() !== 'LOCK') {
        report.error('Not confirmed (you did not type LOCK). Nothing was locked.');
        return await done();
      }
    }

    const result = await inTransaction(ctx.pool, async (conn) => {
      const plan = await planLock(conn, options, report);
      const same =
        plan.toLock.map((w) => w.id).join(',') === preview.toLock.map((w) => w.id).join(',');
      if (!same)
        report.error('The wards changed while you were confirming. Run the command again.');
      if (!report.isOk()) return { commit: false, value: plan };
      await applyLock(conn, plan.toLock, { userId: null, name: by });
      await writeAudit(conn, {
        action: 'BALLOT_LOCK',
        entity: 'ward',
        entityId: plan.toLock.length === 1 ? (plan.toLock[0]?.id ?? null) : null,
        newValue: {
          locked_by_name: by,
          scope:
            options.ward !== undefined
              ? `ward ${options.ward}`
              : options.ps !== undefined
                ? `ps ${options.ps}`
                : 'all',
          locked_ward_ids: plan.toLock.map((w) => w.id),
          locked_wards: plan.toLock.map(wardLabel),
          already_locked_ward_ids: plan.alreadyLocked.map((w) => w.id),
        },
      });
      return { commit: options.commit === true, value: plan };
    });
    committed = result.committed;
    if (report.isOk()) {
      locked = result.value.toLock.map((w) => w.id);
      alreadyLocked = result.value.alreadyLocked.map((w) => w.id);
    }
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
      ps: { type: 'string' },
      all: { type: 'boolean' },
      by: { type: 'string' },
      commit: { type: 'boolean' },
      yes: { type: 'boolean' },
    },
    'npm run ballot:lock -- (--ward <id> | --ps <name> | --all) --by "<person name>" [--commit] [--yes]',
  );
  return runBallotLock(values, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
