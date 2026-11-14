// "मतगणना डेटा download": one .zip of CSVs holding everything the ROs entered, for the Super Admin to
// save BEFORE a reset clears it. Read only; it never changes anything and never blocks a reset.
//
// Every number comes from the EXISTING read services, so the file matches the reports exactly:
//   - booth entries, postal entries and declarations come from `wardDetail` (modules/reports), the
//     same read behind the DM's ward-detail screen. Nothing is added up or recomputed here.
//   - voided entries are the one thing no read service exposes (wardDetail only counts them), so
//     they are read straight from `voided_entry`: stored values and its own `votes` JSON, which
//     already carries each candidate's name and ballot position as the entry was saved.
//
// Consistency: `wardDetail` opens its own read-only snapshot per ward, so the file is consistent
// within each ward but is read ward by ward over the download. The README says so and advises
// downloading after entry has stopped.
import JSZip from 'jszip';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { wardDetail } from '../../modules/reports/ward-detail.js';
import { istStampForFile, toCsv } from '../../modules/reports/csv.js';
import type { Cell } from '../../modules/reports/csv.js';
import { boothLabelOf } from '../booth-no.js';
import { istIso } from '../public-views.js';

/** The four CSVs and the README, in the order they are written into the zip. */
export const EXPORT_FILES = [
  'booth-entries.csv',
  'postal-entries.csv',
  'ward-declarations.csv',
  'voided-entries.csv',
  'README.txt',
] as const;

export interface ExportRowCounts {
  boothEntries: number;
  postalEntries: number;
  declarations: number;
  voidedEntries: number;
}

/** How many DATA rows each CSV will hold (shown next to the download button). */
export async function exportRowCounts(pool: Pool): Promise<ExportRowCounts> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM booth_entry_vote bv JOIN candidate c ON c.id = bv.candidate_id
       WHERE c.is_nota = 0) AS boothEntries,
    (SELECT COUNT(*) FROM postal_entry_vote pv JOIN candidate c ON c.id = pv.candidate_id
       WHERE c.is_nota = 0) AS postalEntries,
    (SELECT COUNT(*) FROM ward_declarations) AS declarations,
    -- One row per archived vote, NOTA included: the voided CSV keeps the stored blob verbatim.
    (SELECT COALESCE(SUM(JSON_LENGTH(votes)), 0) FROM voided_entry) AS voidedEntries`);
  const r: RowDataPacket | undefined = rows[0];
  return {
    boothEntries: Number(r?.boothEntries ?? 0),
    postalEntries: Number(r?.postalEntries ?? 0),
    declarations: Number(r?.declarations ?? 0),
    voidedEntries: Number(r?.voidedEntries ?? 0),
  };
}

// ---------------------------------------------------------------- reads

/** Every ward that has any counting data at all (fixed SQL, no user input). */
async function wardsWithData(pool: Pool): Promise<number[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.ward_id, w.ward_type, w.panchayat_samiti_id, w.ward_no FROM (
         SELECT ward_id FROM booth_entry
         UNION SELECT ward_id FROM postal_entry
         UNION SELECT ward_id FROM ward_declarations
         UNION SELECT ward_id FROM voided_entry
       ) t
       JOIN ward w ON w.id = t.ward_id
      ORDER BY w.ward_type, w.panchayat_samiti_id, w.ward_no`,
  );
  return rows.map((r) => Number(r.ward_id));
}

const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const name = (full: unknown, username: unknown): string => text(full) || text(username);

/** One archived vote of a voided entry, as the entry's `votes` JSON stored it. */
interface VoidedVote {
  candidateId: number;
  ballotPosition: number;
  nameHindi: string;
  votes: number;
}

function voidedVotes(value: unknown): VoidedVote[] {
  if (!Array.isArray(value)) return [];
  const out: VoidedVote[] = [];
  for (const v of value) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    out.push({
      candidateId: Number(r.candidateId ?? 0),
      ballotPosition: Number(r.ballotPosition ?? 0),
      nameHindi: typeof r.nameHindi === 'string' ? r.nameHindi : '',
      votes: Number(r.votes ?? 0),
    });
  }
  return out.sort((a, b) => a.ballotPosition - b.ballotPosition);
}

