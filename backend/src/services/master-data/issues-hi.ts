// Simple Hindi text for every master-data issue, for the web pages. Each message says what is wrong
// and how to fix it, e.g. "पंक्ति 15: चूरू पंचायत समिति वार्ड 5 में बैलेट नंबर 2 दो बार है — Excel में
// इसे ठीक करके फ़ाइल फिर से चुनें".
import type { Issue, IssueBody, PartyField, WardRef } from './issues.js';
import type { SheetFailure } from './xlsx.js';

/** Where the officer fixes it: in the Excel file, or in the form on screen. */
export type FixMode = 'file' | 'form';

export interface HindiIssue {
  rows: number[];
  message: string;
}

const COLUMN_HI: Readonly<Record<string, string>> = {
  panchayat_samiti: 'पंचायत समिति',
  election: 'चुनाव (PS / ZP)',
  ward_no: 'वार्ड नंबर',
  ballot_position: 'बैलेट नंबर',
  name_hindi: 'हिंदी नाम',
  party_short_name: 'पार्टी',
  gender: 'लिंग',
  reservation_category: 'आरक्षण वर्ग',
  name_english: 'अंग्रेज़ी नाम',
  short_name: 'छोटा नाम',
  symbol: 'चुनाव चिह्न',
};

const columnHi = (c: string): string => COLUMN_HI[c] ?? c;
const fieldHi = (f: PartyField): string => columnHi(f);

/** "चूरू पंचायत समिति" (adds "पंचायत समिति" unless the stored name already has it). */
export function psHi(name: string | null): string {
  if (name === null || name === '') return 'पंचायत समिति';
  return name.includes('पंचायत समिति') ? name : `${name} पंचायत समिति`;
}

export function wardHi(w: WardRef): string {
  return w.type === 'PS'
    ? `${psHi(w.psNameHindi)} वार्ड ${w.wardNo}`
    : `ज़िला परिषद वार्ड ${w.wardNo}`;
}

function text(issue: IssueBody): string {
  switch (issue.code) {
    case 'CELL_EMPTY':
      return `"${columnHi(issue.column)}" खाली है`;
    case 'CELL_NOT_INT':
      return `"${columnHi(issue.column)}" में पूरी संख्या (${issue.min === 1 ? '1 या अधिक' : '0 या अधिक'}) होनी चाहिए, लिखा है "${issue.value}"`;
    case 'PARTY_DUPLICATE_IN_FILE':
      return `${fieldHi(issue.field)} "${issue.value}" एक से अधिक बार है`;
    case 'PARTY_EXISTS_DIFFERENT':
      return `पार्टी "${issue.shortName}" पहले से सूची में है, पर उसका ${issue.fields.map(fieldHi).join(', ')} अलग है; पहले से जुड़ी पार्टी बदली नहीं जा सकती`;
    case 'PARTY_NAME_TAKEN':
      return `${fieldHi(issue.field)} "${issue.value}" पहले से पार्टी "${issue.owner}" का है`;
    case 'PARTY_TOO_LONG':
      return `${fieldHi(issue.field)} ${issue.max} अक्षरों से लंबा है`;
    case 'EXAMPLE_ROW':
      return 'यह टेम्पलेट की EXAMPLE (नमूना) पंक्ति है, इसे हटाएँ';
    case 'ELECTION_INVALID':
      return `"चुनाव" में PS या ZP लिखें, लिखा है "${issue.value}"`;
    case 'GENDER_INVALID':
      return `"लिंग" में M (पुरुष), F (महिला) या O (अन्य) लिखें, लिखा है "${issue.value}"`;
    case 'PARTY_UNKNOWN':
      return `पार्टी "${issue.value}" पार्टी सूची में नहीं है — पहले "पार्टी सूची" में जोड़ें`;
    case 'PS_REQUIRED':
      return 'PS वाली पंक्ति में "पंचायत समिति" भरें';
    case 'PS_UNKNOWN':
      return `पंचायत समिति "${issue.value}" नहीं मिली (अंग्रेज़ी नाम वैसा ही लिखें जैसा सूची में है)`;
    case 'PS_WARD_UNKNOWN':
      return `${psHi(issue.psNameHindi)} में वार्ड ${issue.wardNo} नहीं है`;
    case 'ZP_WARD_UNKNOWN':
      return `ज़िला परिषद में वार्ड ${issue.wardNo} नहीं है`;
    case 'ZP_PS_IGNORED':
      return 'ZP वाली पंक्ति में "पंचायत समिति" की ज़रूरत नहीं है; उसे छोड़ दिया गया';
    case 'NAME_TOO_LONG':
      return `नाम ${issue.max} अक्षरों से लंबा है`;
    case 'WARD_LOCKED':
      return `${wardHi(issue.ward)} की सूची लॉक है, इसके उम्मीदवार नहीं बदल सकते`;
    case 'WARD_HAS_ENTRIES':
      return `${wardHi(issue.ward)} में मतगणना शुरू हो चुकी है, इसके उम्मीदवार नहीं बदल सकते`;
    case 'POSITION_REPEATED':
      return `${wardHi(issue.ward)} में बैलेट नंबर ${issue.position} दो बार है`;
    case 'POSITION_GAPS':
      return `${wardHi(issue.ward)} में बैलेट नंबर 1 से ${issue.count} तक बिना छूटे होने चाहिए; अभी हैं: ${issue.found.join(', ')}`;
    case 'PARTY_TWICE':
      return `${wardHi(issue.ward)} में पार्टी "${issue.party}" के एक से अधिक उम्मीदवार हैं`;
    case 'CATEGORY_MIXED':
      return `${wardHi(issue.ward)} की हर पंक्ति में आरक्षण वर्ग एक जैसा होना चाहिए`;
    case 'TOO_MANY_CANDIDATES':
      return `${wardHi(issue.ward)} में ${issue.max} से अधिक उम्मीदवार नहीं हो सकते`;
  }
}

