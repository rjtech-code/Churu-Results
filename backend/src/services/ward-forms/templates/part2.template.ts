// "प्रारूप–14 भाग–II (मतगणना का परिणाम), अभिलिखित मतों का लेखा" (Rajasthan Panchayati Raj (Election)
// Rules 1994), the same for PS and ZP wards, for the ward sheet and the booth sheet. Wording as on
// the DEO's sample (Prarup14_Churu_Ward01.pdf, Nov 2026).
import type { Part2Template } from './types.js';

/** One A4 portrait page holds this many candidate rows (NOTA and Total rows extra). */
export const PART2_MAX_CANDIDATES = 20;

/**
 * Title of the officer who signs at the bottom: by the WARD's kind only (never by who downloads).
 * PS ward booth -> the Returning Officer; ZP ward booth -> the Assistant Returning Officer.
 */
export function part2SignatureTitle(kind: 'PS' | 'ZP'): string {
  return kind === 'PS' ? 'रिटर्निंग अधिकारी' : 'सहायक रिटर्निंग अधिकारी';
}

export const PART2: Part2Template = {
  title: 'Prarup-14 Part-II',
  page: { size: 'A4', layout: 'portrait', margin: 40 },
  latin: 'sans',
  maxCandidates: PART2_MAX_CANDIDATES,
  fitSteps: [
    { spacing: 1, font: 1 },
    { spacing: 0.8, font: 1 },
    { spacing: 0.6, font: 1 },
    { spacing: 0.45, font: 0.92 },
    { spacing: 0.35, font: 0.85 },
    { spacing: 0.25, font: 0.8 },
    { spacing: 0.15, font: 0.75 },
    { spacing: 0.1, font: 0.7 },
  ],
  minFontSize: 8,
  text: {
    form: 'प्रारूप–14',
    rules: '(नियम 47–C – 49–D (6) संबंधित प्रावधान देखिए)',
    title: 'अभिलिखित मतों का लेखा',
    part: 'भाग–II (मतगणना का परिणाम)',
    details: 'निर्वाचन का विवरण',
    bodyName: { ZP: 'जिला परिषद का नाम–', PS: 'पंचायत समिति का नाम–' },
    wardNo: 'वार्ड / निर्वाचन क्षेत्र संख्यांक',
    booth: 'मतदान केन्द्र का क्रमांक एवं नाम –',
    candidates: 'अभिलिखित मतों का अभ्यर्थीवार विवरण',
    headers: ['क्र. सं.', 'अभ्यर्थी का नाम', 'अभिलिखित वैध मतों की संख्या'],
    nota: 'नोटा – उपरोक्त में से कोई नहीं',
    total: 'कुल अभिलिखित मतों की संख्या',
    verification: 'मतों का सत्यापन एवं मिलान',
    tallyQuestion:
      '(क) क्या ऊपर दर्शाई गई कुल मतों की संख्या, भाग–I के मद सं. 5 में दर्शाए गए अभिलिखित मतों की कुल संख्या से मेल खाती है?',
    tallyAnswer: 'हाँ / नहीं',
    discrepancy: '(ख) यदि कोई अंतर पाया गया है, तो उसका संक्षिप्त विवरण व कारण',
    date: 'दिनांक',
    place: 'स्थान –',
    supervisor: 'मतगणना पर्यवेक्षक के हस्ताक्षर',
    agents: 'उपस्थित अभ्यर्थी / निर्वाचन अभिकर्ता / मतगणना अभिकर्ताओं के हस्ताक्षर',
    agentHeaders: ['क्र. सं.', 'अभ्यर्थी / अभिकर्ता का नाम', 'हस्ताक्षर'],
    agentRows: 8,
    signatureOf: 'के हस्ताक्षर',
    seal: 'पदनाम एवं सील',
  },
  style: {
    form: { size: 13, bold: true },
    rules: { size: 10 },
    title: { size: 13, bold: true },
    part: { size: 11, bold: true },
    heading: { size: 11, bold: true },
    body: { size: 10 },
    value: { size: 12, bold: true },
    header: { size: 10.5, bold: true },
    cell: { size: 10.5 },
    name: { size: 12, bold: true },
  },
  table: { widths: [90, 340, 350], padX: 5, padY: 4, minRowHeight: 22, lineWidth: 0.8 },
  agentsTable: { widths: [90, 340, 350], padX: 5, padY: 3, minRowHeight: 20, lineWidth: 0.8 },
  gaps: {
    form: 1,
    rules: 1,
    title: 1,
    part: 16,
    details: 8,
    line: 7,
    candidates: 5,
    table: 10,
    verification: 4,
    tally: 4,
    date: 8,
    place: 12,
    agents: 5,
    agentsTable: 14,
  },
  signatureSpace: 40,
  slots: { value: 0.33, right: 0.55 },
  wardNoDigits: 2,
  date: (iso) => iso.split('-').reverse().join('.'),
};
