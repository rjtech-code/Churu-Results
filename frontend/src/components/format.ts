import type { WardItem, WardStatus } from '../api/types';

export const ROLE_HINDI = {
  PS_RO: 'पंचायत समिति आरओ',
  ZP_RO: 'जिला परिषद आरओ',
  DM: 'जिला निर्वाचन अधिकारी',
} as const;

export const STATUS_HINDI: Record<WardStatus, string> = {
  NOT_STARTED: 'शुरू नहीं',
  COUNTING: 'मतगणना जारी',
  READY_TO_DECLARE: 'घोषणा के लिए तैयार',
  TIE_NEEDS_LOTTERY: 'बराबर – लॉटरी बाकी',
  DECLARED: 'घोषित',
  TIE_RESOLVED: 'घोषित (लॉटरी से)',
  UNOPPOSED: 'निर्विरोध',
  NO_CANDIDATES: 'उम्मीदवार नहीं',
};

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Western digits, India time. */
export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

export function formatDateTime(iso: string | null): string {
  return iso === null ? '—' : dateTimeFormat.format(new Date(iso));
}

export function wardTitle(w: Pick<WardItem, 'kind' | 'wardNo' | 'panchayatSamiti'>): string {
  return w.kind === 'ZP'
    ? `जिला परिषद वार्ड ${w.wardNo}`
    : `पंचायत समिति वार्ड ${w.wardNo}${w.panchayatSamiti ? ` – ${w.panchayatSamiti.name}` : ''}`;
}

/** Short ward name for lists and back links (the PS is already in the page header). */
export function wardShort(w: Pick<WardItem, 'wardNo'>): string {
  return `वार्ड ${w.wardNo}`;
}
