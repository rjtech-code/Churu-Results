// Pure checks for a typed result sheet (booth or postal). Shared by preview, create and update so
// the confirm screen and the save can never disagree. No vote ADDING happens here: totals come only
// from result.ts. These checks only compare one sheet with itself.
import { ApiError } from '../middleware/errors.js';
import { expectedPostalVoteSum } from './result.js';

export interface SheetVote {
  candidateId: number;
  votes: number;
}

export interface BallotCandidate {
  id: number;
  ballotPosition: number;
  nameHindi: string;
  isNota: boolean;
  partyShortName: string | null;
}

/** Exactly one row for every candidate of the ward (NOTA included); no unknown or duplicate ids. */
export function checkVoteRows(
  candidates: readonly BallotCandidate[],
  votes: readonly SheetVote[],
): void {
  const known = new Set(candidates.map((c) => c.id));
  const unknown = [...new Set(votes.map((v) => v.candidateId).filter((id) => !known.has(id)))];
  if (unknown.length > 0) throw new ApiError(400, 'UNKNOWN_CANDIDATE', { candidateIds: unknown });

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const v of votes) {
    if (seen.has(v.candidateId)) duplicates.add(v.candidateId);
    seen.add(v.candidateId);
  }
  if (duplicates.size > 0)
    throw new ApiError(400, 'DUPLICATE_CANDIDATE', { candidateIds: [...duplicates] });

  const missing = candidates.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length > 0)
    throw new ApiError(400, 'VOTES_INCOMPLETE', { missingCandidateIds: missing });
}

/** Sum of the sheet's vote rows (each row is already a bounded whole number, see the Zod schema). */
export function sheetSum(votes: readonly SheetVote[]): number {
  return votes.reduce((sum, v) => sum + v.votes, 0);
}

/** Booth sheet: candidates + NOTA must equal the typed sheet total (rule 6). */
export function checkBoothSum(votes: readonly SheetVote[], sheetTotal: number): void {
  const sum = sheetSum(votes);
  if (sum !== sheetTotal) throw new ApiError(400, 'SUM_MISMATCH', { sum, sheetTotal });
}

/** Postal sheet: the rule lives in result.ts (expectedPostalVoteSum); it is not duplicated here. */
export function checkPostalSum(
  votes: readonly SheetVote[],
  sheetTotal: number,
  rejectedCount: number | null,
): void {
  const sum = sheetSum(votes);
  const expected = expectedPostalVoteSum({ sheetTotal, rejectedCount, votes });
  if (sum !== expected) throw new ApiError(400, 'SUM_MISMATCH', { sum, sheetTotal });
}

/**
 * Rule 7: a booth total may not exceed the booth's registered voters.
 * Without a voter count: refused when requireVoterCounts, otherwise allowed with a warning.
 */
export function checkRegisteredVoters(
  sheetTotal: number,
  registeredVoters: number | null,
  requireVoterCounts: boolean,
): string[] {
  if (registeredVoters === null) {
    if (requireVoterCounts) throw new ApiError(409, 'VOTER_COUNT_MISSING');
    return ['VOTER_COUNT_MISSING'];
  }
  if (sheetTotal > registeredVoters) {
    throw new ApiError(400, 'EXCEEDS_REGISTERED_VOTERS', { sheetTotal, registeredVoters });
  }
  return [];
}
