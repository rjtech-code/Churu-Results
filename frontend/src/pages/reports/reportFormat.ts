import type { AlarmKind } from '../../api/reportTypes';

const indian = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
/** Western digits, Indian grouping: 123456 -> "1,23,456". */
export const num = (n: number): string => indian.format(n);
export const pct = (n: number): string => `${indian.format(n)}%`;

export const ALARM_LABEL: Record<AlarmKind, string> = {
  DECLARATION_MISMATCH: 'घोषणा और वर्तमान मत मेल नहीं खाते',
  UNAVAILABLE: 'परिणाम उपलब्ध नहीं',
  VOTER_CHECK_DISABLED: 'मतदाता संख्या की जाँच बंद',
  NOTA_HIGHEST_DECLARED: 'नोटा सर्वाधिक, फिर भी घोषित',
};

export const REPORT_STATUS: Record<string, string> = {
  NOT_STARTED: 'शुरू नहीं',
  COUNTING: 'मतगणना जारी',
  READY_TO_DECLARE: 'घोषणा बाकी',
  TIE_NEEDS_LOTTERY: 'बराबर — लॉटरी बाकी',
  DECLARED: 'घोषित',
  TIE_RESOLVED: 'घोषित (लॉटरी)',
  UNOPPOSED: 'निर्विरोध',
  NO_CANDIDATES: 'उम्मीदवार सूची बाकी',
  UNAVAILABLE: 'उपलब्ध नहीं',
};

export const GENDER: Record<string, string> = { F: 'महिला', M: 'पुरुष', O: 'अन्य' };

export function csvUrl(section: string, scope: string): string {
  return `/api/reports/export.csv?section=${encodeURIComponent(section)}&scope=${encodeURIComponent(scope)}`;
}
