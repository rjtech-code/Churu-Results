// THE result engine. All result math (totals, ranks, leader, margin, top-3, tie) lives ONLY here
// (CLAUDE.md, correctness rule 1). Pure: no database, no I/O, no clock, no randomness.
// The same input always gives the same output, whatever order the input lists are in.

// ---------------------------------------------------------------- input types

export type WardKind = 'PS' | 'ZP';

export interface ResultWardInput {
  id: number;
  kind: WardKind;
  isUnopposed: boolean;
  /** Every booth of the ward (for a ZP ward: across all Panchayat Samitis). */
  boothIds: readonly number[];
}

export interface ResultCandidateInput {
  id: number;
  ballotPosition: number;
  nameHindi: string;
  partyId: number | null;
  isNota: boolean;
}

export interface VoteInput {
  candidateId: number;
  votes: number;
}

export interface BoothEntryInput {
  boothId: number;
  roundNo: number;
  sheetTotal: number;
  votes: readonly VoteInput[];
}

export interface PostalEntryInput {
  sheetTotal: number;
  /** Rejected postal ballots: shown only, not part of any sum (see expectedPostalVoteSum). */
  rejectedCount: number | null;
  votes: readonly VoteInput[];
}

export type DeclarationStatus = 'DECLARED' | 'TIE_RESOLVED';

export interface DeclarationInput {
  version: number;
  status: DeclarationStatus;
  winnerCandidateId: number;
  margin: number;
  /** ward_declarations.snapshot as stored; expected to be a DeclarationSnapshot. */
  snapshot: unknown;
}

export interface WardResultInput {
  ward: ResultWardInput;
  candidates: readonly ResultCandidateInput[];
  boothEntries: readonly BoothEntryInput[];
  postalEntry: PostalEntryInput | null;
  latestDeclaration: DeclarationInput | null;
}

/** What Part 6 stores in ward_declarations.snapshot. Always built with buildDeclarationSnapshot(). */
export interface DeclarationSnapshot {
  candidates: {
    candidateId: number;
    boothVotes: number;
    postalVotes: number;
    totalVotes: number;
  }[];
  totalValidVotes: number;
  rejectedPostal: number | null;
}

// ---------------------------------------------------------------- output types

export type ResultStatus =
  | 'UNOPPOSED'
  | 'NOT_STARTED'
  | 'COUNTING'
  | 'READY_TO_DECLARE'
  | 'TIE_NEEDS_LOTTERY'
  | 'DECLARED'
  | 'TIE_RESOLVED';

export interface CandidateResult {
  id: number;
  ballotPosition: number;
  nameHindi: string;
  partyId: number | null;
  isNota: boolean;
  boothVotes: number;
  postalVotes: number;
  totalVotes: number;
  /** Competition rank among REAL candidates (equal votes share a rank: 1, 1, 3). NOTA: null. */
  rank: number | null;
}

export interface RankedRow {
  candidateId: number;
  ballotPosition: number;
  nameHindi: string;
  totalVotes: number;
  rank: number;
  /** Same votes as the row above it in this list. */
  tiedWithPrevious: boolean;
}

export interface WardResult {
  wardId: number;
  kind: WardKind;
  status: ResultStatus;
  /** In ballot order. */
  candidates: CandidateResult[];
  notaVotes: number;
  /** All candidates + NOTA, booth + postal. */
  totalValidVotes: number;
  rejectedPostal: number | null;
  boothsTotal: number;
  boothsEntered: number;
  postalEntered: boolean;
  roundsSeen: number[];
  /** Up to 3 REAL candidates: votes descending; equal votes: declared winner first, then ballot position. */
  top3: RankedRow[];
  /** Real candidates only. Declared wards: always the declared winner (unless declarationMismatch).
   *  Undeclared tie: the first by ballot position, for DISPLAY only. */
  leader: RankedRow | null;
  runnerUp: RankedRow | null;
  /** leader - runnerUp (null with fewer than 2 real candidates). Declared wards: the declared margin. */
  margin: number | null;
  topTied: boolean;
  /** NOTA has more votes than every real candidate. A flag only; it never changes the winner. */
  notaHighest: boolean;
  /** UNOPPOSED: the only candidate. DECLARED/TIE_RESOLVED: from the declaration. Otherwise null:
   *  the engine never picks a winner by itself. */
  winnerCandidateId: number | null;
  declaration: {
    version: number;
    status: DeclarationStatus;
    winnerCandidateId: number;
    margin: number;
  } | null;
  /** Declared, but the current votes differ from the declaration snapshot, or the declared winner
   *  no longer has the most votes. An alarm. */
  declarationMismatch: boolean;
}

