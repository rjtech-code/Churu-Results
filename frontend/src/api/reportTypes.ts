// Shapes of /api/reports (DM only), mirrored from backend/src/services/reports.ts and
// backend/src/modules/reports/ward-detail.ts.

export type ScopeKey = string; // 'ALL_PS' | 'ZP' | `PS:${id}`

export interface ReportWardRef {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  label: string;
}

export interface PartyLabel {
  shortName: string | null;
  nameHindi: string;
}

export type AlarmKind =
  'DECLARATION_MISMATCH' | 'UNAVAILABLE' | 'VOTER_CHECK_DISABLED' | 'NOTA_HIGHEST_DECLARED';

export interface Alarm {
  kind: AlarmKind;
  ward: ReportWardRef | null;
  scope: ScopeKey | null;
  detail: string;
  at: string | null;
}

export interface WinnerRow {
  ward: ReportWardRef;
  name: string;
  party: PartyLabel;
  status: 'DECLARED' | 'TIE_RESOLVED' | 'UNOPPOSED';
}

export interface ScopeSections {
  progress: {
    wardsTotal: number;
    declared: number;
    unopposed: number;
    counting: number;
    notStarted: number;
    noCandidates: number;
    unavailable: number;
    boothsEntered: number;
    boothsTotal: number;
    postalEntered: number;
    postalTotal: number;
  };
  partySeats: { party: PartyLabel; won: number; leading: number; total: number }[];
  women: { total: number; byParty: { party: PartyLabel; count: number }[]; list: WinnerRow[] };
  reservation: { category: string; wards: number; decided: number; womenWinners: number }[] | null;
  nota: {
    notaVotes: number;
    totalValidVotes: number;
    highest: { ward: ReportWardRef; notaVotes: number; topCandidateVotes: number; status: string }[];
  };
  close: {
    ward: ReportWardRef;
    winner: string;
    runnerUp: string | null;
    margin: number;
    marginPercent: number;
    totalValidVotes: number;
  }[];
  lottery: {
    ward: ReportWardRef;
    winner: string;
    tiedVotes: number;
    conductedBy: string;
    note: string;
    declaredAt: string;
    declaredBy: string;
  }[];
  corrections: {
    ward: ReportWardRef;
    version: number;
    oldWinner: string;
    newWinner: string;
    reason: string;
    declaredBy: string;
    declaredAt: string;
  }[];
  turnout: {
    validVotes: number;
    registeredVoters: number;
    percent: number | null;
    wardsIncluded: number;
    wardsTotal: number;
  };
}

export interface ReportSummary {
  generatedAt: string;
  scopes: { key: ScopeKey; label: string }[];
  alarms: Alarm[];
  sections: Record<ScopeKey, ScopeSections>;
}

export interface ReportWardDetail {
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
    declarationMismatch: boolean;
    notaHighest: boolean;
    unavailable: boolean;
  };
  candidates: {
    id: number;
    ballotPosition: number;
    name: string;
    party: { shortName: string; nameHindi: string } | null;
    gender: string | null;
    isNota: boolean;
    boothVotes: number;
    postalVotes: number;
    totalVotes: number;
    rank: number | null;
    isWinner: boolean;
  }[];
  booths: {
    boothId: number;
    boothNo: number;
    name: string;
    psName: string;
    registeredVoters: number | null;
    entered: boolean;
    roundNo: number | null;
    sheetTotal: number | null;
    votes: { candidateId: number; votes: number }[];
    enteredBy: string | null;
    enteredAt: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
    edits: number;
    voids: number;
  }[];
  postal: {
    entered: boolean;
    sheetTotal: number | null;
    rejectedCount: number | null;
    votes: { candidateId: number; votes: number }[];
    enteredBy: string | null;
    enteredAt: string | null;
    edits: number;
    voids: number;
  };
  declarations: {
    version: number;
    status: string;
    winner: { id: number; name: string };
    margin: number;
    totalValidVotes: number | null;
    lottery: { conductedBy: string; note: string } | null;
    notaHighestAck: boolean;
    correctionReason: string | null;
    declaredBy: string;
    declaredAt: string;
  }[];
}
