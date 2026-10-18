// DM uploads: the party list and the full candidate list (all PS and ZP wards).
// "check" reads only (a READ ONLY transaction) and returns Hindi problems or a preview. "save" re-runs
// every check inside the write transaction; a single problem means nothing is written.
// The rules are the Part 2 importer rules (src/services/master-data), never a copy.
import { basename } from 'node:path';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { ApiError } from '../../middleware/errors.js';
import { writeAudit } from '../../services/audit.js';
import { emitWardChanged } from '../../services/events.js';
import {
  CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
  checkWardList,
  loadCandidateLookups,
  parseCandidateSheet,
  replaceWardCandidates,
} from '../../services/master-data/candidates.js';
import type { CandidateLookups, WardList } from '../../services/master-data/candidates.js';
import { IssueList } from '../../services/master-data/issues.js';
import { issuesHi, sheetFailureHi } from '../../services/master-data/issues-hi.js';
import type { HindiIssue } from '../../services/master-data/issues-hi.js';
import { lockWardRows } from '../../services/master-data/lookups.js';
import { withMasterDataWrite, withReadOnly } from '../../services/master-data/lock.js';
import {
  PARTY_COLUMNS,
  checkParties,
  insertParties,
  loadParties,
  parsePartyRows,
  partyFromForm,
} from '../../services/master-data/parties.js';
import type { PartyInput } from '../../services/master-data/parties.js';
import { MAX_SHEET_ROWS, decodeXlsxUpload } from '../../services/master-data/upload.js';
import { readSheetFromBuffer } from '../../services/master-data/xlsx.js';
import type { SheetRow } from '../../services/master-data/xlsx.js';
import { requireReauth, resetFailedLogins } from '../auth/auth.service.js';
import { busyAsConflict } from './http.js';
import type { Actor } from './http.js';

export interface UploadBody {
  fileName: string;
  fileBase64: string;
}

export interface CheckOutcome<P> {
  ok: boolean;
  errors: HindiIssue[];
  warnings: HindiIssue[];
  preview: P | null;
  sha256: string;
}

const message = (text: string): HindiIssue => ({ rows: [], message: text });

/** Decodes and reads the uploaded sheet. Problems with the file itself come back as `errors`. */
async function readUpload(
  body: UploadBody,
  required: readonly string[],
  optional: readonly string[] = [],
): Promise<{ rows: SheetRow[] | null; errors: HindiIssue[]; sha256: string }> {
  const { data, sha256 } = decodeXlsxUpload(body.fileBase64);
  const sheet = await readSheetFromBuffer(data, required, optional);
  if (!sheet.ok) return { rows: null, errors: [message(sheetFailureHi(sheet.failure))], sha256 };
  if (sheet.rows.length === 0)
    return {
      rows: null,
      errors: [
        message('फ़ाइल में कोई भरी हुई पंक्ति नहीं है — Excel में जानकारी भरकर फ़ाइल फिर से चुनें'),
      ],
      sha256,
    };
  if (sheet.rows.length > MAX_SHEET_ROWS)
    return {
      rows: null,
      errors: [message(`फ़ाइल में ${MAX_SHEET_ROWS} से अधिक पंक्तियाँ हैं — सही फ़ाइल चुनें`)],
      sha256,
    };
  return { rows: sheet.rows, errors: [], sha256 };
}

/** The file name only, for the audit log (never a path). */
function safeFileName(name: string): string {
  return basename(name.replaceAll('\\', '/')).slice(0, 200);
}

function checkFailed(errors: readonly HindiIssue[]): ApiError {
  return new ApiError(400, 'CHECK_FAILED', { errors });
}

// ---------------------------------------------------------------- parties

export interface PartiesPreview {
  toInsert: { shortName: string; nameHindi: string; nameEnglish: string; symbol: string }[];
  unchanged: string[];
}

function partyPreview(plan: { toInsert: PartyInput[]; unchanged: string[] }): PartiesPreview {
  return {
    toInsert: plan.toInsert.map((p) => ({
      shortName: p.short_name,
      nameHindi: p.name_hindi,
      nameEnglish: p.name_english,
      symbol: p.symbol,
    })),
    unchanged: plan.unchanged,
  };
}

async function checkPartiesOn(conn: PoolConnection, rows: readonly SheetRow[]) {
  const issues = new IssueList();
  const parties = parsePartyRows(rows, issues);
  const plan = checkParties(parties, await loadParties(conn), issues);
  return { issues, plan };
}

