// The official ward forms (Part-II "Result of Counting", Prarup-7) as plain data: what the mapping
// (map-*.ts) builds from the DB read and the renderer (services/pdf) prints. A `Cell` of null is
// printed blank, for hand filling: a value the system does not know is never guessed.
import type { CandidateDetails } from '../master-data/candidate-details.js';
import type { WardResult } from '../result.js';
import type { HeaderValue } from './templates/types.js';

export type Cell = string | null;

/** One real candidate of the ward (NOTA excluded), in ballot order. */
export interface FormCandidate {
  id: number;
  position: number;
  nameHindi: string;
  /** Party name in Hindi; null = independent. */
  partyHindi: string | null;
  gender: 'M' | 'F' | 'O' | null;
  details: CandidateDetails;
}

/** Everything the mapping needs, read in one place (modules/reports/ward-forms.data.ts). */
export interface FormSource {
  ward: { id: number; kind: 'PS' | 'ZP'; wardNo: number; reservation: string | null };
  /** Hindi name (every ward belongs to a district). */
  district: string;
  /**
   * The body the ward elects a member of: a ZP ward the district's Zila Parishad, a PS ward its
   * Panchayat Samiti. `wardCount` is all its wards (Prarup-7 "कुल निर्वाचन मण्डल").
   */
  body: { name: string; wardCount: number };
  /** ZP wards: Hindi names of the Panchayat Samitis whose booths vote in the ward, in PS order. */
  panchayatSamitis: string[];
  /** YYYY-MM-DD, or null when the DM has not set it. */
  electionDate: string | null;
  candidates: FormCandidate[];
  /** From the result engine: votes, winner and status. Never recomputed here. */
  result: WardResult;
}

// ---------------------------------------------------------------- Part-II

export interface Part2Row {
  serial: string;
  name: string;
  votes: string;
}

export interface Part2Data {
  rows: Part2Row[];
  nota: string;
  /** Candidates + NOTA, from the engine (WardResult.totalValidVotes). */
  total: string;
}

// ---------------------------------------------------------------- Prarup-7

/** Column 4 (क)-(च) of one candidate. */
export interface Particulars {
  address: Cell;
  category: Cell;
  education: Cell;
  age: Cell;
  occupation: Cell;
  /** (च) "क्या पूर्व में पंच या सरपंच का पद धारित किया है": always blank (not in the system). */
  heldPanchSarpanch: null;
}

export interface Prarup7Row {
  /** Column 2: an uncontested winner. */
  uncontested: Cell;
  /** Column 3: a candidate who got votes, or the NOTA row. */
  contested: Cell;
  particulars: Particulars;
  /** Column 5. */
  votes: Cell;
}

export interface Prarup7Declaration {
  office: string;
  /** Name, (party) and address, one per line. */
  nameAndAddress: string[];
  gender: Cell;
  category: Cell;
}

export interface Prarup7Data {
  /** The header line's values; the template's level decides which ones are printed. */
  header: Record<HeaderValue, Cell>;
  /** Below the Returning Officer's signature; null = blank for hand filling. */
  signaturePlace: Cell;
  /** Column 1: the ward number and, below it, its reservation in brackets. */
  wardNo: string;
  reservation: Cell;
  /** True for a contested ward: column 2 (uncontested winners) prints the template's "none" mark. */
  contested: boolean;
  rows: Prarup7Row[];
  /** Column 6, once for the ward. */
  rejected: Cell;
  /** Ward number as printed in the declaration ("05"). */
  wardNoPadded: string;
  declaration: Prarup7Declaration;
}
