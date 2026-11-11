// Shapes of the /api/observer JSON (result-level data only; the server never sends personal or
// operational fields to an observer).

export type CountingPhase = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type ObserverWardStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'DECLARED';

export interface SeatRow {
  party: { shortName: string | null; nameHindi: string };
  won: number;
  leading: number;
  total: number;
}

export interface KindKpis {
  wardsTotal: number;
  declared: number;
  unopposed: number;
  counting: number;
  notStarted: number;
  boothsEntered: number;
  boothsTotal: number;
  postalEntered: number;
  postalTotal: number;
}

export interface FeedItem {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  isCorrection: boolean;
  winner: { name: string; party: { shortName: string | null; nameHindi: string } | null };
  margin: number;
  declaredAt: string;
}

export interface StructureCounts {
  panchayatSamitis: number;
  psWards: number;
  zpWards: number;
  booths: number;
  candidates: number;
  parties: number;
}

export interface ObserverOverview {
  generatedAt: string;
  countingDate: string;
  phase: CountingPhase;
  structure: StructureCounts;
  kpis: { ps: KindKpis; zp: KindKpis };
  partySeats: { ps: SeatRow[]; zp: SeatRow[] };
  feed: FeedItem[];
}

export interface ObserverWardRow {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  status: ObserverWardStatus;
  unopposed: boolean;
  noCandidates: boolean;
  tieNeedsLottery: boolean;
  boothsDone: number | null;
  boothsTotal: number | null;
  boothsPercent: number | null;
  postalDone: boolean | null;
  winner: { name: string; party: string } | null;
  margin: number | null;
}

export interface KindSummary {
  wardsTotal: number;
  notStarted: number;
  inProgress: number;
  ready: number;
  declared: number;
  unopposed: number;
  stalled: number;
  checkData: number;
  noCandidates: number;
  boothsDone: number;
  boothsTotal: number;
  boothsPending: number;
  boothsPercent: number | null;
  postalDone: number;
  postalTotal: number;
  lastEntryAt: string | null;
  lastEntryText: string | null;
}

export interface ObserverPsCard {
  psId: number;
  psName: string;
  wardsTotal: number;
  declared: number;
  boothsDone: number;
  boothsTotal: number;
  boothsPercent: number | null;
  zpBoothsDone: number;
  zpBoothsTotal: number;
}

export interface ObserverPsList {
  generatedAt: string;
  summary: KindSummary;
  list: ObserverPsCard[];
}

export interface ObserverPsDetail {
  ps: ObserverPsCard;
  wards: ObserverWardRow[];
}

export interface ObserverZp {
  generatedAt: string;
  summary: KindSummary;
  wards: ObserverWardRow[];
  byPs: {
    wardId: number;
    rows: { psName: string; boothsDone: number; boothsTotal: number }[];
    postalEntered: boolean | null;
  }[];
}

export interface ObserverWardDetail {
  ward: {
    id: number;
    kind: 'PS' | 'ZP';
    wardNo: number;
    psName: string | null;
    reservationCategory: string | null;
    isUnopposed: boolean;
    status: string;
    totalValidVotes: number;
    notaVotes: number;
    rejectedPostal: number | null;
    boothsEntered: number;
    boothsTotal: number;
    postalEntered: boolean;
    margin: number | null;
    unavailable: boolean;
  };
  candidates: {
    id: number;
    ballotPosition: number;
    name: string;
    party: { shortName: string; nameHindi: string } | null;
    isNota: boolean;
    boothVotes: number;
    postalVotes: number;
    totalVotes: number;
    rank: number | null;
    isWinner: boolean;
  }[];
  booths: { boothNo: string; name: string; psName: string; entered: boolean }[];
  postal: { entered: boolean };
  declarations: {
    version: number;
    status: string;
    winner: { id: number; name: string };
    margin: number;
    totalValidVotes: number | null;
    declaredAt: string;
  }[];
}

export interface ObserverWinner {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  winner: { name: string; party: string };
  margin: number | null;
  unopposed: boolean;
  tieResolved: boolean;
  isWoman: boolean;
  isCorrected: boolean;
}

export interface ObserverWinners {
  generatedAt: string;
  list: ObserverWinner[];
}

export interface SearchHit {
  wardId: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  status: ObserverWardStatus;
  winner: { name: string; party: string } | null;
  matchedCandidates: { name: string; party: string | null }[];
}
