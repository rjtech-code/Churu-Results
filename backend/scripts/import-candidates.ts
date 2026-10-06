// npm run import:candidates -- --file <xlsx> [--commit]
//
// Replaces the candidate list of every ward that appears in the file (wards not in the file are
// left alone). Adds NOTA at position N+1, except in single-candidate (unopposed) wards.
import { basename } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from './lib/audit.js';
import { optionalText, requireInt, requireText } from './lib/cells.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { sha256File } from './lib/file-hash.js';
import {
  loadPanchayatSamitis,
  loadWards,
  wardKey,
  wardLabel,
  wardsWithEntries,
} from './lib/lookups.js';
import type { WardRow } from './lib/lookups.js';
import { resolveUserPath } from './lib/paths.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';
import { matchKey } from './lib/text.js';
import { readSheet } from './lib/xlsx.js';

export const CANDIDATE_COLUMNS = [
  'panchayat_samiti',
  'election',
  'ward_no',
  'ballot_position',
  'name_hindi',
  'party_short_name',
  'gender',
] as const;
export const OPTIONAL_CANDIDATE_COLUMNS = ['reservation_category'] as const;

/** Label of the NOTA row on every contested ballot. */
export const NOTA_NAME_HINDI = 'इनमें से कोई नहीं';

const GENDERS = new Set(['M', 'F', 'O']);

export interface CandidatesOptions {
  file?: string | undefined;
  commit?: boolean | undefined;
}

export interface CandidatesResult extends ScriptResult {
  replacedWards: string[];
  unopposedWards: string[];
}

interface CandidateRow {
  rowNumber: number;
  position: number;
  nameHindi: string;
  partyId: number | null;
  partyShort: string | null;
  gender: string;
  category: string | null;
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
      const psByName = await loadPanchayatSamitis(conn);
      const wards = await loadWards(conn);
      const wardByKey = new Map(
        wards.map((w) => [wardKey(w.ward_type, w.panchayat_samiti_id, w.ward_no), w]),
      );
      const [partyRows] = await conn.query<RowDataPacket[]>('SELECT id, short_name FROM party');
      const partyByShort = new Map(
        partyRows.map((p) => [matchKey(String(p.short_name)), Number(p.id)]),
      );
      const withEntries = await wardsWithEntries(conn);
      const [countRows] = await conn.query<RowDataPacket[]>(
        'SELECT ward_id, COUNT(*) AS n FROM candidate WHERE is_nota = 0 GROUP BY ward_id',
      );
      const existingCount = new Map(countRows.map((r) => [Number(r.ward_id), Number(r.n)]));

      // 1. Rows.
      const byWard = new Map<number, { ward: WardRow; rows: CandidateRow[] }>();
      for (const row of sheet.rows) {
        if (row.allText.some((t) => /EXAMPLE/i.test(t))) {
          report.error(
            'This row is a template EXAMPLE row; delete it before importing',
            row.rowNumber,
          );
          continue;
        }
        const before = report.errors.length;
        const election = requireText(row, 'election', report)?.toUpperCase() ?? null;
        const wardNo = requireInt(row, 'ward_no', report, 1);
        const position = requireInt(row, 'ballot_position', report, 1);
        const nameHindi = requireText(row, 'name_hindi', report);
        const gender = requireText(row, 'gender', report)?.toUpperCase() ?? null;
        const partyShort = optionalText(row, 'party_short_name');
        const category = optionalText(row, 'reservation_category');
        const psName = optionalText(row, 'panchayat_samiti');

        if (election !== null && election !== 'PS' && election !== 'ZP') {
          report.error(`"election" must be PS or ZP, got "${election}"`, row.rowNumber);
        }
        if (gender !== null && !GENDERS.has(gender)) {
          report.error(`"gender" must be M, F or O, got "${gender}"`, row.rowNumber);
        }
        let partyId: number | null = null;
        if (partyShort !== null) {
          partyId = partyByShort.get(matchKey(partyShort)) ?? null;
          if (partyId === null)
            report.error(`Unknown party short name "${partyShort}"`, row.rowNumber);
        }

        let ward: WardRow | undefined;
        if (election === 'PS' && wardNo !== null) {
          if (psName === null) {
            report.error('"panchayat_samiti" is required for PS rows', row.rowNumber);
          } else {
            const ps = psByName.get(matchKey(psName));
            if (!ps) report.error(`Unknown Panchayat Samiti "${psName}"`, row.rowNumber);
            else {
              ward = wardByKey.get(wardKey('PS', ps.id, wardNo));
              if (!ward) report.error(`${ps.name_english} has no PS ward ${wardNo}`, row.rowNumber);
            }
          }
        } else if (election === 'ZP' && wardNo !== null) {
          if (psName !== null) {
            report.warn(
              `"panchayat_samiti" is ignored for ZP rows (ZP wards are district-wide)`,
              row.rowNumber,
            );
          }
          ward = wardByKey.get(wardKey('ZP', null, wardNo));
          if (!ward) report.error(`ZP ward ${wardNo} does not exist`, row.rowNumber);
        }

        if (
          report.errors.length !== before ||
          !ward ||
          position === null ||
          nameHindi === null ||
          gender === null
        ) {
          continue;
        }
        const group = byWard.get(ward.id) ?? { ward, rows: [] };
        group.rows.push({
          rowNumber: row.rowNumber,
          position,
          nameHindi,
          partyId,
          partyShort,
          gender,
          category,
        });
        byWard.set(ward.id, group);
      }

