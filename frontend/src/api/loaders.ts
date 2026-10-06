import { ApiError, api } from './api';
import type { BallotCandidate, BoothsResponse, WardItem } from './types';

export async function loadWards(): Promise<WardItem[]> {
  return (await api<{ wards: WardItem[] }>('GET', '/api/counting/wards')).wards;
}

/** One of the user's wards; a ward that is not theirs counts as FORBIDDEN. */
export async function loadWard(wardId: number): Promise<WardItem> {
  const ward = (await loadWards()).find((w) => w.id === wardId);
  if (!ward) throw new ApiError(403, 'FORBIDDEN', {});
  return ward;
}

export async function loadBallot(wardId: number): Promise<BallotCandidate[]> {
  return (await api<{ candidates: BallotCandidate[] }>('GET', `/api/counting/wards/${wardId}/ballot`))
    .candidates;
}

export function loadBooths(wardId: number): Promise<BoothsResponse> {
  return api<BoothsResponse>('GET', `/api/counting/wards/${wardId}/booths`);
}

/** Route params are text; anything that is not a positive whole number is "not found". */
export function idParam(value: string | undefined): number {
  return value !== undefined && /^[1-9]\d{0,14}$/.test(value) ? Number(value) : 0;
}