/** The input breaks a rule the database should already enforce. Defence in depth. */
export class ResultInputError extends Error {
  override readonly name = 'ResultInputError';
}

// ---------------------------------------------------------------- helpers

function fail(message: string): never {
  throw new ResultInputError(message);
}

/** A whole number >= 0 that JavaScript can add exactly. */
function checkCount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${what} must be a whole number 0 or more, got ${String(value)}`);
  }
}

function add(a: number, b: number, what: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail(`${what} is too large to add exactly`);
  return sum;
}

/**
 * The single place that decides what a postal sheet total covers.
 * Current rule: sheetTotal = sum of candidate + NOTA votes; rejected ballots are NOT included.
 */
export function expectedPostalVoteSum(postal: PostalEntryInput): number {
  return postal.sheetTotal;
}

/**
 * Validates one entry's vote rows against the ward's candidates: every candidate exactly once,
 * valid numbers. Returns (candidate, votes) pairs and their sum; nothing is added yet.
 */
function readVotes(
  votes: readonly VoteInput[],
  byId: ReadonlyMap<number, CandidateResult>,
  label: string,
): { rows: [CandidateResult, number][]; sum: number } {
  const rows: [CandidateResult, number][] = [];
  const seen = new Set<number>();
  let sum = 0;
  for (const vote of votes) {
    const candidate = byId.get(vote.candidateId);
    if (candidate === undefined) {
      fail(`${label}: vote for candidate ${vote.candidateId}, who is not a candidate of this ward`);
    }
    if (seen.has(vote.candidateId)) fail(`${label}: candidate ${vote.candidateId} appears twice`);
    seen.add(vote.candidateId);
    checkCount(vote.votes, `${label}: votes of candidate ${vote.candidateId}`);
    rows.push([candidate, vote.votes]);
    sum = add(sum, vote.votes, `${label}: sum of votes`);
  }
  const missing = [...byId.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    fail(`${label}: no vote row for candidate(s) ${missing.join(', ')} (a missing row is never 0)`);
  }
  return { rows, sum };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the stored snapshot is malformed or differs from the current votes. */
function snapshotDiffers(snapshot: unknown, current: readonly CandidateResult[]): boolean {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.candidates)) return true;
  const stored = new Map<unknown, Record<string, unknown>>();
  for (const row of snapshot.candidates as unknown[]) {
    if (!isRecord(row)) return true;
    stored.set(row.candidateId, row);
  }
  if (stored.size !== current.length) return true;
  return current.some((c) => {
    const row = stored.get(c.id);
    return (
      row?.boothVotes !== c.boothVotes ||
      row.postalVotes !== c.postalVotes ||
      row.totalVotes !== c.totalVotes
    );
  });
}

// ---------------------------------------------------------------- engine

export function computeWardResult(input: WardResultInput): WardResult {
  const { ward, latestDeclaration: declaration } = input;
  const label = `Ward ${ward.id}`;

  // Ward and booths.
  if (ward.boothIds.length === 0) fail(`${label} has no booths`);
  const wardBooths = new Set(ward.boothIds);
  if (wardBooths.size !== ward.boothIds.length) fail(`${label}: a booth is listed twice`);

  // Candidates, in ballot order.
  const candidates = [...input.candidates].sort(
    (a, b) => a.ballotPosition - b.ballotPosition || a.id - b.id,
  );
  const candidateIds = new Set(candidates.map((c) => c.id));
  if (candidateIds.size !== candidates.length) fail(`${label}: a candidate id appears twice`);
  if (new Set(candidates.map((c) => c.ballotPosition)).size !== candidates.length) {
    fail(`${label}: two candidates share a ballot position`);
  }
  const real = candidates.filter((c) => !c.isNota);
  if (candidates.length - real.length > 1) fail(`${label} has more than one NOTA`);
  if (real.length === 0) fail(`${label} has no real candidate`);
  if (ward.isUnopposed) {
    if (real.length > 1) fail(`${label} is unopposed but has ${real.length} real candidates`);
    if (input.boothEntries.length > 0 || input.postalEntry !== null) {
      fail(`${label} is unopposed, so it must have no booth or postal entries`);
    }
    if (declaration !== null) fail(`${label} is unopposed; unopposed wards are never declared`);
  } else if (real.length === 1) {
    fail(`${label} has only one real candidate but is not marked unopposed`);
  }

  // One result row per candidate (ballot order); votes are added into these.
  const results: CandidateResult[] = candidates.map((c) => ({
    id: c.id,
    ballotPosition: c.ballotPosition,
    nameHindi: c.nameHindi,
    partyId: c.partyId,
    isNota: c.isNota,
    boothVotes: 0,
    postalVotes: 0,
    totalVotes: 0,
    rank: null,
  }));
  const byId = new Map(results.map((c) => [c.id, c]));

  // Booth entries.
  const entered = new Set<number>();
  const rounds = new Set<number>();
  const entries = [...input.boothEntries].sort((a, b) => a.boothId - b.boothId);
  for (const entry of entries) {
    const entryLabel = `${label}, booth ${entry.boothId}`;
    if (!wardBooths.has(entry.boothId)) fail(`${entryLabel}: this booth is not in the ward`);
    if (entered.has(entry.boothId)) fail(`${entryLabel}: entered twice`);
    entered.add(entry.boothId);
    if (!Number.isSafeInteger(entry.roundNo) || entry.roundNo < 1) {
      fail(`${entryLabel}: round number must be a whole number 1 or more`);
    }
    rounds.add(entry.roundNo);
    checkCount(entry.sheetTotal, `${entryLabel}: sheet total`);
    const { rows, sum } = readVotes(entry.votes, byId, entryLabel);
    if (sum !== entry.sheetTotal) {
      fail(`${entryLabel}: votes add up to ${sum} but the sheet total is ${entry.sheetTotal}`);
    }
    for (const [candidate, votes] of rows) {
      candidate.boothVotes = add(candidate.boothVotes, votes, `${label}: booth votes`);
    }
  }

  // Postal entry.
  const postal = input.postalEntry;
  if (postal !== null) {
    const postalLabel = `${label}, postal`;
    checkCount(postal.sheetTotal, `${postalLabel}: sheet total`);
    if (postal.rejectedCount !== null)
      checkCount(postal.rejectedCount, `${postalLabel}: rejected count`);
    const { rows, sum } = readVotes(postal.votes, byId, postalLabel);
    if (sum !== expectedPostalVoteSum(postal)) {
      fail(`${postalLabel}: votes add up to ${sum} but the sheet total is ${postal.sheetTotal}`);
    }
    for (const [candidate, votes] of rows) candidate.postalVotes = votes;
  }

  // Totals.
  let totalValidVotes = 0;
  for (const c of results) {
    c.totalVotes = add(c.boothVotes, c.postalVotes, `${label}: total of candidate ${c.id}`);
    totalValidVotes = add(totalValidVotes, c.totalVotes, `${label}: total valid votes`);
  }

  // Ranking of real candidates: votes descending; among EQUAL votes the declared winner (lottery
  // result) comes first, the rest stay in ballot order (results are in ballot order and
  // Array.prototype.sort is stable). Competition ranking: 1 + number with MORE votes, so tied
  // rows keep the same rank whatever their order.
  const declaredWinnerId = declaration?.winnerCandidateId ?? null;
  const ranked: RankedRow[] = results
    .filter((c) => !c.isNota)
    .sort(
      (a, b) =>
        b.totalVotes - a.totalVotes ||
        Number(b.id === declaredWinnerId) - Number(a.id === declaredWinnerId),
    )
    .map((c, i, list) => {
      c.rank = 1 + list.filter((o) => o.totalVotes > c.totalVotes).length;
      return {
        candidateId: c.id,
        ballotPosition: c.ballotPosition,
        nameHindi: c.nameHindi,
        totalVotes: c.totalVotes,
        rank: c.rank,
        // In a descending list, a row shares its predecessor's votes exactly when its rank
        // is lower than its position.
        tiedWithPrevious: c.rank !== i + 1,
      };
    });
  const top3 = ranked.slice(0, 3);
  // Validation above guarantees at least one real candidate, so `ranked` is never empty:
  // the leader is its first row (highest votes; on equal votes the lower ballot position).
  const leader = ranked.reduce((first) => first);
  const runnerUp = ranked[1] ?? null;
  const topTied = runnerUp?.tiedWithPrevious === true;
  const computedMargin = runnerUp === null ? null : leader.totalVotes - runnerUp.totalVotes;

  const nota = results.find((c) => c.isNota);
  const notaVotes = nota?.totalVotes ?? 0;
  const notaHighest = nota !== undefined && ranked.every((r) => notaVotes > r.totalVotes);

  // Status.
  const postalEntered = postal !== null;
  const allEntered = entered.size === wardBooths.size && postalEntered;
  let status: ResultStatus;
  let winnerCandidateId: number | null = null;
  let declared: WardResult['declaration'] = null;
  let declarationMismatch = false;

  if (declaration !== null) {
    if (!Number.isSafeInteger(declaration.version) || declaration.version < 1) {
      fail(`${label}: declaration version must be a whole number 1 or more`);
    }
    checkCount(declaration.margin, `${label}: declared margin`);
    if (!real.some((c) => c.id === declaration.winnerCandidateId)) {
      fail(
        `${label}: declared winner ${declaration.winnerCandidateId} is not a real candidate of this ward`,
      );
    }
    status = declaration.status;
    winnerCandidateId = declaration.winnerCandidateId;
    declared = {
      version: declaration.version,
      status: declaration.status,
      winnerCandidateId: declaration.winnerCandidateId,
      margin: declaration.margin,
    };
    // The declared winner is always first among the top-voted rows. If it is not the leader, it no
    // longer has the most votes: the declaration does not match the counted votes (alarm).
    declarationMismatch =
      snapshotDiffers(declaration.snapshot, results) || leader.candidateId !== declaration.winnerCandidateId;
  } else if (ward.isUnopposed) {
    status = 'UNOPPOSED';
    winnerCandidateId = leader.candidateId;
  } else if (entered.size === 0 && !postalEntered) {
    status = 'NOT_STARTED';
  } else if (!allEntered) {
    status = 'COUNTING';
  } else {
    status = topTied ? 'TIE_NEEDS_LOTTERY' : 'READY_TO_DECLARE';
  }

  return {
    wardId: ward.id,
    kind: ward.kind,
    status,
    candidates: results,
    notaVotes,
    totalValidVotes,
    rejectedPostal: postal?.rejectedCount ?? null,
    boothsTotal: wardBooths.size,
    boothsEntered: entered.size,
    postalEntered,
    roundsSeen: [...rounds].sort((a, b) => a - b),
    top3,
    leader,
    runnerUp,
    margin: declared?.margin ?? computedMargin,
    topTied,
    notaHighest,
    winnerCandidateId,
    declaration: declared,
    declarationMismatch,
  };
}

/** The snapshot stored at declaration time (Part 6). Compared later by declarationMismatch. */
export function buildDeclarationSnapshot(result: WardResult): DeclarationSnapshot {
  return {
    candidates: result.candidates.map((c) => ({
      candidateId: c.id,
      boothVotes: c.boothVotes,
      postalVotes: c.postalVotes,
      totalVotes: c.totalVotes,
    })),
    totalValidVotes: result.totalValidVotes,
    rejectedPostal: result.rejectedPostal,
  };
}
