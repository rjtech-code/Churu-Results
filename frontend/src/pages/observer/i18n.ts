// The observer dashboard's one small dictionary: English by default, with a "हिंदी" toggle that is
// remembered in the browser. Candidate and place names are always shown as stored.
import { createContext, useContext } from 'react';

export type Lang = 'en' | 'hi';
const STORAGE_KEY = 'observer.lang';

export function storedLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private windows may refuse storage; the toggle still works for this visit.
  }
}

const DICT = {
  title: ['Churu District', 'चूरू ज़िला'],
  subtitle: ['Panchayat General Elections 2026 · Counting Dashboard', 'पंचायत आम चुनाव 2026 · मतगणना डैशबोर्ड'],
  overview: ['Overview', 'एक नज़र'],
  panchayatSamitis: ['Panchayat Samitis', 'पंचायत समितियाँ'],
  zilaParishad: ['Zila Parishad', 'ज़िला परिषद'],
  winners: ['Winners', 'विजेता'],
  reports: ['Reports', 'रिपोर्ट'],
  logout: ['Sign out', 'लॉग आउट'],
  lastUpdated: ['Last updated', 'अंतिम अपडेट'],
  live: ['Live', 'लाइव'],
  countingNotStarted: ['Counting not started', 'मतगणना शुरू नहीं हुई'],
  countingInProgress: ['Counting in progress', 'मतगणना जारी'],
  countingCompleted: ['Counting completed', 'मतगणना पूर्ण'],
  countingDate: ['Counting day', 'मतगणना दिवस'],
  countingVenue: ['District headquarters, Churu (Rajasthan)', 'ज़िला मुख्यालय, चूरू (राजस्थान)'],
  countdown: ['Counting begins in', 'मतगणना शुरू होने में'],
  days: ['days', 'दिन'],
  hours: ['hours', 'घंटे'],
  minutes: ['minutes', 'मिनट'],
  wardsDeclared: ['Wards declared', 'वार्ड घोषित'],
  boothsCounted: ['Booth result sheets', 'बूथ परिणाम पर्चियाँ'],
  boothSheetsNote: ['Two ballots at every booth: PS and ZP', 'हर बूथ पर दो मतपत्र: पं.स. और ज़ि.प.'],
  postalEntered: ['Postal sheets entered', 'डाक मतपत्र दर्ज'],
  ofTotal: ['of', 'में से'],
  ps: ['Panchayat Samiti', 'पंचायत समिति'],
  zp: ['Zila Parishad', 'ज़िला परिषद'],
  psShort: ['PS', 'पं.स.'],
  zpShort: ['ZP', 'ज़ि.प.'],
  partyPosition: ['Party position', 'दलीय स्थिति'],
  won: ['Won', 'जीते'],
  leading: ['Leading', 'आगे'],
  seats: ['seats', 'सीटें'],
  latestDeclarations: ['Latest declarations', 'ताज़ा घोषणाएँ'],
  noDeclarationsYet: ['Results will appear here as wards are declared.', 'वार्ड घोषित होते ही परिणाम यहाँ दिखेंगे।'],
  structure: ['Election at a glance', 'चुनाव एक नज़र में'],
  structureBooths: ['Polling booths', 'मतदान बूथ'],
  structureCandidates: ['Candidates', 'उम्मीदवार'],
  structureParties: ['Parties', 'दल'],
  psWards: ['PS wards', 'पं.स. वार्ड'],
  zpWards: ['ZP wards', 'ज़ि.प. वार्ड'],
  ward: ['Ward', 'वार्ड'],
  wards: ['Wards', 'वार्ड'],
  status: ['Status', 'स्थिति'],
  progress: ['Booth progress', 'बूथ प्रगति'],
  postal: ['Postal', 'डाक मत'],
  winner: ['Winner', 'विजेता'],
  margin: ['Margin', 'अंतर'],
  votes: ['Votes', 'मत'],
  candidate: ['Candidate', 'उम्मीदवार'],
  party: ['Party', 'पार्टी'],
  independent: ['Independent', 'निर्दलीय'],
  total: ['Total', 'कुल'],
  boothVotes: ['Booth votes', 'बूथ मत'],
  postalVotes: ['Postal votes', 'डाक मत'],
  notStarted: ['Not started', 'शुरू नहीं'],
  inProgress: ['In progress', 'जारी'],
  ready: ['Ready to declare', 'घोषणा हेतु तैयार'],
  declared: ['Declared', 'घोषित'],
  unopposed: ['Unopposed', 'निर्विरोध'],
  tie: ['Tie — lottery pending', 'बराबरी — लॉटरी शेष'],
  noCandidates: ['Candidate list pending', 'उम्मीदवार सूची शेष'],
  unavailable: ['Data unavailable', 'डेटा उपलब्ध नहीं'],
  corrected: ['Corrected', 'संशोधित'],
  entered: ['Entered', 'दर्ज'],
  pending: ['Pending', 'शेष'],
  yes: ['Yes', 'हाँ'],
  no: ['No', 'नहीं'],
  nota: ['NOTA', 'नोटा'],
  validVotes: ['Valid votes', 'वैध मत'],
  rejectedPostal: ['Rejected postal ballots', 'निरस्त डाक मतपत्र'],
  reservation: ['Reservation', 'आरक्षण'],
  boothProgressOfWard: ['Booths of this ward', 'इस वार्ड के बूथ'],
  byPs: ['By Panchayat Samiti', 'पंचायत समिति अनुसार'],
  declarationHistory: ['Declaration history', 'घोषणा विवरण'],
  version: ['Version', 'संस्करण'],
  declaredAt: ['Declared at', 'घोषणा समय'],
  viaLottery: ['By lottery', 'लॉटरी से'],
  search: ['Search', 'खोजें'],
  searchHint: ['Ward number, Panchayat Samiti or candidate name…', 'वार्ड नंबर, पंचायत समिति या उम्मीदवार का नाम…'],
  searchResults: ['Search results', 'खोज परिणाम'],
  noResults: ['Nothing matched this search.', 'इस खोज से कुछ नहीं मिला।'],
  matched: ['Matching candidates', 'मिलते-जुलते उम्मीदवार'],
  all: ['All', 'सभी'],
  women: ['Women winners', 'महिला विजेता'],
  womenOnly: ['Women only', 'केवल महिला विजेता'],
  filterParty: ['Party', 'पार्टी'],
  filterPs: ['Panchayat Samiti', 'पंचायत समिति'],
  noWinnersYet: ['No winners yet. Declared results will be listed here.', 'अभी कोई विजेता नहीं। घोषित परिणाम यहाँ दिखेंगे।'],
  downloads: ['Downloads', 'डाउनलोड'],
  downloadNote: ['Every download is recorded in the audit log.', 'प्रत्येक डाउनलोड ऑडिट लॉग में दर्ज होता है।'],
  countingStatusPdf: ['Counting Status Report (PDF)', 'मतगणना स्थिति रिपोर्ट (PDF)'],
  wardsCsv: ['Ward-wise status (CSV)', 'वार्डवार स्थिति (CSV)'],
  boothsCsv: ['Booth-wise status (CSV)', 'बूथवार स्थिति (CSV)'],
  zpByPsCsv: ['ZP wards by Panchayat Samiti (CSV)', 'पंचायत समिति अनुसार ज़ि.प. वार्ड (CSV)'],
  loadError: ['Live data temporarily unavailable, retrying…', 'लाइव डेटा अभी उपलब्ध नहीं, पुनः प्रयास जारी…'],
  about: ['About this system', 'इस प्रणाली के बारे में'],
  aboutText: [
    'This portal is the official counting dashboard of Churu district for the Panchayat General Elections 2026 (Zila Parishad and Panchayat Samiti members). Every figure is typed from the approved result sheet (parchi), matched against the sheet total before it is accepted, protected by an append-only audit log and locked candidate lists, and declared only by the Returning Officers.',
    'यह पोर्टल पंचायत आम चुनाव 2026 (ज़िला परिषद एवं पंचायत समिति सदस्य) के लिए चूरू ज़िले का अधिकृत मतगणना डैशबोर्ड है। प्रत्येक आँकड़ा अनुमोदित परिणाम पर्ची से दर्ज होता है, स्वीकृति से पहले पर्ची के योग से मिलाया जाता है, केवल-जुड़ने वाले ऑडिट लॉग और लॉक की गई उम्मीदवार सूचियों से सुरक्षित है, और घोषणा केवल रिटर्निंग अधिकारी करते हैं।',
  ],
  // The credit line. **…** marks the only two bold parts: the officer's name and Code Churu.
  aboutCredit: [
    'An initiative of **Shri Abhishek Surana, IAS**, District Collector & District Election Officer, Churu. Built by the students of **Code Churu**, another of his initiatives.',
    'यह **श्री अभिषेक सुराणा, आई.ए.एस.**, जिला कलक्टर एवं जिला निर्वाचन अधिकारी, चूरू की पहल है। इसे उन्हीं की एक अन्य पहल **कोड चूरू** के विद्यार्थियों ने बनाया है।',
  ],
  close: ['Close', 'बंद करें'],
  backToList: ['Back', 'वापस'],
  declaredOf: ['declared', 'घोषित'],
  results: ['Result', 'परिणाम'],
  viewAll: ['View all', 'सभी देखें'],
  showing: ['Showing', 'दिखाए जा रहे हैं'],
  ofWinners: ['of', 'में से'],
  countingAtAGlance: ['Counting at a glance', 'मतगणना एक नज़र में'],
  wardsCounting: ['Wards counting', 'मतगणना जारी वार्ड'],
  wardsNotStarted: ['Not started', 'शुरू नहीं'],
  whatYouWillSee: ['What this dashboard will show', 'इस डैशबोर्ड पर क्या दिखेगा'],
  psBlurb: [
    'Booth progress and declared wards for each of the 13 Panchayat Samitis.',
    '13 पंचायत समितियों की बूथ प्रगति और घोषित वार्ड।',
  ],
  zpBlurb: [
    'All 39 Zila Parishad wards, with progress across every Panchayat Samiti.',
    'सभी 39 ज़िला परिषद वार्ड, हर पंचायत समिति की प्रगति सहित।',
  ],
  winnersBlurb: [
    'Declared winners with party and margin, searchable and filterable.',
    'घोषित विजेता, पार्टी और अंतर सहित — खोज और फ़िल्टर के साथ।',
  ],
  reportsBlurb: [
    'The official Counting Status Report as PDF and CSV.',
    'अधिकृत मतगणना स्थिति रिपोर्ट — PDF और CSV।',
  ],
  zpBooths: ['ZP-ballot booths', 'ज़ि.प. मतपत्र बूथ'],
  psSheets: ['PS sheets', 'पं.स. पर्चियाँ'],
  zpSheets: ['ZP sheets', 'ज़ि.प. पर्चियाँ'],
  openWard: ['Open ward', 'वार्ड खोलें'],
  print: ['Print', 'प्रिंट'],
} as const;

export type DictKey = keyof typeof DICT;

export function translate(lang: Lang, key: DictKey): string {
  return DICT[key][lang === 'hi' ? 1 : 0];
}

export interface LangState {
  lang: Lang;
  t: (key: DictKey) => string;
  setLang: (lang: Lang) => void;
}

export const LangContext = createContext<LangState | null>(null);

export function useLang(): LangState {
  const state = useContext(LangContext);
  if (state === null) throw new Error('useLang outside the observer layout');
  return state;
}

/** 12,345 with Latin digits in both languages (numbers are the heroes; digits stay comparable). */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

/** "20 Nov 2026, 04:32 PM IST" from an ISO IST stamp. */
export function formatIst(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
    .replace(/ /g, ' ')
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase())} IST`;
}