/** Party (Hindi) of every candidate still in the system, for the voided rows' party column. */
async function partyByCandidate(pool: Pool): Promise<Map<number, string>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, p.name_hindi FROM candidate c JOIN party p ON p.id = c.party_id`,
  );
  return new Map(rows.map((r) => [Number(r.id), String(r.name_hindi)]));
}

async function readVoided(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, v.entry_kind, v.original_entry_id, v.ward_id, v.ballot_for, v.sheet_total,
            v.rejected_count, v.votes, v.void_reason, v.voided_at, v.entered_at,
            w.ward_type, w.ward_no, wps.name_hindi AS ward_ps_name,
            b.booth_no, b.booth_suffix, b.name_hindi AS booth_name, bps.name_hindi AS booth_ps_name,
            ue.username AS e_user, ue.full_name AS e_full,
            uv.username AS v_user, uv.full_name AS v_full
       FROM voided_entry v
       JOIN ward w ON w.id = v.ward_id
       LEFT JOIN panchayat_samiti wps ON wps.id = w.panchayat_samiti_id
       LEFT JOIN booth b ON b.id = v.booth_id
       LEFT JOIN panchayat_samiti bps ON bps.id = b.panchayat_samiti_id
       JOIN users ue ON ue.id = v.entered_by
       JOIN users uv ON uv.id = v.voided_by
      ORDER BY v.id`,
  );
  return rows;
}

// ---------------------------------------------------------------- CSVs

const BOOTH_HEADERS = [
  'Panchayat Samiti',
  'Ward type',
  'Ward no',
  'Booth label',
  'Booth name',
  'Candidate name',
  'Party',
  'Votes',
  'NOTA',
  'Sheet total',
  'Entered by',
  'Entered at (IST)',
] as const;

const POSTAL_HEADERS = [
  'Panchayat Samiti',
  'Ward type',
  'Ward no',
  'Candidate name',
  'Party',
  'Votes',
  'NOTA',
  'Sheet total',
  'Rejected',
  'Entered by',
  'Entered at (IST)',
] as const;

const DECLARATION_HEADERS = [
  'Panchayat Samiti',
  'Ward type',
  'Ward no',
  'Version',
  'Status',
  'Winner',
  'Margin',
  'Total valid votes',
  'Lottery by',
  'Lottery note',
  'NOTA highest acknowledged',
  'Correction reason',
  'Declared by',
  'Declared at (IST)',
] as const;

const VOIDED_HEADERS = [
  'Panchayat Samiti',
  'Ward type',
  'Ward no',
  'Entry kind',
  'Ballot',
  'Booth label',
  'Booth name',
  'Candidate name',
  'Party',
  'Votes',
  'Sheet total',
  'Rejected',
  'Entered by',
  'Entered at (IST)',
  'Voided by',
  'Voided at (IST)',
  'Void reason',
] as const;

type WardDetail = Awaited<ReturnType<typeof wardDetail>>;

/** The ward's own Panchayat Samiti column: a PS ward's PS, or "—" for a ZP ward (whole district). */
const wardPs = (d: WardDetail): string => d.ward.psName ?? '—';

export interface CountingExport {
  data: Buffer;
  fileName: string;
  counts: ExportRowCounts;
}

/**
 * Builds the .zip. `now` is the download time printed in the README and the file name.
 * Nothing here writes to the database.
 */
