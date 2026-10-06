import type { PublicStatus, WardCard } from './types';

const indian = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Western digits with Indian grouping: 123456 -> "1,23,456". */
export function fmt(n: number): string {
  return indian.format(n);
}

/** "HH:MM:SS" of an IST ISO time from the server (e.g. 2026-11-20T10:15:02.123+05:30). */
export function istClock(iso: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m?.[1] ?? '—';
}

/** Status badge text on the TV cards (every status the public API can send). */
export const STATUS_LABEL: Record<PublicStatus, string> = {
  NOT_STARTED: 'शुरू नहीं',
  COUNTING: 'मतगणना जारी',
  READY_TO_DECLARE: 'घोषणा बाकी',
  TIE_NEEDS_LOTTERY: 'बराबर — लॉटरी बाकी',
  DECLARED: 'विजयी',
  TIE_RESOLVED: 'विजयी (लॉटरी)',
  UNOPPOSED: 'निर्विरोध निर्वाचित',
  NO_CANDIDATES: 'उम्मीदवार सूची बाकी',
  UNAVAILABLE: 'उपलब्ध नहीं',
};

export const INDEPENDENT = 'निर्दलीय';

export function partyShort(party: { shortName: string | null } | null): string {
  return party?.shortName ?? INDEPENDENT;
}

export function wardLabel(card: Pick<WardCard, 'wardNo'>): string {
  return `वार्ड ${card.wardNo}`;
}

/** Short PS name for page titles: "पंचायत समिति रतनगढ़" -> "रतनगढ़". */
export function psShort(name: string): string {
  return name.replace(/^पंचायत समिति\s+/, '');
}