      // 2. Per-ward rules.
      for (const { ward, rows } of byWard.values()) {
        const label = wardLabel(ward);
        const allRows = rows.map((r) => r.rowNumber);
        if (ward.is_locked === 1) {
          report.error(`${label}: the ballot is LOCKED; its candidates cannot be changed`, allRows);
        }
        if (withEntries.has(ward.id)) {
          report.error(
            `${label}: counting entries already exist; its candidates cannot be changed`,
            allRows,
          );
        }

        const positions = new Map<number, number[]>();
        for (const r of rows)
          positions.set(r.position, [...(positions.get(r.position) ?? []), r.rowNumber]);
        for (const [pos, rowNums] of positions) {
          if (rowNums.length > 1)
            report.error(`${label}: ballot_position ${pos} is used more than once`, rowNums);
        }
        const sorted = [...positions.keys()].sort((a, b) => a - b);
        if (sorted.some((pos, i) => pos !== i + 1)) {
          report.error(
            `${label}: ballot positions must be 1..${rows.length} with no gaps; found ${sorted.join(', ')}`,
            allRows,
          );
        }

        const parties = new Map<number, CandidateRow[]>();
        for (const r of rows) {
          if (r.partyId !== null) parties.set(r.partyId, [...(parties.get(r.partyId) ?? []), r]);
        }
        for (const list of parties.values()) {
          if (list.length > 1) {
            report.error(
              `${label}: party "${list[0]?.partyShort ?? ''}" has more than one candidate`,
              list.map((r) => r.rowNumber),
            );
          }
        }

        const categories = new Set(rows.map((r) => r.category ?? ''));
        if (categories.size > 1) {
          report.error(
            `${label}: reservation_category must be the same on every row of the ward; found ${[
              ...categories,
            ]
              .map((c) => (c === '' ? '(empty)' : `"${c}"`))
              .join(', ')}`,
            allRows,
          );
        }
      }

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
        await conn.execute('DELETE FROM candidate WHERE ward_id = ?', [ward.id]);
        for (const r of [...rows].sort((a, b) => a.position - b.position)) {
          await conn.execute(
            `INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota)
             VALUES (?, ?, ?, ?, ?, 0)`,
            [ward.id, r.position, r.nameHindi, r.partyId, r.gender],
          );
        }
        const unopposed = rows.length === 1;
        if (!unopposed) {
          await conn.execute(
            `INSERT INTO candidate (ward_id, ballot_position, name_hindi, party_id, gender, is_nota)
             VALUES (?, ?, ?, NULL, NULL, 1)`,
            [ward.id, rows.length + 1, NOTA_NAME_HINDI],
          );
        }
        await conn.execute(
          'UPDATE ward SET is_unopposed = ?, reservation_category = ? WHERE id = ?',
          [unopposed ? 1 : 0, rows[0]?.category ?? null, ward.id],
        );
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
