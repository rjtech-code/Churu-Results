// npm run ps:set-hindi-names -- --file <json> [--commit]
// Sets the (short) Hindi names of existing Panchayat Samitis, e.g. { "RATANGARH PANCHAYAT SAMITI": "रतनगढ़" }.
// Only panchayat_samiti.name_hindi changes: wards, booths, candidates and entries are never touched, so
// this is safe even after counting data exists. Dry run by default; all-or-nothing; one audit row.
import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey, normalizeText } from './lib/text.js';

const MAX_LEN = 200; // panchayat_samiti.name_hindi VARCHAR(200)
const DEVANAGARI = /[ऀ-ॿ]/u;

interface PsRow {
  id: number;
  districtId: number;
  english: string;
  hindi: string;
}

/** Validates the file: { "<English PS name>": "<Hindi name>" }. Returns key -> {english as typed, hindi}. */
function parseNames(raw: unknown, report: Report): Map<string, { typed: string; hindi: string }> {
  const out = new Map<string, { typed: string; hindi: string }>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    report.error('The file must be a JSON object: { "<English PS name>": "<Hindi name>", ... }.');
    return out;
  }
  const seenHindi = new Map<string, string>();
  for (const [typed, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      report.error(`"${typed}": the Hindi name must be text.`);
      continue;
    }
    const hindi = normalizeText(value);
    if (hindi === '') report.error(`"${typed}": the Hindi name is empty.`);
    else if (!DEVANAGARI.test(hindi))
      report.error(`"${typed}": "${hindi}" is not a Hindi (Devanagari) name.`);
    else if (hindi.length > MAX_LEN)
      report.error(`"${typed}": the Hindi name is longer than ${MAX_LEN} characters.`);
    const key = matchKey(typed);
    if (out.has(key)) report.error(`"${typed}" appears twice in the file.`);
    const other = seenHindi.get(hindi);
    if (other !== undefined) report.error(`"${hindi}" is given to both "${other}" and "${typed}".`);
    seenHindi.set(hindi, typed);
    out.set(key, { typed, hindi });
  }
  if (out.size === 0 && report.isOk()) report.error('The file lists no Panchayat Samiti.');
  return out;
}

export async function runPsSetHindiNames(
  options: { file?: string | undefined; commit?: boolean | undefined },
  ctx: ScriptContext,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report('ps-set-hindi-names', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  let names = new Map<string, { typed: string; hindi: string }>();
  if (options.file === undefined) report.error('--file <json> is required.');
  else {
    try {
      names = parseNames(JSON.parse(await readFile(options.file, 'utf8')) as unknown, report);
    } catch (err) {
      report.error(
        `Cannot read ${options.file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (report.isOk()) {
    try {
      const result = await inTransaction(ctx.pool, async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          'SELECT id, district_id, name_english, name_hindi FROM panchayat_samiti ORDER BY id FOR UPDATE',
        );
        const all: PsRow[] = rows.map((r) => ({
          id: Number(r.id),
          districtId: Number(r.district_id),
          english: String(r.name_english),
          hindi: String(r.name_hindi),
        }));
        const byKey = new Map(all.map((p) => [matchKey(p.english), p]));
        for (const { typed } of names.values()) {
          if (!byKey.has(matchKey(typed))) report.error(`Unknown Panchayat Samiti: "${typed}".`);
        }
        // The final Hindi names must stay unique per district (the database enforces it too).
        const finalName = (p: PsRow) => names.get(matchKey(p.english))?.hindi ?? p.hindi;
        const owner = new Map<string, PsRow>();
        for (const p of all) {
          const key = `${p.districtId}:${finalName(p)}`;
          const clash = owner.get(key);
          if (clash)
            report.error(
              `"${finalName(p)}" would be the Hindi name of both "${clash.english}" and "${p.english}".`,
            );
          owner.set(key, p);
        }
        if (!report.isOk()) return { commit: false, value: undefined };

        const changes = all.filter((p) => finalName(p) !== p.hindi);
        for (const p of all.filter((x) => names.has(matchKey(x.english)))) {
          report.line(
            finalName(p) === p.hindi
              ? `${p.english}: no change ("${p.hindi}")`
              : `${p.english}: "${p.hindi}" -> "${finalName(p)}"`,
          );
        }
        if (changes.length === 0) {
          report.line('Nothing to change.');
          return { commit: false, value: undefined };
        }
        // Two steps, so swapping two names never hits the unique key on the way.
        for (const p of changes) {
          await conn.execute('UPDATE panchayat_samiti SET name_hindi = ? WHERE id = ?', [
            `~tmp-${p.id}`,
            p.id,
          ]);
        }
        for (const p of changes) {
          await conn.execute('UPDATE panchayat_samiti SET name_hindi = ? WHERE id = ?', [
            finalName(p),
            p.id,
          ]);
        }
        await writeAudit(conn, {
          action: 'PS_HINDI_NAMES_SET',
          entity: 'panchayat_samiti',
          entityId: null,
          oldValue: Object.fromEntries(changes.map((p) => [p.english, p.hindi])),
          newValue: Object.fromEntries(changes.map((p) => [p.english, finalName(p)])),
        });
        report.line(
          `${changes.length} Hindi name(s) ${options.commit === true ? 'saved' : 'would be saved'}.`,
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

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run ps:set-hindi-names -- --file <json> [--commit]',
  );
  return runPsSetHindiNames(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