export async function buildCountingExport(pool: Pool, now: Date): Promise<CountingExport> {
  const district = await districtName(pool);
  const parties = await partyByCandidate(pool);
  const booth: Cell[][] = [[...BOOTH_HEADERS]];
  const postal: Cell[][] = [[...POSTAL_HEADERS]];
  const declarations: Cell[][] = [[...DECLARATION_HEADERS]];
  const voided: Cell[][] = [[...VOIDED_HEADERS]];

  for (const wardId of await wardsWithData(pool)) {
    const d = await wardDetail(pool, wardId);
    const byId = new Map(d.candidates.map((c) => [c.id, c]));
    const nota = d.candidates.find((c) => c.isNota);
    const ps = wardPs(d);

    for (const b of d.booths) {
      if (!b.entered) continue;
      const notaVotes = b.votes.find((v) => v.candidateId === nota?.id)?.votes ?? 0;
      for (const v of b.votes) {
        const c = byId.get(v.candidateId);
        if (c === undefined || c.isNota) continue;
        booth.push([
          b.psName,
          d.ward.kind,
          d.ward.wardNo,
          b.boothNo,
          b.name,
          c.name,
          c.party?.nameHindi ?? '',
          v.votes,
          notaVotes,
          b.sheetTotal,
          b.enteredBy ?? '',
          b.enteredAt ?? '',
        ]);
      }
    }

    if (d.postal.entered) {
      const notaVotes = d.postal.votes.find((v) => v.candidateId === nota?.id)?.votes ?? 0;
      for (const v of d.postal.votes) {
        const c = byId.get(v.candidateId);
        if (c === undefined || c.isNota) continue;
        postal.push([
          ps,
          d.ward.kind,
          d.ward.wardNo,
          c.name,
          c.party?.nameHindi ?? '',
          v.votes,
          notaVotes,
          d.postal.sheetTotal,
          d.postal.rejectedCount,
          d.postal.enteredBy ?? '',
          d.postal.enteredAt ?? '',
        ]);
      }
    }

    for (const dec of d.declarations) {
      declarations.push([
        ps,
        d.ward.kind,
        d.ward.wardNo,
        dec.version,
        dec.status,
        dec.winner.name,
        dec.margin,
        dec.totalValidVotes,
        dec.lottery?.conductedBy ?? '',
        dec.lottery?.note ?? '',
        dec.notaHighestAck ? 'yes' : 'no',
        dec.correctionReason ?? '',
        dec.declaredBy,
        dec.declaredAt,
      ]);
    }
  }

  for (const r of await readVoided(pool)) {
    const kind = r.ward_type === 'ZP' ? 'ZP' : 'PS';
    const ps = String(r.booth_ps_name ?? r.ward_ps_name ?? '—');
    const label =
      r.booth_no === null || r.booth_no === undefined
        ? ''
        : boothLabelOf({ booth_no: r.booth_no, booth_suffix: r.booth_suffix });
    const enteredAt = r.entered_at instanceof Date ? istIso(r.entered_at) : '';
    const voidedAt = r.voided_at instanceof Date ? istIso(r.voided_at) : '';
    for (const v of voidedVotes(r.votes)) {
      voided.push([
        ps,
        kind,
        Number(r.ward_no),
        String(r.entry_kind),
        r.ballot_for === null || r.ballot_for === undefined ? '' : String(r.ballot_for),
        label,
        r.booth_name === null || r.booth_name === undefined ? '' : String(r.booth_name),
        v.nameHindi,
        parties.get(v.candidateId) ?? '',
        v.votes,
        Number(r.sheet_total),
        r.rejected_count === null || r.rejected_count === undefined
          ? null
          : Number(r.rejected_count),
        name(r.e_full, r.e_user),
        enteredAt,
        name(r.v_full, r.v_user),
        voidedAt,
        String(r.void_reason),
      ]);
    }
  }

  const counts: ExportRowCounts = {
    boothEntries: booth.length - 1,
    postalEntries: postal.length - 1,
    declarations: declarations.length - 1,
    voidedEntries: voided.length - 1,
  };

  const zip = new JSZip();
  zip.file('booth-entries.csv', toCsv(booth));
  zip.file('postal-entries.csv', toCsv(postal));
  zip.file('ward-declarations.csv', toCsv(declarations));
  zip.file('voided-entries.csv', toCsv(voided));
  zip.file('README.txt', readme(district, now, counts));
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { data, fileName: `churu-counting-data-${istStampForFile(now)}.zip`, counts };
}

async function districtName(pool: Pool): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT name_hindi, name_english FROM district ORDER BY id LIMIT 1',
  );
  const r = rows[0];
  if (r === undefined) return 'Churu';
  return String(r.name_hindi ?? r.name_english ?? 'Churu');
}

function readme(district: string, now: Date, counts: ExportRowCounts): string {
  return [
    'Churu ZP-PS Election Results Portal — counting data download',
    '',
    `District: ${district} (Churu, Rajasthan)`,
    `Downloaded at: ${istIso(now)} (IST)`,
    '',
    'THIS IS TEST DATA. It is downloaded before the counting data is cleared from the',
    'Super Admin panel, so that a mock / training counting can be checked afterwards.',
    'It is not an official result and must never be used as one.',
    '',
    'Files:',
    `  booth-entries.csv      ${String(counts.boothEntries)} rows — one row per candidate per booth entry`,
    `  postal-entries.csv     ${String(counts.postalEntries)} rows — one row per candidate per postal entry`,
    `  ward-declarations.csv  ${String(counts.declarations)} rows — every declaration version`,
    `  voided-entries.csv     ${String(counts.voidedEntries)} rows — voided entries with their reason`,
    '',
    "In booth-entries.csv and postal-entries.csv each row carries its entry's NOTA votes",
    'and the sheet total the RO typed, so (candidates + NOTA) can be checked against the',
    'sheet total row by row. In voided-entries.csv the archived votes are kept exactly as',
    'they were stored, so NOTA appears there as a row of its own.',
    '',
    'How this file was read: ward by ward at download time. If entries were still being',
    'made while the file was being built, different wards may reflect slightly different',
    'moments. Download after entry has stopped if you need one single moment.',
    '',
    'The audit log is never part of this file and is never cleared.',
    '',
  ].join('\n');
}
