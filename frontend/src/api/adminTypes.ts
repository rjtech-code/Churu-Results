// Shapes of the Part 13 JSON: the DM's /api/admin tools and the RO's /api/candidates.

export type Gender = 'M' | 'F' | 'O';
export type ListStatus = 'PENDING' | 'READY' | 'LOCKED';

/** A problem in an uploaded file or a form, already in Hindi (with what to do). */
export interface Issue {
  rows: number[];
  message: string;
}

export interface CheckResult<P> {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  preview: P | null;
  sha256: string;
}

export interface PartiesPreview {
  toInsert: { shortName: string; nameHindi: string; nameEnglish: string; symbol: string }[];
  unchanged: string[];
}

export interface Party {
  id: number;
  name_hindi: string;
  name_english: string;
  short_name: string;
  symbol: string;
}

export interface CandidateWardPreview {
  wardId: number;
  kind: 'PS' | 'ZP';
  panchayatSamiti: { id: number; name: string } | null;
  wardNo: number;
  reservationCategory: string | null;
  unopposed: boolean;
  replaces: boolean;
  candidates: {
    position: number;
    nameHindi: string;
    party: { shortName: string; nameHindi: string } | null;
    gender: Gender;
  }[];
}

export interface CandidatesPreview {
  wards: CandidateWardPreview[];
  totals: { wards: number; candidates: number; unopposed: number; replaced: number };
  wardsStillEmpty: number;
}

export interface AreaSummary {
  area: string;
  name: string;
  total: number;
  pending: number;
  ready: number;
  locked: number;
}

export interface AreaWard {
  id: number;
  wardNo: number;
  label: string;
  candidates: number;
  unopposed: boolean;
  status: ListStatus;
  hasEntries: boolean;
  returnReason: string | null;
}

export interface CandidateStatus {
  areas: AreaSummary[];
  detail: { area: string; name: string; wards: AreaWard[] } | null;
}

export interface WardCandidate extends CandidateDetails {
  id: number;
  position: number;
  nameHindi: string;
  party: { shortName: string; nameHindi: string } | null;
  gender: Gender;
}

export interface WardCandidatesView {
  ward: {
    id: number;
    label: string;
    status: ListStatus;
    unopposed: boolean;
    reservationCategory: string | null;
  };
  candidates: WardCandidate[];
}

export interface LockWard {
  id: number;
  wardNo: number;
  label: string;
}

export interface LockPreview {
  area: string;
  toLock: LockWard[];
  alreadyLocked: number;
  noCandidates: LockWard[];
  notReady: LockWard[];
  canLock: boolean;
}

export interface SeatAccount {
  id: number;
  username: string;
  fullName: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  locked: boolean;
}

export interface Seat {
  seat: string;
  label: string;
  account: SeatAccount | null;
  olderAccounts: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface BoothRow {
  id: number;
  boothNo: number;
  nameHindi: string;
  psWard: { id: number; wardNo: number };
  zpWard: { id: number; wardNo: number };
  voters: { male: number | null; female: number | null; other: number | null; total: number | null };
  hasEntry: boolean;
  canEditName: boolean;
  canMove: boolean;
  canEditVoters: boolean;
}

export interface EditWard {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  reservationCategory: string | null;
  locked: boolean;
  hasEntries: boolean;
}

export interface RoWard {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  label: string;
  candidates: number;
  unopposed: boolean;
  status: ListStatus;
  hasEntries: boolean;
  returnReason: string | null;
}

export type Education =
  | 'ILLITERATE'
  | 'LITERATE'
  | 'PRIMARY'
  | 'UPPER_PRIMARY'
  | 'SECONDARY'
  | 'SR_SECONDARY'
  | 'GRADUATE'
  | 'POST_GRADUATE'
  | 'PROFESSIONAL';

export const EDUCATION_HINDI: Record<Education, string> = {
  ILLITERATE: 'निरक्षर',
  LITERATE: 'साक्षर',
  PRIMARY: 'प्राथमिक',
  UPPER_PRIMARY: 'उच्च प्राथमिक',
  SECONDARY: 'माध्यमिक',
  SR_SECONDARY: 'उच्च माध्यमिक',
  GRADUATE: 'स्नातक',
  POST_GRADUATE: 'स्नातकोत्तर',
  PROFESSIONAL: 'व्यावसायिक',
};

/** The candidate's own social category (not the ward's reservation). */
export type CandidateCategory = 'GEN' | 'SC' | 'ST' | 'OBC';

/** Shown as the codes, the same as the official ST Format. */
export const CANDIDATE_CATEGORIES: readonly CandidateCategory[] = ['GEN', 'SC', 'ST', 'OBC'];

/** Optional private details (DM and the ward's own RO only). dob is YYYY-MM-DD. */
export interface CandidateDetails {
  dob: string | null;
  ageStated: number | null;
  education: Education | null;
  mobile: string | null;
  candidateCategory: CandidateCategory | null;
  /** Free text, Hindi allowed (Prarup-7 पता / व्यवसाय). */
  address: string | null;
  occupation: string | null;
}

/** The server's limits (candidate.address / candidate.occupation). */
export const MAX_ADDRESS_LENGTH = 300;
export const MAX_OCCUPATION_LENGTH = 100;

export const NO_CANDIDATE_DETAILS: CandidateDetails = {
  dob: null,
  ageStated: null,
  education: null,
  mobile: null,
  candidateCategory: null,
  address: null,
  occupation: null,
};

/** Only the detail fields of a candidate (what the forms send). */
export const pickDetails = (d: CandidateDetails): CandidateDetails => ({
  dob: d.dob,
  ageStated: d.ageStated,
  education: d.education,
  mobile: d.mobile,
  candidateCategory: d.candidateCategory,
  address: d.address,
  occupation: d.occupation,
});

export interface RoCandidate extends CandidateDetails {
  ballotPosition: number;
  nameHindi: string;
  partyId: number | null;
  gender: Gender;
}

export interface RoWardDetail {
  ward: {
    id: number;
    kind: 'PS' | 'ZP';
    wardNo: number;
    label: string;
    panchayatSamiti: string | null;
    status: ListStatus;
    unopposed: boolean;
    hasEntries: boolean;
    editable: boolean;
    returnReason: string | null;
    reservationCategory: string | null;
  };
  candidates: RoCandidate[];
  parties: { id: number; shortName: string; nameHindi: string }[];
}

export const LIST_STATUS_HINDI: Record<ListStatus, string> = {
  PENDING: 'सूची बाकी',
  READY: 'सूची तैयार',
  LOCKED: 'लॉक',
};

export const GENDER_HINDI: Record<Gender, string> = { M: 'पुरुष', F: 'महिला', O: 'अन्य' };
