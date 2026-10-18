// "प्ररूप – 7" (Rajasthan Panchayati Raj (Election) Rules 1994): the result statement and the
// declaration on ONE A4 landscape page. One template for both levels: the printed words come from
// the official ZP form (docs/forms scan, pages 2-3) with the body's name and rule numbers taken from
// the level (prarup7-levels.ts). The label maps start from the app's Hindi labels and can be
// reworded here.
import { CANDIDATE_CATEGORY_HI, EDUCATION_HI } from '../../master-data/candidate-details.js';
import { INDEPENDENT_HINDI } from '../../public-views.js';
import type { HeaderValue, Prarup7Level, Prarup7Template } from './types.js';

/** One A4 landscape page holds this many candidates (plus the NOTA row and the declaration). */
export const PRARUP7_MAX_CANDIDATES = 12;

/** Values filled into the printed text when the form is made. */
export const PLACEHOLDER = { ward: '{ward}', name: '{name}' } as const;

function headerLabels(w: Prarup7Level): Record<HeaderValue, string> {
  return {
    bodyName: `${w.bodyFormal} :-`,
    wardCount: 'कुल निर्वाचन मण्डल :-',
    panchayatSamitis: 'पंचायत समिति :-',
    district: 'जिला :-',
    electionDate: 'निर्वाचन की तारीख :-',
  };
}

function columns(w: Prarup7Level): Prarup7Template['text']['columns'] {
  return {
    ward: `कुल निर्वाचक मण्डल सहित ${w.body} निर्वाचन क्षेत्र की संख्या (आरक्षण के ब्यौरे, यदि कोई हो)`,
    uncontested: `नियम ${w.rules.uncontested} के अधीन निर्विरोध घोषित अभ्यर्थियों के नाम (केवल ${w.body} सदस्य के लिए राजनीतिक दल का नाम)`,
    contested: `उन अभ्यर्थियों के नाम जिनके लिए विधिमान्य मत डाले गये (केवल ${w.body} सदस्य के लिए राजनीतिक दल के नाम)`,
    particulars: 'स्तम्भ (2) और (3) में उल्लेखित अभ्यर्थियों की विशिष्टियां',
    letters: ['(क)', '(ख)', '(ग)', '(घ)', '(ङ)', '(च)'],
    particularHeads: [
      'पता',
      'जाति (अनु.जाति. या अनु. जनजाति या अन्य पिछड़ा वर्ग का उल्लेख कीजिये)',
      'शैक्षिक स्तर क्या निरक्षर/मिडल से कम/ मैट्रिक/ स्नातक है',
      'आयु वर्षों में',
      'व्यवसाय',
      'क्या पूर्व में पंच या सरपंच का पद धारित किया है।',
    ],
    votes: 'प्रत्येक अभ्यर्थी को डाले गये विधिमान्य मतों की संख्या',
    rejected: 'नामंजूर किये गये मतों की संख्या',
    lot: `नियम ${w.rules.lot} के अधीन लॉट का यदि कोई हो, परिणाम`,
    remarks: 'अभ्युक्तियाँ',
  };
}

