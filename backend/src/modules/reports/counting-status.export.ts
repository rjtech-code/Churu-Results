// The two Counting Status CSVs (ward-wise, booth-wise), rendered from the SAME report object as the
// UI and the PDF. Data only: no colours, no extra lines above the header. UTF-8 with BOM and formula
// injection guard come from toCsv (csv.ts).
import type { CountingStatusReport, EnteredFlag } from '../../services/counting-status.js';
import type { Cell } from './csv.js';

const yesNo = (b: boolean): string => (b ? 'yes' : 'no');
const ENTERED: Readonly<Record<EnteredFlag, string>> = { YES: 'yes', NO: 'no', NA: 'n/a' };

export const WARD_CSV_HEADERS = [
  'ward_type',
  'ps_name',
  'ward_no',
  'status',
  'unopposed',
  'no_candidates',
  'check_data',
  'stalled',
  'booths_done',
  'booths_total',
  'booths_pending',
  'latest_round',
  'postal_done',
  'last_entry_ist',
  'winner',
  'winner_party',
  'margin',
  'report_time_ist',
] as const;

export function wardCsvRows(r: CountingStatusReport): Cell[][] {
  return [
    [...WARD_CSV_HEADERS],
    ...r.wards.map((w): Cell[] => [
      w.kind,
      w.psNameFull,
      w.wardNo,
      w.statusLabel,
      yesNo(w.unopposed),
      yesNo(w.noCandidates),
      yesNo(w.checkData),
      yesNo(w.stalled),
      w.boothsDone,
      w.boothsTotal,
      w.boothsPending,
      w.latestRound,
      w.postalDone === null ? 'n/a' : yesNo(w.postalDone),
      w.lastEntryText,
      w.winner?.name ?? null,
      w.winner?.party ?? null,
      w.margin,
      r.asOfText,
    ]),
  ];
}

export const BOOTH_CSV_HEADERS = [
  'ward_type',
  'ward_ps_name',
  'ward_no',
  'booth_ps_name',
  'booth_no',
  'booth_name',
  'entered',
  'round',
  'entered_by',
  'entered_at_ist',
  'last_edited_at_ist',
  'total_votes',
  'report_time_ist',
] as const;

export function boothCsvRows(r: CountingStatusReport): Cell[][] {
  const wardPs = new Map(r.wards.map((w) => [w.wardId, w.psNameFull]));
  return [
    [...BOOTH_CSV_HEADERS],
    ...r.booths.map((b): Cell[] => [
      b.kind,
      wardPs.get(b.wardId) ?? null,
      b.wardNo,
      b.psNameFull,
      b.boothNo,
      b.boothName,
      ENTERED[b.entered],
      b.round,
      b.enteredBy,
      b.enteredAtText,
      b.lastEditedAtText,
      b.totalVotes,
      r.asOfText,
    ]),
  ];
}
