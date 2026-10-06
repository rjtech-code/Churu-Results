// npm run screens:set -- --file <json> [--commit]
// Sets which Panchayat Samitis appear on media-room screens 1 and 2 (screen 3 is always ZP).
// The running server notices the change within ~2 seconds and rebuilds the public snapshot.
import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { SCREEN_LAYOUT_KEY, validateScreenLayout } from '../src/services/screen-layout.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

export async function runScreensSet(
  options: { file?: string | undefined; commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('screens-set', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  if (options.file === undefined) {
    report.error(
      '--file <json> is required, e.g. {"1": ["CHURU PANCHAYAT SAMITI", ...], "2": [...]}.',
    );
    return finishReport(ctx, report, startedAt, false);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(options.file, 'utf8')) as unknown;
  } catch (err) {
    report.error(
      `Cannot read "${options.file}" as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return finishReport(ctx, report, startedAt, false);
  }
  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const [ps] = await conn.execute<RowDataPacket[]>(
        'SELECT name_english FROM panchayat_samiti ORDER BY name_english',
      );
      if (ps.length === 0) {
        report.error('No Panchayat Samitis imported yet (run import:geography first).');
        return { commit: false, value: undefined };
      }
      const { problems, layout } = validateScreenLayout(
        raw,
        ps.map((p) => String(p.name_english)),
      );
      for (const p of problems) report.error(p);
      if (layout === null) return { commit: false, value: undefined };
      report.section(
        'Screen 1',
        layout['1'].map((n, i) => `${i + 1}. ${n}`),
      );
      report.section(
        'Screen 2',
        layout['2'].map((n, i) => `${i + 1}. ${n}`),
      );
      report.section('Screen 3', ['Zila Parishad (always)']);

      const [old] = await conn.execute<RowDataPacket[]>(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? FOR UPDATE',
        [SCREEN_LAYOUT_KEY],
      );
      const oldValue =
        old[0] === undefined ? null : (JSON.parse(String(old[0].setting_value)) as unknown);
      const value = JSON.stringify(layout);
      if (old[0] === undefined) {
        await conn.execute('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', [
          SCREEN_LAYOUT_KEY,
          value,
        ]);
      } else {
        await conn.execute('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?', [
          value,
          SCREEN_LAYOUT_KEY,
        ]);
      }
      await writeAudit(conn, {
        action: 'SCREEN_LAYOUT_CHANGED',
        entity: 'app_settings',
        entityId: null,
        oldValue,
        newValue: layout,
      });
      return { commit: options.commit === true, value: undefined };
    });
    committed = result.committed;
    if (committed)
      report.line('Saved. The running server shows the new layout within about 2 seconds.');
  } catch (err) {
    reportFailure(report, err);
  }
  return finishReport(ctx, report, startedAt, committed);
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run screens:set -- --file <json> [--commit]',
  );
  return runScreensSet(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