function text(w: Prarup7Level): Prarup7Template['text'] {
  const labels = headerLabels(w);
  return {
    form: 'प्ररूप – 7',
    rules: `(नियम ${w.rules.form} देखिये)`,
    heading: `${w.bodyFormal} के सदस्य के पद के लिए निर्वाचन के परिणामों को दर्शित करने वाली विवरणी`,
    office: `${w.bodyFormal} के सदस्य`,
    header: w.header.map((h) => ({ ...h, label: labels[h.value] })),
    columns: columns(w),
    columnNumbers: ['1', '2', '3', '4', '5', '6', '7', '8'],
    notaName: 'नोटा',
    notaNote: '(इनमें से कोई नहीं)',
    none: '—',
    declarationSerial: '1',
    declaration: `मैं, इसके द्वारा घोषित करता हूँ कि निम्नलिखित अभ्यर्थी प्रत्येक के सामने विनिर्दिष्ट वार्ड से ${w.body} सदस्य के रूप में निर्वाचन क्षेत्र संख्या ${PLACEHOLDER.ward} से उपर्युक्त ${w.bodyFormal} के सदस्य के रूप में, निर्वाचित हुआ है।`,
    declarationColumns: [
      'क्रम संख्या',
      `कार्यालय का नाम सदस्य, ${w.bodyFormal}`,
      'निर्वाचित अभ्यर्थी का नाम और पता',
      'लिंग (F/M)',
      'जाति (SC/ST/ OBC/Gen)',
      'वार्ड / निर्वाचन क्षेत्र की क्रम संख्या',
      'अभ्युक्तियाँ',
    ],
    declarationNumbers: ['1', '2', '3', '4', '5', '6', '7'],
    declarationOffice: `${w.body}, ${PLACEHOLDER.name}`,
    place: 'स्थान :',
    date: 'दिनांक :',
    signature: ['रिटर्निंग अधिकारी', `${w.bodyFormal} निर्वाचन`, w.roDesignation ?? ''],
  };
}

/** The layout, sizes and labels shared by both levels. */
const LAYOUT: Omit<Prarup7Template, 'title' | 'text' | 'signaturePlace'> = {
  page: { size: 'A4', layout: 'landscape', margin: 22 },
  latin: 'sans',
  maxCandidates: PRARUP7_MAX_CANDIDATES,
  fitSteps: [
    { spacing: 1, font: 1 },
    { spacing: 0.75, font: 1 },
    { spacing: 0.5, font: 1 },
    { spacing: 0.35, font: 0.92 },
    { spacing: 0.25, font: 0.85 },
    { spacing: 0.2, font: 0.8 },
  ],
  minFontSize: 7,
  labels: {
    education: { ...EDUCATION_HI },
    category: { ...CANDIDATE_CATEGORY_HI },
    declarationCategory: { GEN: 'Gen', SC: 'SC', ST: 'ST', OBC: 'OBC' },
    gender: { M: 'M', F: 'F' },
    independent: INDEPENDENT_HINDI,
  },
  headerGutter: 6,
  footerSplit: 0.5,
  formats: {
    numbered: (n, text) => `${String(n)}. ${text}`,
    bracketed: (text) => `(${text})`,
    lineBreak: '\n',
    labelled: (label, value) => `${label} ${value}`,
    listSeparator: ', ',
    date: (iso) => iso.split('-').reverse().join('.'),
  },
  wardNoDigits: 2,
  style: {
    form: { size: 12, bold: true },
    rules: { size: 9 },
    heading: { size: 12.5, bold: true },
    office: { size: 11, bold: true },
    header: { size: 10.5 },
    columnHead: { size: 8 },
    columnNumber: { size: 7.5 },
    cell: { size: 9 },
    wardNo: { size: 24, bold: true },
    declaration: { size: 9.5 },
    declarationCell: { size: 9.5 },
    footer: { size: 9 },
  },
  table: {
    // 1, 2, 3, (क)-(च), 5, 6, 7, 8, as on the printed form.
    widths: [135, 140, 227, 218, 145, 157, 80, 133, 117, 105, 95, 111, 107],
    padX: 3,
    padY: 3,
    minRowHeight: 12,
    lineWidth: 0.6,
  },
  declarationTable: {
    widths: [120, 184, 456, 166, 387, 207, 148],
    padX: 3,
    padY: 3,
    minRowHeight: 12,
    lineWidth: 0.6,
  },
  gaps: {
    form: 1,
    rules: 1,
    heading: 4,
    office: 2,
    header: 8,
    table: 12,
    declaration: 4,
    declarationTable: 14,
    footerLine: 4,
  },
};

/** The Prarup-7 template of one level. */
export function prarup7Template(level: Prarup7Level): Prarup7Template {
  return { ...LAYOUT, title: level.title, signaturePlace: level.signaturePlace, text: text(level) };
}
