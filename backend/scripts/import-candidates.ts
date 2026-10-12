// npm run import:candidates -- --file <xlsx> [--commit]
//
// Replaces the candidate list of every ward that appears in the file (wards not in the file are
// left alone). Adds NOTA at position N+1, except in single-candidate (unopposed) wards.
import { basename } from 'node:path';
import {
  CANDIDATE_COLUMNS,
  NOTA_NAME_HINDI,
  OPTIONAL_CANDIDATE_COLUMNS,
  checkWardList,
  loadCandidateLookups,
  parseCandidateSheet,
  replaceWardCandidates,
} from '../src/services/master-data/candidates.js';
import { IssueList } from '../src/services/master-data/issues.js';
import { reportIssues } from '../src/services/master-data/issues-en.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import { wardLabel } from './lib/lookups.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { readSheet } from './lib/xlsx.js';

export { CANDIDATE_COLUMNS, NOTA_NAME_HINDI, OPTIONAL_CANDIDATE_COLUMNS };

export interface CandidatesOptions {
  file?: string | undefined;
  commit?: boolean | undefined;
}

export interface CandidatesResult extends ScriptResult {
  replacedWards: string[];
  unopposedWards: string[];
}

export async function runImportCandidates(
  options: CandidatesOptions,
  ctx: ScriptContext,
): Promise<CandidatesResult> {
  const startedAt = ctx.now();
  const report = new Report('import-candidates', options.commit === true ? 'commit' : 'dry-run');
  let committed = false;
  const replacedWards: string[] = [];
  const unopposedWards: string[] = [];
  const done = async (): Promise<CandidatesResult> => ({
    ...(await finishReport(ctx, report, startedAt, committed)),
    replacedWards,
    unopposedWards,
  });

  if (options.file === undefined || options.file.trim() === '') {
    report.error('--file <xlsx> is required.');
    return done();
  }
  const file = options.file;
  let sha256: string;
  try {
    sha256 = await sha256File(file);
  } catch (err) {
    report.error(`Cannot read file "${file}": ${err instanceof Error ? err.message : String(err)}`);
    return done();
  }
  report.line(`File: ${file}`);
  report.line(`SHA-256: ${sha256}`);
  const sheet = await readSheet(file, CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS);
  if (!sheet.ok) {
    report.error(sheet.error);
    return done();
  }
  report.line(`Sheet: ${sheet.sheetName} (${sheet.rows.length} data rows)`);

  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const lk = await loadCandidateLookups(conn);
      const { wards, existingCount } = lk;
      const issues = new IssueList();

      // 1. Rows.
      const byWard = parseCandidateSheet(sheet.rows, lk, issues);

      // 2. Per-ward rules.
      for (const { ward, rows } of byWard.values()) {
        checkWardList(ward, rows, lk.withEntries.has(ward.id), true, issues);
      }
      reportIssues(report, issues);

      // 3. Wards not in the file.
      const notInFile = wards.filter((w) => !byWard.has(w.id));
      report.section(
        `Wards NOT in this file (${notInFile.length}) — left unchanged`,
        notInFile.map((w) => {
          const n = existingCount.get(w.id) ?? 0;
          return `${wardLabel(w)}: ${n === 0 ? 'NO CANDIDATES YET' : `keeps ${n} existing candidate(s)`}`;
        }),
      );
      const empty = notInFile.filter((w) => (existingCount.get(w.id) ?? 0) === 0).length;
      if (empty > 0)
        report.warn(`${empty} ward(s) have no candidates at all yet (see list above).`);

      // 4. Plan and write.
      const newWards: string[] = [];
      let candidateCount = 0;
      for (const { ward, rows } of byWard.values()) {
        const label = wardLabel(ward);
        if ((existingCount.get(ward.id) ?? 0) > 0) replacedWards.push(label);
        else newWards.push(label);
        if (rows.length === 1) unopposedWards.push(label);
        candidateCount += rows.length;
      }
      report.section(`Wards loaded for the first time (${newWards.length})`, newWards);
      report.section(
        `Wards whose candidates are REPLACED (${replacedWards.length})`,
        replacedWards,
      );
      report.section(
        `UNOPPOSED wards — exactly one candidate, no NOTA (${unopposedWards.length})`,
        unopposedWards,
      );
      report.line('');
      report.line(`Candidates in file: ${candidateCount} in ${byWard.size} ward(s).`);
      if (!report.isOk()) {
        replacedWards.length = 0;
        unopposedWards.length = 0;
        return { commit: false, value: undefined };
      }

      for (const { ward, rows } of byWard.values()) {
        await replaceWardCandidates(conn, ward.id, rows, { set: rows[0]?.category ?? null });
      }
      await writeAudit(conn, {
        action: 'IMPORT_CANDIDATES',
        entity: 'candidate',
        entityId: null,
        newValue: {
          file: basename(file),
          sha256,
          wards_loaded: byWard.size,
          candidates: candidateCount,
          new_wards: newWards,
          replaced_wards: replacedWards,
          unopposed_wards: unopposedWards,
        },
      });
      return { commit: options.commit === true, value: undefined };
    });
    committed = result.committed;
  } catch (err) {
    reportFailure(report, err);
    replacedWards.length = 0;
    unopposedWards.length = 0;
  }
  return done();
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { file: { type: 'string' }, commit: { type: 'boolean' } },
    'npm run import:candidates -- --file <xlsx> [--commit]',
  );
  return runImportCandidates(
    {
      file: values.file === undefined ? undefined : resolveUserPath(values.file),
      commit: values.commit,
    },
    ctx,
  );
}

if (isMainModule(import.meta.url)) await runCli(main);
