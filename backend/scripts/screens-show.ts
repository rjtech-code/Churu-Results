// npm run screens:show — which Panchayat Samitis appear on media-room screens 1 and 2.
import type { RowDataPacket } from 'mysql2/promise';
import { SCREEN_LAYOUT_KEY, validateScreenLayout } from '../src/services/screen-layout.js';
import { UsageError, isMainModule, runCli } from './lib/cli.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

export async function runScreensShow(
  ctx: ScriptContext,
): Promise<ScriptResult & { layout: unknown }> {
  const startedAt = ctx.now();
  const report = new Report('screens-show', 'read-only');
  let layout: unknown = null;
  try {
    const [rows] = await ctx.pool.execute<RowDataPacket[]>(
      'SELECT setting_value FROM app_settings WHERE setting_key = ?',
      [SCREEN_LAYOUT_KEY],
    );
    const [ps] = await ctx.pool.execute<RowDataPacket[]>(
      'SELECT name_english FROM panchayat_samiti ORDER BY name_english',
    );
    if (rows[0] === undefined)
      report.error('The screen_layout setting is missing (run npm run migrate).');
    else {
      layout = JSON.parse(String(rows[0].setting_value)) as unknown;
      const obj = layout as Record<string, unknown>;
      for (const screen of ['1', '2']) {
        const list = Array.isArray(obj[screen]) ? (obj[screen] as unknown[]) : [];
        report.section(
          `Screen ${screen}`,
          list.map((n, i) => `${i + 1}. ${String(n)}`),
        );
      }
      report.section('Screen 3', ['Zila Parishad (always)']);
      if (ps.length === 0)
        report.warn('No Panchayat Samitis imported yet; the layout cannot be checked.');
      else {
        const { problems } = validateScreenLayout(
          layout,
          ps.map((p) => String(p.name_english)),
        );
        for (const p of problems) report.warn(`Layout problem: ${p}`);
        if (problems.length === 0)
          report.line('Layout is valid: all Panchayat Samitis appear exactly once.');
      }
    }
  } catch (err) {
    reportFailure(report, err);
  }
  return { ...(await finishReport(ctx, report, startedAt, false)), layout };
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  if (argv.length > 0) throw new UsageError('Usage: npm run screens:show');
  return runScreensShow(ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
