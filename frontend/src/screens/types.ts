// Shapes of the public API (/api/public/*), mirrored from backend/src/services/public-views.ts and
// public-snapshot.ts. Ward-level data only.

export const PUBLIC_STATUSES = [
  'NOT_STARTED',
  'COUNTING',
  'READY_TO_DECLARE',
  'TIE_NEEDS_LOTTERY',
  'DECLARED',
  'TIE_RESOLVED',
  'UNOPPOSED',
  'NO_CANDIDATES',
  'UNAVAILABLE',
] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

export interface PartyRef {
  shortName: string;
  nameHindi: string;
}

export interface Person {
  candidateId: number;
  name: string;
  party: PartyRef | null;
}

export interface TopRow extends Person {
  votes: number;
  rank: number;
  tiedWithPrevious: boolean;
}

export interface WardCard {
  wardId: number;
  wardNo: number;
  status: PublicStatus;
  boothsEntered: number;
  boothsTotal: number;
  latestRound: number | null;
  postalEntered: boolean;
  top3: TopRow[];
  margin: number | null;
  topTied: boolean;
  notaVotes: number;
  winner: Person | null;
  declarationVersion: number | null;
  isCorrected: boolean;
  isUnopposed: boolean;
  reservationCategory: string | null;
}

export interface Summary {
  wardsTotal: number;
  declared: number;
  unopposed: number;
  counting: number;
  notStarted: number;
}

export interface PsBlock {
  panchayatSamiti: { id: number; name: string };
  summary: Summary;
  wards: WardCard[];
}

export interface SeatRow {
  party: { shortName: string | null; nameHindi: string };
  won: number;
  leading: number;
  total: number;
}

export interface Versioned {
  version: number;
  generatedAt: string;
}

export interface PsScreenData extends Versioned {
  panchayatSamitis: PsBlock[];
}

export interface ZpScreenData extends Versioned {
  zp: { summary: Summary; wards: WardCard[] };
  partySeats: SeatRow[];
  psPartySeats: SeatRow[];
}

export interface RecentItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  psName: string | null;
  wardNo: number;
  status: PublicStatus;
  leaderOrWinner: Person | null;
  changedAt: string;
}

export interface WinnerItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  psName: string | null;
  wardNo: number;
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  isCorrection: boolean;
  winner: Person;
  margin: number;
  declaredAt: string;
}

export interface ListData<T> extends Versioned {
  items: T[];
}

export interface MetaData extends Versioned {
  countingDate: string;
}

export type ScreenNo = 1 | 2 | 3;

/** Everything one screen shows. */
export interface ScreenBundle {
  version: number;
  generatedAt: string;
  ps: PsScreenData | null;
  zp: ZpScreenData | null;
  recent: RecentItem[];
  winners: WinnerItem[];
}
