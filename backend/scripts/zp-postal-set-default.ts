// npm run zp-postal:set-default [-- --commit]
// Sets which PS_RO enters the postal ballots of each Zila Parishad ward (the official order in
// src/services/zp-postal-default.ts). Dry run unless --commit. Run it AFTER the geography and the
// candidates are loaded, and again after every geography import (ward ids are new each time).
// Checks: the mapping covers ZP wards 1-39 once each with 13 different PS; every PS and every ZP
// ward exists in the database; the database has no other ZP ward. Idempotent: an unchanged
// assignment writes nothing (no audit row). A change replaces all rows and writes one audit row.
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  DEFAULT_ZP_POSTAL_MAPPING,
  ZP_WARD_COUNT,
  checkZpPostalMapping,
  psKey,
} from '../src/services/zp-postal-default.js';
import type { ZpPostalMapping } from '../src/services/zp-postal-default.js';
import { writeAudit } from './lib/audit.js';
import { isMainModule, parseCli, runCli } from './lib/cli.js';
import { inTransaction } from './lib/db.js';
import { Report } from './lib/report.js';
import { finishReport, reportFailure } from './lib/run.js';
import type { ScriptContext, ScriptResult } from './lib/run.js';

interface Planned {
  wardId: number;
  wardNo: number;
  psId: number;
  psName: string;
}

/** ward no -> PS name, for the audit row and the report. */
const asRecord = (rows: readonly { wardNo: number; psName: string }[]) =>
  Object.fromEntries(
    [...rows].sort((a, b) => a.wardNo - b.wardNo).map((r) => [String(r.wardNo), r.psName]),
  );

async function plan(
  conn: PoolConnection,
  mapping: ZpPostalMapping,
  report: Report,
): Promise<Planned[] | null> {
  const { problems, byWard } = checkZpPostalMapping(mapping);
  for (const p of problems) report.error(p);

  const [ps] = await conn.execute<RowDataPacket[]>('SELECT id, name_english FROM panchayat_samiti');
  const psByKey = new Map(ps.map((p) => [psKey(String(p.name_english)), p]));
  for (const name of Object.keys(mapping)) {
    if (!psByKey.has(psKey(name)))
      report.error(
        `Panchayat Samiti "${name}" is not in the database (run import:geography first).`,
      );
  }
  const [wards] = await conn.execute<RowDataPacket[]>(
    "SELECT id, ward_no FROM ward WHERE ward_type = 'ZP' ORDER BY ward_no",
  );
  const wardByNo = new Map(wards.map((w) => [Number(w.ward_no), Number(w.id)]));
  for (const no of byWard.keys()) {
    if (!wardByNo.has(no)) report.error(`ZP ward ${String(no)} is not in the database.`);
  }
  for (const no of wardByNo.keys()) {
    if (!byWard.has(no))
      report.error(`ZP ward ${String(no)} is in the database but not in the mapping.`);
  }
  if (!report.isOk()) return null;

  const planned: Planned[] = [];
  for (const [wardNo, name] of byWard) {
    const p = psByKey.get(psKey(name));
    const wardId = wardByNo.get(wardNo);
    if (p === undefined || wardId === undefined) return null; // reported above
    planned.push({ wardId, wardNo, psId: Number(p.id), psName: String(p.name_english) });
  }
  planned.sort((a, b) => a.wardNo - b.wardNo);

  // Not an error (the official order decides), but worth a look: no booth of that PS in the ward.
  const [booths] = await conn.execute<RowDataPacket[]>(
    'SELECT DISTINCT zp_ward_id, panchayat_samiti_id FROM booth',
  );
  const has = new Set(
    booths.map((b) => `${String(b.zp_ward_id)}:${String(b.panchayat_samiti_id)}`),
  );
  for (const p of planned) {
    if (!has.has(`${String(p.wardId)}:${String(p.psId)}`))
      report.warn(`ZP ward ${String(p.wardNo)}: ${p.psName} has no booth in this ward.`);
  }
  return planned;
}

export async function runZpPostalSetDefault(
  options: { commit?: boolean | undefined },
  ctx: ScriptContext,
  mapping: ZpPostalMapping = DEFAULT_ZP_POSTAL_MAPPING,
): Promise<ScriptResult> {
  const startedAt = ctx.now();
  const report = new Report(
    'zp-postal-set-default',
    options.commit === true ? 'commit' : 'dry-run',
  );
  let committed = false;
  try {
    const result = await inTransaction(ctx.pool, async (conn) => {
      const planned = await plan(conn, mapping, report);
      if (planned === null) return { commit: false, value: false };
      report.section(
        'ZP postal ballots: entered by',
        planned.map((p) => `ZP ward ${String(p.wardNo)}: ${p.psName}`),
      );

      const [old] = await conn.execute<RowDataPacket[]>(
        `SELECT a.zp_ward_id, a.ps_id, w.ward_no, ps.name_english
           FROM zp_ward_postal_assignment a
           JOIN ward w ON w.id = a.zp_ward_id
           JOIN panchayat_samiti ps ON ps.id = a.ps_id
          FOR UPDATE`,
      );
      const same =
        old.length === planned.length &&
        planned.every((p) =>
          old.some((o) => Number(o.zp_ward_id) === p.wardId && Number(o.ps_id) === p.psId),
        );
      if (same) {
        report.line('Already set exactly like this: nothing to change.');
        return { commit: false, value: false };
      }

      await conn.execute('DELETE FROM zp_ward_postal_assignment');
      for (const p of planned) {
        await conn.execute(
          'INSERT INTO zp_ward_postal_assignment (zp_ward_id, ps_id) VALUES (?, ?)',
          [p.wardId, p.psId],
        );
      }
      await writeAudit(
        conn,
        {
          action: 'ZP_POSTAL_ASSIGNMENT_SET',
          entity: 'zp_ward_postal_assignment',
          entityId: null,
          oldValue: asRecord(
            old.map((o) => ({ wardNo: Number(o.ward_no), psName: String(o.name_english) })),
          ),
          newValue: asRecord(planned),
          reason: 'Official order: ZP postal ballots entered by the assigned PS RO',
        },
        ctx.actor,
      );
      return { commit: options.commit === true, value: true };
    });
    committed = result.committed;
    if (committed) report.line(`Saved: ${String(ZP_WARD_COUNT)} ZP wards assigned.`);
    else if (result.value)
      report.line('Dry run: nothing was written. Re-run with --commit to save.');
  } catch (err) {
    reportFailure(report, err);
  }
  return finishReport(ctx, report, startedAt, committed);
}

export async function main(argv: string[], ctx: ScriptContext): Promise<{ ok: boolean }> {
  const { values } = parseCli(
    argv,
    { commit: { type: 'boolean' } },
    'npm run zp-postal:set-default [-- --commit]',
  );
  return runZpPostalSetDefault({ commit: values.commit }, ctx);
}

if (isMainModule(import.meta.url)) await runCli(main);