export async function checkPartiesUpload(
  pool: Pool,
  body: UploadBody,
): Promise<CheckOutcome<PartiesPreview>> {
  const file = await readUpload(body, PARTY_COLUMNS);
  if (file.rows === null)
    return { ok: false, errors: file.errors, warnings: [], preview: null, sha256: file.sha256 };
  const rows = file.rows;
  const { issues, plan } = await withReadOnly(pool, (conn) => checkPartiesOn(conn, rows));
  return {
    ok: issues.isOk(),
    errors: issuesHi(issues.errors, 'file'),
    warnings: issuesHi(issues.warnings, 'file'),
    preview: issues.isOk() ? partyPreview(plan) : null,
    sha256: file.sha256,
  };
}

export async function savePartiesUpload(
  pool: Pool,
  who: Actor,
  body: UploadBody,
): Promise<PartiesPreview> {
  const file = await readUpload(body, PARTY_COLUMNS);
  if (file.rows === null) throw checkFailed(file.errors);
  const rows = file.rows;
  return busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      const { issues, plan } = await checkPartiesOn(conn, rows);
      if (!issues.isOk()) throw checkFailed(issuesHi(issues.errors, 'file'));
      await insertParties(conn, plan.toInsert);
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'IMPORT_PARTIES',
        entity: 'party',
        entityId: null,
        newValue: {
          via: 'web',
          file: safeFileName(body.fileName),
          sha256: file.sha256,
          inserted: plan.toInsert.map((p) => p.short_name),
          unchanged: plan.unchanged,
        },
        ip: who.ip,
      });
      return partyPreview(plan);
    }),
  );
}

export async function addOneParty(
  pool: Pool,
  who: Actor,
  body: {
    nameHindi: string;
    nameEnglish: string;
    shortName: string;
    symbol: string;
  },
): Promise<{ shortName: string }> {
  const party = partyFromForm({
    name_hindi: body.nameHindi,
    name_english: body.nameEnglish,
    short_name: body.shortName,
    symbol: body.symbol,
  });
  const empty = PARTY_COLUMNS.filter((c) => party[c] === '');
  return busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      const issues = new IssueList();
      for (const column of empty) issues.error({ code: 'CELL_EMPTY', column });
      const plan = checkParties([party], await loadParties(conn), issues);
      if (!issues.isOk()) throw checkFailed(issuesHi(issues.errors, 'form'));
      if (plan.toInsert.length === 0) throw new ApiError(409, 'NO_CHANGE'); // identical party exists
      await insertParties(conn, plan.toInsert);
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'PARTY_ADDED',
        entity: 'party',
        entityId: null,
        newValue: {
          short_name: party.short_name,
          name_hindi: party.name_hindi,
          name_english: party.name_english,
          symbol: party.symbol,
        },
        ip: who.ip,
      });
      return { shortName: party.short_name };
    }),
  );
}

// ---------------------------------------------------------------- candidates

export interface CandidateWardPreview {
  wardId: number;
  kind: 'PS' | 'ZP';
  panchayatSamiti: { id: number; name: string } | null;
  wardNo: number;
  reservationCategory: string | null;
  unopposed: boolean;
  /** The ward already had candidates; they will be replaced. */
  replaces: boolean;
  candidates: {
    position: number;
    nameHindi: string;
    party: { shortName: string; nameHindi: string } | null;
    gender: 'M' | 'F' | 'O';
  }[];
}

export interface CandidatesPreview {
  wards: CandidateWardPreview[];
  totals: { wards: number; candidates: number; unopposed: number; replaced: number };
  /** Wards not in the file that still have no candidates at all. */
  wardsStillEmpty: number;
}

function candidatesPreview(
  byWard: Map<number, WardList>,
  lk: CandidateLookups,
  partyNames: Map<number, { shortName: string; nameHindi: string }>,
): CandidatesPreview {
  const wards = [...byWard.values()]
    .map(({ ward, rows }): CandidateWardPreview => ({
      wardId: ward.id,
      kind: ward.ward_type,
      panchayatSamiti:
        ward.panchayat_samiti_id === null
          ? null
          : { id: ward.panchayat_samiti_id, name: ward.ps_name_hindi ?? ward.ps_name ?? '' },
      wardNo: ward.ward_no,
      reservationCategory: rows[0]?.category ?? null,
      unopposed: rows.length === 1,
      replaces: (lk.existingCount.get(ward.id) ?? 0) > 0,
      candidates: [...rows]
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          position: r.position,
          nameHindi: r.nameHindi,
          party: r.partyId === null ? null : (partyNames.get(r.partyId) ?? null),
          gender: r.gender,
        })),
    }))
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        (a.panchayatSamiti?.name ?? '').localeCompare(b.panchayatSamiti?.name ?? '', 'hi') ||
        a.wardNo - b.wardNo,
    );
  return {
    wards,
    totals: {
      wards: wards.length,
      candidates: wards.reduce((n, w) => n + w.candidates.length, 0),
      unopposed: wards.filter((w) => w.unopposed).length,
      replaced: wards.filter((w) => w.replaces).length,
    },
    wardsStillEmpty: lk.wards.filter(
      (w) => !byWard.has(w.id) && (lk.existingCount.get(w.id) ?? 0) === 0,
    ).length,
  };
}

