// Super Admin "मास्टर डेटा बदलें" (master-data replace): empty ALL election data (never audit_log,
// users or settings) and load fresh master data with the same import code as the CLI
// (runImportGeography / runImportVoters), from the uploaded geography and voter Excel files. Hindi PS
// names default to the names already in the system; fixes to the last fixes file used.
//
// Order: 1 check the files (nothing touched) -> 2 backup -> 3 TRUNCATE in the shared controlled
// routine (data-reset.ts; implicit commit) -> 4 geography + voters + one FULL_RESET audit row in ONE
// transaction. If step 4 fails, the election tables are empty (users kept) and it can be repeated.
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { DbConnectionConfig } from '../../config/db.js';
import { withMasterDataWrite } from '../master-data/lock.js';
import { writeAudit } from './audit.js';
import type { AuditActor } from './audit.js';
import { createBackup } from './backup.js';
import type { BackupResult } from './backup.js';
import { assertCountingUnlocked } from './counting-lock.js';
import {
  KEPT_TABLES,
  MASTER_DATA_TABLES,
  truncateTables,
  withMigrationConnection,
} from './data-reset.js';
import { runImportGeography } from './geography.js';
import type { GeographyCounts } from './geography.js';
import type { ScriptContext, ScriptResult } from './run.js';
import { runImportVoters } from './voters.js';

/** Paths of the staged files (fixed names chosen by the server, never by the uploader). */
export interface MasterFiles {
  geography: string;
  voters: string;
  fixes?: string | undefined;
  psNames?: string | undefined;
  /** psNames is the system's saved list (names of PS no longer in the file are skipped). */
  psNamesLenient: boolean;
}

/** Problems keep their source so the panel can say which file they are in. */
export interface SourcedLine {
  source: 'geography' | 'voters';
  text: string;
}

export interface MasterCheck {
  ok: boolean;
  counts: GeographyCounts | null;
  totalVoters: number | null;
  errors: SourcedLine[];
  warnings: SourcedLine[];
}

export type MasterOutcome =
  | { kind: 'CHECK_FAILED'; check: MasterCheck }
  | { kind: 'IMPORT_FAILED'; backup: BackupResult; errors: SourcedLine[] }
  | { kind: 'DONE'; backup: BackupResult; check: MasterCheck };

const tag = (source: SourcedLine['source'], lines: readonly string[]): SourcedLine[] =>
  lines.map((text) => ({ source, text }));

/** Step 1, also the dry run: both files checked against each other; the database is not touched. */
export async function checkMasterFiles(
  files: MasterFiles,
  ctx: ScriptContext,
): Promise<MasterCheck> {
  const geo = await runImportGeography(
    {
      file: files.geography,
      fixes: files.fixes,
      psNames: files.psNames,
      psNamesLenient: files.psNamesLenient,
      filesOnly: true,
    },
    ctx,
  );
  const errors = tag('geography', geo.errors);
  const warnings = tag('geography', geo.warnings);
  if (!geo.ok) return { ok: false, counts: geo.counts, totalVoters: null, errors, warnings };
  const voters = await runImportVoters(
    { file: files.voters, filesOnlyBoothKeys: geo.boothKeys },
    ctx,
  );
  return {
    ok: voters.ok,
    counts: geo.counts,
    totalVoters: voters.totalVoters,
    errors: [...errors, ...tag('voters', voters.errors)],
    warnings: [...warnings, ...tag('voters', voters.warnings)],
  };
}

/** What a master-data replace deletes (shown before it runs). */
export async function masterDataImpact(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM booth) AS booths,
    (SELECT COUNT(*) FROM ward WHERE ward_type = 'PS') AS psWards,
    (SELECT COUNT(*) FROM ward WHERE ward_type = 'ZP') AS zpWards,
    (SELECT COUNT(*) FROM party) AS parties,
    (SELECT COUNT(*) FROM candidate WHERE is_nota = 0) AS candidates,
    (SELECT COUNT(*) FROM booth_entry) + (SELECT COUNT(*) FROM postal_entry) AS entries,
    (SELECT COUNT(DISTINCT ward_id) FROM ward_declarations) AS declaredWards`);
  const r = rows[0] ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as Record<
    'booths' | 'psWards' | 'zpWards' | 'parties' | 'candidates' | 'entries' | 'declaredWards',
    number
  >;
}

class ImportFailed extends Error {
  constructor(readonly errors: SourcedLine[]) {
    super('master data import failed');
  }
}

function failed(source: SourcedLine['source'], result: ScriptResult): SourcedLine[] {
  const lines = tag(source, result.errors);
  return lines.length > 0 ? lines : [{ source, text: 'not saved' }];
}

/** Steps 1-4. The caller has checked role and confirmation. Backup only after the files pass. */
export async function runMasterDataReplace(
  files: MasterFiles,
  ctx: ScriptContext & { actor: AuditActor },
  setup: { migrationDb: DbConnectionConfig; backupDir: string },
): Promise<MasterOutcome> {
  await assertCountingUnlocked(ctx.pool);
  const check = await checkMasterFiles(files, ctx);
  if (!check.ok) return { kind: 'CHECK_FAILED', check };

  const backup = await createBackup(ctx.pool, setup.backupDir, 'master-data', ctx.now());
  const impact = await masterDataImpact(ctx.pool);
  await withMigrationConnection(setup.migrationDb, ctx.pool, (conn) =>
    truncateTables(conn, MASTER_DATA_TABLES),
  );

  try {
    await withMasterDataWrite(ctx.pool, async (conn) => {
      const joined: ScriptContext = { ...ctx, joinConnection: conn };
      const geo = await runImportGeography(
        {
          file: files.geography,
          fixes: files.fixes,
          psNames: files.psNames,
          psNamesLenient: files.psNamesLenient,
          commit: true,
        },
        joined,
      );
      if (!geo.ok || !geo.committed) throw new ImportFailed(failed('geography', geo));
      const voters = await runImportVoters({ file: files.voters, commit: true }, joined);
      if (!voters.ok || !voters.committed) throw new ImportFailed(failed('voters', voters));
      await writeAudit(
        conn,
        {
          action: 'FULL_RESET',
          entity: 'database',
          entityId: null,
          oldValue: impact,
          newValue: {
            backup_file: backup.path,
            emptied_tables: MASTER_DATA_TABLES,
            kept_tables: [...KEPT_TABLES],
            counts: geo.counts,
            total_voters: voters.totalVoters,
          },
          reason: 'Master data replaced from the Super Admin panel; the audit log is kept',
        },
        ctx.actor,
      );
    });
  } catch (err) {
    if (err instanceof ImportFailed) return { kind: 'IMPORT_FAILED', backup, errors: err.errors };
    // The tables are already empty: the officer must still get the backup name, so no plain 500.
    console.error('[error] master data import', err);
    return {
      kind: 'IMPORT_FAILED',
      backup,
      errors: [{ source: 'geography', text: 'Unexpected server error' }],
    };
  }
  return { kind: 'DONE', backup, check };
}
