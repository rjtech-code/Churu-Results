import type { PublicStatus, RecentItem, WardCard } from './types';

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

const DEVANAGARI = /[\u0900-\u097F]/u;
const PS_HINDI = 'पंचायत समिति';

/**
 * Short PS name for the ticker and lists. The stored Hindi name is the short name ("रतनगढ़");
 * a full "पंचायत समिति रतनगढ़" is shortened too. Without a Hindi name the API sends the English
 * name: "RATANGARH PANCHAYAT SAMITI" -> "RATANGARH".
 */
export function psShortName(name: string): string {
  const n = name.trim();
  if (DEVANAGARI.test(n)) {
    return n
      .replace(new RegExp(`^${PS_HINDI}\\s+`, 'u'), '')
      .replace(new RegExp(`\\s+${PS_HINDI}$`, 'u'), '')
      .trim();
  }
  return n.replace(/\s+PANCHAYAT\s+SAMITI$/i, '').trim();
}

/** Page title: "<Hindi short name> पंचायत समिति"; the English name as it is when there is no Hindi name. */
export function psTitle(name: string): string {
  return DEVANAGARI.test(name) ? `${psShortName(name)} ${PS_HINDI}` : name.trim();
}

/** At most `max` characters, cut only between words (then "…"); a single long word stays whole. */
export function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const words = text.split(' ');
  let out = words[0] ?? '';
  for (const w of words.slice(1)) {
    if (`${out} ${w}`.length > max - 1) break;
    out = `${out} ${w}`;
  }
  return `${out.replace(/[\s·—:]+$/u, '')} …`;
}

export const TICKER_MAX_CHARS = 60;

/** One "अभी बदला" item: "<short PS or ज़िला परिषद> · वार्ड N · <what happened>". */
export function tickerText(r: RecentItem): string {
  const where = r.kind === 'ZP' ? 'ज़िला परिषद' : psShortName(r.psName ?? '');
  const p = r.leaderOrWinner;
  const who = p === null ? null : `${p.name} (${partyShort(p.party)})`;
  const label = STATUS_LABEL[r.status];
  let what = label;
  if (who !== null && (r.status === 'DECLARED' || r.status === 'TIE_RESOLVED' || r.status === 'UNOPPOSED')) {
    what = `${label}: ${who}`;
  } else if (who !== null && (r.status === 'COUNTING' || r.status === 'READY_TO_DECLARE')) {
    what = `${label} — आगे: ${who}`;
  }
  return fitWords(`${where} · वार्ड ${r.wardNo} · ${what}`, TICKER_MAX_CHARS);
}

export type Tone = 'grey' | 'blue' | 'amber' | 'green' | 'purple' | 'teal' | 'red';
export const TONES: readonly Tone[] = ['grey', 'blue', 'amber', 'green', 'purple', 'teal', 'red'];

/** Card stripe + badge colour per status (always with the text label). */
export const STATUS_TONE: Record<PublicStatus, Tone> = {
  NOT_STARTED: 'grey',
  NO_CANDIDATES: 'grey',
  COUNTING: 'blue',
  READY_TO_DECLARE: 'blue',
  TIE_NEEDS_LOTTERY: 'amber',
  DECLARED: 'green',
  TIE_RESOLVED: 'purple',
  UNOPPOSED: 'teal',
  UNAVAILABLE: 'red',
};

/** Cards that are not interesting yet (quiet look; a page of only these rotates in 5 s). */
export function isQuiet(status: PublicStatus): boolean {
  return status === 'NOT_STARTED' || status === 'NO_CANDIDATES';
}
