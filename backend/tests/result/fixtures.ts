import type {
  BoothEntryInput,
  DeclarationInput,
  PostalEntryInput,
  ResultCandidateInput,
  WardResultInput,
} from '../../src/services/result.js';

/** Pure builders for engine inputs (no database). */

export const cand = (
  id: number,
  ballotPosition: number,
  partyId: number | null = null,
): ResultCandidateInput => ({
  id,
  ballotPosition,
  nameHindi: `उम्मीदवार ${id}`,
  partyId,
  isNota: false,
});

export const nota = (id: number, ballotPosition: number): ResultCandidateInput => ({
  id,
  ballotPosition,
  nameHindi: 'इनमें से कोई नहीं',
  partyId: null,
  isNota: true,
});

/** A booth entry whose sheetTotal is the sum of the votes (override to break it). */
export function booth(
  boothId: number,
  votes: Record<number, number>,
  roundNo = 1,
  sheetTotal?: number,
): BoothEntryInput {
  const rows = Object.entries(votes).map(([id, v]) => ({ candidateId: Number(id), votes: v }));
  return {
    boothId,
    roundNo,
    sheetTotal: sheetTotal ?? rows.reduce((s, r) => s + r.votes, 0),
    votes: rows,
  };
}

export function postal(
  votes: Record<number, number>,
  rejectedCount: number | null = null,
  sheetTotal?: number,
): PostalEntryInput {
  const rows = Object.entries(votes).map(([id, v]) => ({ candidateId: Number(id), votes: v }));
  return {
    sheetTotal: sheetTotal ?? rows.reduce((s, r) => s + r.votes, 0),
    rejectedCount,
    votes: rows,
  };
}

/** Standard contested PS ward 100: booths 1-3, candidates A=11 (pos 1), B=12 (pos 2), C=13 (pos 3), NOTA=19 (pos 4). */
export const A = 11;
export const B = 12;
export const C = 13;
export const N = 19;

export function wardInput(
  over: Partial<WardResultInput> & { boothIds?: number[]; isUnopposed?: boolean } = {},
): WardResultInput {
  const { boothIds, isUnopposed, ...rest } = over;
  return {
    ward: {
      id: 100,
      kind: 'PS',
      isUnopposed: isUnopposed ?? false,
      boothIds: boothIds ?? [1, 2, 3],
    },
    candidates: [cand(A, 1, 1), cand(B, 2, 2), cand(C, 3), nota(N, 4)],
    boothEntries: [],
    postalEntry: null,
    latestDeclaration: null,
    ...rest,
  };
}

export function declaration(over: Partial<DeclarationInput> = {}): DeclarationInput {
  return { version: 1, status: 'DECLARED', winnerCandidateId: A, margin: 1, snapshot: {}, ...over };
}

/** Deterministic shuffle (seeded), so "order does not matter" tests are reproducible. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** The same input with every list shuffled (candidates, entries, vote rows, booth ids). */
export function shuffleInput(input: WardResultInput, seed: number): WardResultInput {
  return {
    ...input,
    ward: { ...input.ward, boothIds: shuffled(input.ward.boothIds, seed) },
    candidates: shuffled(input.candidates, seed + 1),
    boothEntries: shuffled(
      input.boothEntries.map((e, i) => ({ ...e, votes: shuffled(e.votes, seed + 10 + i) })),
      seed + 2,
    ),
    postalEntry: input.postalEntry && {
      ...input.postalEntry,
      votes: shuffled(input.postalEntry.votes, seed + 3),
    },
  };
}
