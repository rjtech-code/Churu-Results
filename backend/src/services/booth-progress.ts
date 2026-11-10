// THE one place counting progress is counted: "booths entered / total booths" of a ward.
// A booth is entered when it has a live (not voided) booth entry for the ward's ballot; total is
// every booth of the ward (a ZP ward: across every Panchayat Samiti). Postal ballots are never part
// of it (they are shown next to it). Pure: counts booths only, never adds votes.

export interface BoothProgress {
  entered: number;
  total: number;
}

/** Progress of `booths` (one ward's booths, or a part of them) given the booths with a live entry. */
export function boothProgress(
  booths: Iterable<{ id: number }>,
  entered: ReadonlySet<number>,
): BoothProgress {
  let total = 0;
  let done = 0;
  for (const b of booths) {
    total++;
    if (entered.has(b.id)) done++;
  }
  return { entered: done, total };
}

/** The same count split by Panchayat Samiti (first-seen PS order); the parts add up to the ward. */
export function boothProgressByPs(
  booths: readonly { id: number; psId: number }[],
  entered: ReadonlySet<number>,
): Map<number, BoothProgress> {
  const byPs = new Map<number, { id: number }[]>();
  for (const b of booths) byPs.set(b.psId, [...(byPs.get(b.psId) ?? []), b]);
  return new Map([...byPs].map(([psId, list]) => [psId, boothProgress(list, entered)]));
}
