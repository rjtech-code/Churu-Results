import { ApiError, api } from './api';
import type { BallotCandidate, BoothsResponse, PsZpWardBooths, PsZpWardItem, WardItem } from './types';

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

/** Part 14.1: the ZP wards that hold booths of the PS_RO's own PS (ZP tab). */
export async function loadPsZpWards(): Promise<PsZpWardItem[]> {
  return (await api<{ wards: PsZpWardItem[] }>('GET', '/api/counting/zp-wards')).wards;
}

/** Part 14.1: one ZP ward's own-PS booths and ballot, for the PS_RO. */
export function loadPsZpWard(wardId: number): Promise<PsZpWardBooths> {
  return api<PsZpWardBooths>('GET', `/api/counting/zp-wards/${wardId}/ps-booths`);
}

/** Where an entry's edit/void page gets its ballot and booth from, and where it goes back to. */
export interface EntryContext {
  ward: Pick<WardItem, 'id' | 'kind' | 'wardNo'>;
  ballot: BallotCandidate[];
  booth: { boothNo: number; nameHindi: string; registeredVotersTotal: number | null } | null;
  backTo: string;
  backLabel: string;
  /** null when this user cannot open the ward's booth history (a PS_RO on a ZP ballot). */
  historyTo: string | null;
}

/**
 * The normal case reads the entry's own ward. A PS_RO working on a ZP ballot of its own booth
 * may not read the ZP ward, so it uses the own-PS ZP ward view and goes back to the ZP tab.
 */
export async function loadEntryContext(
  entry: { kind: 'BOOTH' | 'POSTAL'; wardId: number; boothId?: number; ballotFor?: 'PS' | 'ZP' },
  role: string | null,
): Promise<EntryContext> {
  if (role === 'PS_RO' && entry.kind === 'BOOTH' && entry.ballotFor === 'ZP') {
    const { ward, booths, ballot } = await loadPsZpWard(entry.wardId);
    if (ward.state === 'DECLARED') throw new ApiError(409, 'WARD_DECLARED', {});
    return {
      ward: { id: ward.id, kind: 'ZP', wardNo: ward.wardNo },
      ballot,
      booth: booths.find((b) => b.boothId === entry.boothId) ?? null,
      backTo: `/zp/${ward.id}`,
      backLabel: `जिला परिषद वार्ड ${ward.wardNo}`,
      historyTo: null,
    };
  }
  const [ward, booths, ballot] = await Promise.all([
    loadWard(entry.wardId),
    loadBooths(entry.wardId),
    loadBallot(entry.wardId),
  ]);
  const booth =
    entry.boothId === undefined ? undefined : booths.booths.find((b) => b.boothId === entry.boothId);
  return {
    ward,
    ballot,
    booth: booth ?? null,
    backTo: `/wards/${ward.id}`,
    backLabel: `वार्ड ${ward.wardNo}`,
    historyTo: entry.boothId === undefined ? null : `/wards/${ward.id}/booths/${entry.boothId}/history`,
  };
}