async function checkCandidatesOn(conn: PoolConnection, rows: readonly SheetRow[]) {
  const lk = await loadCandidateLookups(conn);
  const issues = new IssueList();
  const byWard = parseCandidateSheet(rows, lk, issues);
  for (const { ward, rows: list } of byWard.values())
    checkWardList(ward, list, lk.withEntries.has(ward.id), true, issues);
  return { lk, issues, byWard };
}

async function partyNameMap(conn: PoolConnection) {
  return new Map(
    (await loadParties(conn)).map((p) => [
      p.id,
      { shortName: p.short_name, nameHindi: p.name_hindi },
    ]),
  );
}

export async function checkCandidatesUpload(
  pool: Pool,
  body: UploadBody,
): Promise<CheckOutcome<CandidatesPreview>> {
  const file = await readUpload(body, CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS);
  if (file.rows === null)
    return { ok: false, errors: file.errors, warnings: [], preview: null, sha256: file.sha256 };
  const rows = file.rows;
  return withReadOnly(pool, async (conn) => {
    const { lk, issues, byWard } = await checkCandidatesOn(conn, rows);
    return {
      ok: issues.isOk(),
      errors: issuesHi(issues.errors, 'file'),
      warnings: issuesHi(issues.warnings, 'file'),
      preview: issues.isOk() ? candidatesPreview(byWard, lk, await partyNameMap(conn)) : null,
      sha256: file.sha256,
    };
  });
}

export async function saveCandidatesUpload(
  pool: Pool,
  who: Actor,
  body: UploadBody & { password: string },
): Promise<CandidatesPreview['totals']> {
  await requireReauth(pool, who.user.id, body.password, who.ip);
  const file = await readUpload(body, CANDIDATE_COLUMNS, OPTIONAL_CANDIDATE_COLUMNS);
  if (file.rows === null) throw checkFailed(file.errors);
  const rows = file.rows;
  const { totals, wardIds } = await busyAsConflict(() =>
    withMasterDataWrite(pool, async (conn) => {
      await resetFailedLogins(conn, who.user.id);
      // Find the wards, lock their rows (the same first lock as counting), then check again on the
      // latest data (READ COMMITTED) before writing.
      const first = await checkCandidatesOn(conn, rows);
      await lockWardRows(conn, first.byWard.keys());
      const { lk, issues, byWard } = await checkCandidatesOn(conn, rows);
      if (!issues.isOk()) throw checkFailed(issuesHi(issues.errors, 'file'));

      const preview = candidatesPreview(byWard, lk, await partyNameMap(conn));
      for (const { ward, rows: list } of byWard.values()) {
        await replaceWardCandidates(conn, ward.id, list, { set: list[0]?.category ?? null });
        // The DM checked this list: it counts as ready ("सूची तैयार").
        await conn.execute(
          `UPDATE ward SET candidates_ready_at = NOW(3), candidates_ready_by = ?,
                  candidates_return_reason = NULL WHERE id = ?`,
          [who.user.id, ward.id],
        );
      }
      await writeAudit(conn, {
        userId: who.user.id,
        action: 'IMPORT_CANDIDATES',
        entity: 'candidate',
        entityId: null,
        newValue: {
          via: 'web',
          file: safeFileName(body.fileName),
          sha256: file.sha256,
          wards_loaded: preview.totals.wards,
          candidates: preview.totals.candidates,
          ward_ids: preview.wards.map((w) => w.wardId),
          replaced_ward_ids: preview.wards.filter((w) => w.replaces).map((w) => w.wardId),
          unopposed_ward_ids: preview.wards.filter((w) => w.unopposed).map((w) => w.wardId),
        },
        ip: who.ip,
      });
      return { totals: preview.totals, wardIds: [...byWard.keys()] };
    }),
  );
  for (const id of wardIds) emitWardChanged(id);
  return totals;
}