function fixHint(issue: IssueBody, mode: FixMode): string {
  if (issue.code === 'ZP_PS_IGNORED') return '';
  if (issue.code === 'WARD_LOCKED' || issue.code === 'WARD_HAS_ENTRIES')
    return mode === 'file' ? ' — इस वार्ड की पंक्तियाँ फ़ाइल से हटाएँ' : '';
  if (issue.code === 'PARTY_UNKNOWN') return '';
  return mode === 'file'
    ? ' — Excel में इसे ठीक करके फ़ाइल फिर से चुनें'
    : ' — इसे ठीक करके फिर से सेव करें';
}

function rowPrefix(rows: readonly number[], mode: FixMode): string {
  if (mode === 'form' || rows.length === 0) return '';
  const sorted = [...rows].sort((a, b) => a - b);
  return sorted.length === 1 ? `पंक्ति ${sorted[0] ?? ''}: ` : `पंक्तियाँ ${sorted.join(', ')}: `;
}

export function issueTextHi(issue: Issue, mode: FixMode): string {
  return `${rowPrefix(issue.rows, mode)}${text(issue)}${fixHint(issue, mode)}`;
}

export function issuesHi(issues: readonly Issue[], mode: FixMode): HindiIssue[] {
  return issues.map((i) => ({ rows: [...i.rows], message: issueTextHi(i, mode) }));
}

export function sheetFailureHi(failure: SheetFailure): string {
  switch (failure.kind) {
    case 'UNREADABLE':
      return 'यह फ़ाइल पढ़ी नहीं जा सकी — सही Excel (.xlsx) फ़ाइल चुनें';
    case 'MISSING_COLUMNS':
      return `फ़ाइल में ये कॉलम नहीं हैं: ${failure.columns.map(columnHi).join(', ')} — खाली फ़ाइल (टेम्पलेट) डाउनलोड करके उसी में भरें`;
    case 'DUPLICATE_COLUMNS':
      return `ये कॉलम दो बार हैं: ${failure.columns.map(columnHi).join(', ')} — एक हटाकर फ़ाइल फिर से चुनें`;
  }
}
