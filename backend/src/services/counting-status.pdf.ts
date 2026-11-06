// The Counting Status Report as PDF (A4 landscape). countingStatusPdfModel() turns the ONE report
// object into the exact tables and lines that get drawn (pure, so tests compare it with the JSON and
// the CSV); renderCountingStatusPdf() only draws that model. Only what belongs to the chosen scope:
// page 1 summary and PS-wise; then ward-wise (PS, ZP); one ward / one booth: its booth table; then the
// pending booths of the listed wards in counting.
import type { CountingStatusReport, KindSummary, WardKind, WardRow } from './counting-status.js';
import type { ScopedReport } from './counting-status.scope.js';
import { KIND_LABEL, fmtInt, listsPendingInPdf } from './counting-status.js';
import { COLORS, PagedDocument } from './pdf/paged.js';
import type { CellContent, Chip, TableSpec, Tone } from './pdf/paged.js';

const STATUS_TONE: Readonly<Record<WardRow['status'], Tone>> = {
  NOT_STARTED: 'muted',
  IN_PROGRESS: 'warn',
  READY: 'info',
  DECLARED: 'ok',
};

const n = (v: number | null): string => (v === null ? '–' : fmtInt(v));
const pct = (v: number | null): string => (v === null ? '–' : `${v.toFixed(1)}%`);
const ofTotal = (done: number | null, total: number | null): string =>
  done === null || total === null ? '–' : `${fmtInt(done)} / ${fmtInt(total)}`;

/** Status chip, then the flags (each also as text). */
export function wardChips(w: WardRow): { status: Chip[]; flags: Chip[] } {
  const flags: Chip[] = [];
  if (w.stalled) flags.push({ text: 'Stalled', tone: 'bad' });
  if (w.checkData) flags.push({ text: 'Check Data', tone: 'warn' });
  if (w.unopposed) flags.push({ text: 'Unopposed', tone: 'ok' });
  if (w.noCandidates) flags.push({ text: 'No candidates', tone: 'muted' });
  if (w.tieNeedsLottery) flags.push({ text: 'Tie – lottery needed', tone: 'info' });
  return { status: [{ text: w.statusLabel, tone: STATUS_TONE[w.status] }], flags };
}

export interface PdfModel {
  title: string;
  /** "Scope: SUJANGARH - Ward 5". */
  scopeLine: string;
  subtitle: string[];
  /** Page 1: the summary and the PS-wise table (only those that belong to the scope). */
  first: TableSpec[];
  /** The ward-wise tables start on a new page after a multi-row PS-wise table. */
  pageBreakBeforeWards: boolean;
  wards: TableSpec[];
  /** One ward or one booth: its booth-wise table. */
  booths: TableSpec | null;
  /** Pending booths of the listed wards in counting (not for one ward / one booth). */
  pending: TableSpec | null;
  /** A line under the tables (not started wards, or "no ward matches"). */
  notes: string[];
  footerLeft: string;
}

function summaryRow(kind: WardKind, s: KindSummary): CellContent[] {
  return [
    KIND_LABEL[kind],
    n(s.wardsTotal),
    n(s.notStarted),
    n(s.inProgress),
    n(s.ready),
    n(s.declared),
    n(s.unopposed),
    n(s.stalled),
    n(s.checkData),
    n(s.boothsDone),
    n(s.boothsTotal),
    n(s.boothsPending),
    pct(s.boothsPercent),
    `${fmtInt(s.postalDone)} / ${fmtInt(s.postalTotal)}`,
    s.lastEntryText ?? '–',
  ];
}

function wardTable(r: CountingStatusReport, kind: WardKind): TableSpec {
  const wards = r.wards.filter((w) => w.kind === kind);
  return {
    title: `Ward-wise Status – ${KIND_LABEL[kind]}`,
    columns: [
      ...(kind === 'PS' ? [{ header: 'Panchayat Samiti', weight: 14 }] : []),
      { header: 'Ward', weight: 4, align: 'right' as const },
      { header: 'Status', weight: 11 },
      { header: 'Flags', weight: 9 },
      { header: 'Booths Done / Total', weight: 8, align: 'right' as const },
      { header: 'Pending', weight: 5, align: 'right' as const },
      { header: 'Round', weight: 4, align: 'right' as const },
      { header: 'Postal', weight: 4 },
      { header: 'Last Entry', weight: 13 },
      { header: 'Winner (Party)', weight: 13 },
      { header: 'Margin', weight: 5, align: 'right' as const },
    ],
    rows: wards.map((w) => {
      const chips = wardChips(w);
      return [
        ...(kind === 'PS' ? [w.psName ?? ''] : []),
        String(w.wardNo),
        chips.status,
        chips.flags,
        ofTotal(w.boothsDone, w.boothsTotal),
        n(w.boothsPending),
        n(w.latestRound),
        w.postalDone === null ? 'n/a' : w.postalDone ? 'Done' : 'Pending',
        w.lastEntryText ?? '–',
        w.winner === null ? '–' : `${w.winner.name} (${w.winner.party})`,
        n(w.margin),
      ];
    }),
  };
}

