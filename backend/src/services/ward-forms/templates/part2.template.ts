// "PART- II Result of Counting" (Rajasthan Panchayati Raj (Election) Rules 1994), the same for PS
// and ZP wards. Wording exactly as printed on the official form (docs/forms scan, page 1).
import type { Part2Template } from './types.js';

/** One A4 portrait page holds this many candidate rows (NOTA and Total rows extra). */
export const PART2_MAX_CANDIDATES = 20;

export const PART2: Part2Template = {
  title: 'Part-II Result of Counting',
  page: { size: 'A4', layout: 'portrait', margin: 50 },
  latin: 'serif',
  maxCandidates: PART2_MAX_CANDIDATES,
  fitSteps: [
    { spacing: 1, font: 1 },
    { spacing: 0.8, font: 1 },
    { spacing: 0.6, font: 1 },
    { spacing: 0.45, font: 0.92 },
    { spacing: 0.35, font: 0.85 },
  ],
  minFontSize: 8,
  text: {
    rules: 'THE RAJASTHAN PANCHAYATI RAJ  (ELECTION) RULES 1994',
    part: 'PART- II',
    caption: 'Result of Counting',
    headers: ['S. No.', 'Name of Candidate', 'No. of votes recorded'],
    nota: '(NOTA) none of the above',
    total: 'Total',
    tally:
      'Whether the total numbers of votes shown above tallies with the total no. of votes shown against the item no. 5 of Part I or any discrepancy noticed between the two totals.',
    place: 'Place .................',
    date: 'Date ..................',
    supervisor: 'Signature of Counting Supervisor',
    agents: 'Name of candidate / election agent/ counting agent',
    fullSignature: 'Full Signature',
    agentLines: 8,
    dottedLines: 2,
    dots: '...........................................',
    returningOfficer: 'Signature of Returning Officer]',
    footnote:
      '1. Form xiv added vide notification No. F.4(25)Amen./Rule/Ele/Legal/PR/09/4127 dated 21.11.09.',
  },
  style: {
    rules: { size: 12, bold: true, italic: true },
    part: { size: 13, bold: true },
    caption: { size: 11, bold: true },
    header: { size: 11, bold: true },
    cell: { size: 11 },
    body: { size: 11 },
    footnote: { size: 9 },
  },
  table: {
    widths: [100, 255, 247],
    width: 440,
    padX: 4,
    padY: 2,
    minRowHeight: 16,
    lineWidth: 0.6,
  },
  gaps: {
    rules: 24,
    part: 2,
    table: 14,
    tally: 70,
    place: 18,
    agents: 16,
    agentLine: 0,
    footnote: 60,
    rule: 2,
  },
  indent: 0,
  slots: { signatureFrom: 0.6, agentsFrom: 0.1, agentsWidth: 0.5 },
  serial: (n) => `${String(n)}.`,
};
