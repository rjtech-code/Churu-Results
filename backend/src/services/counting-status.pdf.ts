// The Counting Status Report as PDF (A4 landscape). countingStatusPdfModel() turns the ONE report
// object into the exact tables and lines that get drawn (pure, so tests compare it with the JSON and
// the CSV); renderCountingStatusPdf() only draws that model. Page 1: title, summary, PS-wise; then
// ward-wise (PS, ZP); then pending booths of the wards in counting.
import type { CountingStatusReport, KindSummary, WardKind, WardRow } from './counting-status.js';
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
  subtitle: string[];
  tables: TableSpec[];
  /** Printed after the pending-booths table. */
  notStartedLine: string;
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

export function countingStatusPdfModel(r: CountingStatusReport): PdfModel {
  const ps = r.summary.PS;
  const zp = r.summary.ZP;
  const pending = r.wards.filter(listsPendingInPdf);
  const notStarted = r.wards.filter((w) => w.status === 'NOT_STARTED').length;

  const tables: TableSpec[] = [
    {
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
      rows: [summaryRow('PS', ps), summaryRow('ZP', zp)],
    },
    {
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
        // The district line: the summary's own numbers (tests check they equal the rows' sums).
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
      ],
      boldRows: new Set([r.psTable.length]),
    },
    wardTable(r, 'PS'),
    wardTable(r, 'ZP'),
    {
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
  ];

  return {
    title: r.title,
    subtitle: [
      r.electionName,
      `${r.electionDateText}   ·   Report time: ${r.asOfText}`,
      `Stalled = counting in progress and no entry for ${String(r.stalledAfterMinutes)} minutes. Winner and margin are shown only after a ward is declared.`,
    ],
    tables,
    notStartedLine: `${fmtInt(notStarted)} wards not started (full list in the CSV)`,
    footerLeft: `${r.title}   ·   Report time: ${r.asOfText}`,
  };
}

export async function renderCountingStatusPdf(
  r: CountingStatusReport,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const m = countingStatusPdfModel(r);
  const pdf = await PagedDocument.open({ title: m.title, compress: opts.compress ?? true });
  pdf.text(m.title, { size: 16, bold: true }, { color: COLORS.header, after: 2 });
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
  const [summary, psWise, psWards, zpWards, pendingTable] = m.tables;
  for (const t of [summary, psWise]) if (t !== undefined) pdf.table(t);
  pdf.pageBreak(); // ward-wise starts on page 2
  for (const t of [psWards, zpWards]) if (t !== undefined) pdf.table(t);
  if (pendingTable !== undefined) {
    if (pendingTable.rows.length > 0) pdf.table(pendingTable, 6);
    else pdf.text(`${pendingTable.title}: none`, { size: 9, bold: true }, { after: 4 });
  }
  pdf.text(m.notStartedLine, { size: 9 }, { color: COLORS.muted });
  return pdf.finish((page, pages) => ({
    left: m.footerLeft,
    right: `Page ${String(page)} of ${String(pages)}`,
  }));
}
