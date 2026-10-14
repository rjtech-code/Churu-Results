import { ApiError, api } from './api';
import type { BallotCandidate, BoothsResponse, CombinedBooth, WardItem } from './types';

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

/** Part 14: a booth's PS and ZP sections for the PS_RO's combined entry screen. */
export function loadCombined(boothId: number): Promise<CombinedBooth> {
  return api<CombinedBooth>('GET', `/api/counting/booths/${boothId}/combined`);
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
 * (Part 14) may not read the ZP ward, so it uses the booth's combined view and goes back there.
 */
export async function loadEntryContext(
  entry: { kind: 'BOOTH' | 'POSTAL'; wardId: number; boothId?: number; ballotFor?: 'PS' | 'ZP' },
  role: string | null,
): Promise<EntryContext> {
  if (role === 'PS_RO' && entry.kind === 'BOOTH' && entry.ballotFor === 'ZP' && entry.boothId !== undefined) {
    const boothId = entry.boothId;
    const combined = await loadCombined(boothId);
    const zp = combined.sections[1];
    if (zp.state === 'HIDDEN')
      throw new ApiError(409, zp.hiddenReason === 'DECLARED' ? 'WARD_DECLARED' : 'FORBIDDEN', {});
    return {
      ward: { id: zp.wardId, kind: 'ZP', wardNo: zp.wardNo },
      ballot: zp.ballot,
      booth: combined.booth,
      backTo: `/booths/${boothId}/entry`,
      backLabel: `बूथ ${combined.booth.boothNo} की पर्ची`,
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