const ENTRY_TEXT = { YES: 'Entered', NO: 'Pending', NA: 'n/a' } as const;

function boothTable(r: ScopedReport): TableSpec {
  const wardNo = new Map(r.wards.map((w) => [w.wardId, w.wardNo]));
  return {
    title: 'Booth-wise Status',
    columns: [
      { header: 'Ballot', weight: 4 },
      { header: 'Ward', weight: 4, align: 'right' },
      { header: 'Panchayat Samiti', weight: 10 },
      { header: 'Booth No', weight: 4, align: 'right' },
      { header: 'Booth Name', weight: 22 },
      { header: 'Entry', weight: 6 },
      { header: 'Round', weight: 4, align: 'right' },
      { header: 'Entered By', weight: 13 },
      { header: 'Entered At', weight: 11 },
      { header: 'Last Edited', weight: 11 },
      { header: 'Total Votes', weight: 6, align: 'right' },
    ],
    rows: r.booths.map((b): CellContent[] => [
      b.kind,
      String(wardNo.get(b.wardId) ?? b.wardNo),
      b.psName,
      String(b.boothNo),
      b.boothName,
      b.entered === 'NA'
        ? 'n/a'
        : [{ text: ENTRY_TEXT[b.entered], tone: b.entered === 'YES' ? 'ok' : 'muted' }],
      n(b.round),
      b.enteredBy ?? '–',
      b.enteredAtText ?? '–',
      b.lastEditedAtText ?? '–',
      n(b.totalVotes),
    ]),
  };
}

