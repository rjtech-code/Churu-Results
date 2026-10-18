// Reading a candidate's votes from the engine's result. Pure.
import type { WardResult } from '../result.js';

/** A candidate's total votes (booth + postal) as the engine computed them. */
export function votesOf(result: WardResult, candidateId: number): number {
  const row = result.candidates.find((c) => c.id === candidateId && !c.isNota);
  // The candidates and the result come from the same snapshot; a miss is a programming error.
  if (row === undefined)
    throw new Error(`ward form: candidate ${String(candidateId)} has no result`);
  return row.totalVotes;
}
