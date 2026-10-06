// Shapes of the backend JSON this dashboard uses (see README API tables).

export type Role = 'PS_RO' | 'ZP_RO' | 'DM';

export interface Me {
  id: number;
  username: string;
  fullName: string | null;
  role: Role;
  panchayatSamiti: { id: number; name: string } | null;
}

export type WardStatus =
  | 'NOT_STARTED'
  | 'COUNTING'
  | 'READY_TO_DECLARE'
  | 'TIE_NEEDS_LOTTERY'
  | 'DECLARED'
  | 'TIE_RESOLVED'
  | 'UNOPPOSED'
  | 'NO_CANDIDATES';

export interface WardItem {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  panchayatSamiti: { id: number; name: string } | null;
  ballotLocked: boolean;
  isUnopposed: boolean;
  status: WardStatus;
  boothsEntered: number;
  boothsTotal: number;
  postalEntered: boolean;
}

export interface BoothItem {
  boothId: number;
  panchayatSamiti: string;
  boothNo: number;
  nameHindi: string;
  registeredVotersTotal: number | null;
  entered: boolean;
  entryId: number | null;
  roundNo: number | null;
  enteredAt: string | null;
}

export interface BoothsResponse {
  booths: BoothItem[];
  postal: { entered: boolean; entryId: number | null; enteredAt: string | null };
}

export interface BallotCandidate {
  candidateId: number;
  ballotPosition: number;
  nameHindi: string;
  partyShortName: string | null;
  isNota: boolean;
}

export interface VoteRow {
  candidateId: number;
  votes: number;
}

export interface UserRef {
  id: number;
  username: string;
  fullName: string | null;
}

export interface BoothEntryView {
  id: number;
  kind: 'BOOTH';
  wardId: number;
  boothId: number;
  ballotFor: 'PS' | 'ZP';
  roundNo: number;
  sheetTotal: number;
  rowVersion: number;
  enteredBy: UserRef | null;
  enteredAt: string;
  updatedBy: UserRef | null;
  updatedAt: string | null;
  votes: VoteRow[];
}

export interface PostalEntryView {
  id: number;
  kind: 'POSTAL';
  wardId: number;
  sheetTotal: number;
  rejectedCount: number | null;
  rowVersion: number;
  enteredBy: UserRef | null;
  enteredAt: string;
  updatedBy: UserRef | null;
  updatedAt: string | null;
  votes: VoteRow[];
}

export interface CandidateResult {
  id: number;
  ballotPosition: number;
  nameHindi: string;
  partyId: number | null;
  isNota: boolean;
  boothVotes: number;
  postalVotes: number;
  totalVotes: number;
  rank: number | null;
}

export interface RankedRow {
  candidateId: number;
  ballotPosition: number;
  nameHindi: string;
  totalVotes: number;
  rank: number;
  tiedWithPrevious: boolean;
}

export interface WardResult {
  wardId: number;
  kind: 'PS' | 'ZP';
  status: WardStatus;
  candidates: CandidateResult[];
  notaVotes: number;
  totalValidVotes: number;
  rejectedPostal: number | null;
  boothsTotal: number;
  boothsEntered: number;
  postalEntered: boolean;
  top3: RankedRow[];
  leader: RankedRow | null;
  runnerUp: RankedRow | null;
  margin: number | null;
  topTied: boolean;
  notaHighest: boolean;
  winnerCandidateId: number | null;
  declaration: { version: number; status: string; winnerCandidateId: number; margin: number } | null;
}

export interface EntryPreview {
  summary: {
    wardId: number;
    boothId: number | null;
    ballotFor: 'PS' | 'ZP' | null;
    roundNo: number | null;
    sheetTotal: number;
    rejectedCount: number | null;
    sum: number;
    votes: {
      candidateId: number;
      ballotPosition: number;
      nameHindi: string;
      isNota: boolean;
      votes: number;
    }[];
  };
  wardAfter: WardResult;
  warnings: string[];
}

export interface WouldStore {
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  winnerCandidateId: number | null;
  margin: number;
  needsLottery: boolean;
  tiedCandidateIds: number[];
  notaHighest: boolean;
}

export interface DeclarePreview {
  result: WardResult;
  wouldStore: WouldStore;
}

export interface CorrectionPreview {
  before: WardResult;
  after: WardResult;
  wouldStore: WouldStore;
  warnings: string[];
}

export interface DeclarationItem {
  version: number;
  status: 'DECLARED' | 'TIE_RESOLVED';
  winner: { id: number; nameHindi: string };
  margin: number;
  totalValidVotes: number | null;
  rejectedPostal: number | null;
  lottery: { winnerCandidateId: number; conductedBy: string; note: string } | null;
  notaHighestAck: boolean;
  declaredBy: { username: string; fullName: string | null };
  declaredAt: string;
  correctionReason: string | null;
}

export interface HistoryItem {
  action: string;
  at: string;
  user: { username: string; fullName: string | null } | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
}