export function countingStatusPdfModel(r: ScopedReport): PdfModel {
  const ps = r.summary.PS;
  const zp = r.summary.ZP;
  const level = r.scope.level;
  const oneArea = level === 'WARD' || level === 'BOOTH';
  const pending = r.wards.filter(listsPendingInPdf);
  const notStarted = r.wards.filter((w) => w.status === 'NOT_STARTED').length;

  const first: TableSpec[] = [];
  if (r.kinds.length > 0 && level !== 'WARD') {
    first.push({
      title: 'Summary',
      columns: [
        { header: 'Type', weight: 10 },
        { header: 'Wards', weight: 5, align: 'right' },
        { header: 'Not Started', weight: 6, align: 'right' },
        { header: 'Counting In Progress', weight: 7, align: 'right' },
        { header: 'Ready To Declare', weight: 7, align: 'right' },
        { header: 'Declared (incl. unopposed)', weight: 8, align: 'right' },
        { header: 'Unopposed', weight: 6, align: 'right' },
        { header: 'Stalled', weight: 5, align: 'right' },
        { header: 'Check Data', weight: 5, align: 'right' },
        { header: 'Booths Done', weight: 6, align: 'right' },
        { header: 'Booths Total', weight: 6, align: 'right' },
        { header: 'Booths Pending', weight: 6, align: 'right' },
        { header: 'Booths %', weight: 5, align: 'right' },
        { header: 'Postal Done', weight: 6, align: 'right' },
        { header: 'Last Entry', weight: 14 },
      ],
      rows: r.kinds.map((k) => summaryRow(k, r.summary[k])),
    });
  }
  const many = r.psTable.length > 1;
  if (r.psTable.length > 0) {
    first.push({
      title: 'Panchayat Samiti-wise Progress',
      columns: [
        { header: 'Panchayat Samiti', weight: 16 },
        { header: 'PS Wards', weight: 5, align: 'right' },
        { header: 'PS Wards Declared', weight: 6, align: 'right' },
        { header: 'PS Booths Done', weight: 6, align: 'right' },
        { header: 'PS Booths Total', weight: 6, align: 'right' },
        { header: 'PS Booths Pending', weight: 6, align: 'right' },
        { header: 'PS Booths %', weight: 5, align: 'right' },
        { header: 'ZP Booths Done', weight: 6, align: 'right' },
        { header: 'ZP Booths Total', weight: 6, align: 'right' },
        { header: 'ZP Booths Pending', weight: 6, align: 'right' },
      ],
      rows: [
        ...r.psTable.map((p): CellContent[] => [
          p.psName,
          n(p.wardsTotal),
          n(p.declared),
          n(p.psBoothsDone),
          n(p.psBoothsTotal),
          n(p.psBoothsPending),
          pct(p.psBoothsPercent),
          n(p.zpBoothsDone),
          n(p.zpBoothsTotal),
          n(p.zpBoothsPending),
        ]),
        // The district line (every PS): the summary's own numbers; tests check they equal the sums.
        ...(many
          ? [
              [
                'All Panchayat Samitis',
                n(ps.wardsTotal),
                n(ps.declared),
                n(ps.boothsDone),
                n(ps.boothsTotal),
                n(ps.boothsPending),
                pct(ps.boothsPercent),
                n(zp.boothsDone),
                n(zp.boothsTotal),
                n(zp.boothsPending),
              ],
            ]
          : []),
      ],
      ...(many ? { boldRows: new Set([r.psTable.length]) } : {}),
    });
  }

  const wards =
    level === 'BOOTH'
      ? []
      : (['PS', 'ZP'] as const)
          .filter((k) => r.wards.some((w) => w.kind === k))
          .map((k) => wardTable(r, k));

  const notes: string[] = [];
  if (!oneArea && r.wards.length === 0) notes.push('No ward matches this scope.');
  if (!oneArea && notStarted > 0)
    notes.push(`${fmtInt(notStarted)} wards not started (full list in the CSV)`);

  return {
    title: r.title,
    scopeLine: `Scope: ${r.scope.label}`,
    subtitle: [
      r.electionName,
      `${r.electionDateText}   ·   Report time: ${r.asOfText}`,
      `Stalled = counting in progress and no entry for ${String(r.stalledAfterMinutes)} minutes. Winner and margin are shown only after a ward is declared.`,
    ],
    first,
    pageBreakBeforeWards: many,
    wards,
    booths: oneArea ? boothTable(r) : null,
    pending: oneArea
      ? null
      : {
          title: 'Pending Booths – wards in counting',
          columns: [
            { header: 'Type', weight: 4 },
            { header: 'Panchayat Samiti', weight: 11 },
            { header: 'Ward', weight: 4, align: 'right' },
            { header: 'Flags', weight: 7 },
            { header: 'Pending', weight: 5, align: 'right' },
            { header: 'Pending Booth Numbers', weight: 38 },
            { header: 'Last Entry', weight: 13 },
          ],
          rows: pending.map((w): CellContent[] => [
            w.kind,
            w.psName ?? '–',
            String(w.wardNo),
            w.stalled ? [{ text: 'Stalled', tone: 'bad' }] : '',
            n(w.boothsPending),
            w.pendingBooths !== ''
              ? w.pendingBooths
              : w.postalDone === false
                ? 'All booths entered; postal ballots pending'
                : '–',
            w.lastEntryText ?? '–',
          ]),
        },
    notes,
    footerLeft: `${r.title}   ·   Scope: ${r.scope.label}   ·   Report time: ${r.asOfText}`,
  };
}

export async function renderCountingStatusPdf(
  r: ScopedReport,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const m = countingStatusPdfModel(r);
  const pdf = await PagedDocument.open({ title: m.title, compress: opts.compress ?? true });
  pdf.text(m.title, { size: 16, bold: true }, { color: COLORS.header, after: 2 });
  pdf.text(m.scopeLine, { size: 11, bold: true }, { color: COLORS.ink, after: 2 });
  m.subtitle.forEach((line, i) => {
    pdf.text(
      line,
      { size: i === 0 ? 10 : 8.5 },
      {
        color: i === 0 ? COLORS.ink : COLORS.muted,
        after: i === m.subtitle.length - 1 ? 12 : 1,
      },
    );
  });
  for (const t of m.first) pdf.table(t);
  if (m.pageBreakBeforeWards) pdf.pageBreak(); // ward-wise starts on a new page
  for (const t of m.wards) pdf.table(t);
  if (m.booths !== null) pdf.table(m.booths);
  if (m.pending !== null) {
    if (m.pending.rows.length > 0) pdf.table(m.pending, 6);
    else if (r.wards.length > 0)
      pdf.text(`${m.pending.title}: none`, { size: 9, bold: true }, { after: 4 });
  }
  for (const note of m.notes) pdf.text(note, { size: 9 }, { color: COLORS.muted, after: 2 });
  return pdf.finish((page, pages) => ({
    left: m.footerLeft,
    right: `Page ${String(page)} of ${String(pages)}`,
  }));
}
