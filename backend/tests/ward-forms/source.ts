// Pure builders for the ward-form tests (no database): a FormSource whose result comes from the real
// engine (computeWardResult), declared with a matching snapshot unless asked otherwise.
import { NO_DETAILS } from '../../src/services/master-data/candidate-details.js';
import type { CandidateDetails } from '../../src/services/master-data/candidate-details.js';
import { buildDeclarationSnapshot, computeWardResult } from '../../src/services/result.js';
import type { WardResultInput } from '../../src/services/result.js';
import type { FormCandidate, FormSource } from '../../src/services/ward-forms/form-data.js';
import { PRARUP7_TEMPLATES } from '../../src/services/ward-forms/templates/registry.js';
import type { Prarup7Template } from '../../src/services/ward-forms/templates/types.js';

export const NOTA_VOTES = 7;
/** The bodies a fixture ward elects to: the district's Zila Parishad, or its own PS. */
export const ZP_BODY = { name: 'चूरू', wardCount: 39 };
export const PS_BODY = { name: 'सुजानगढ़', wardCount: 25 };
/** Candidate i (1-based) gets FIRST_VOTES - (i - 1) * STEP votes: candidate 1 wins. */
const FIRST_VOTES = 1000;
const STEP = 50;
export const votesFor = (position: number): number => FIRST_VOTES - (position - 1) * STEP;

export interface SourceOptions {
  candidates?: number;
  kind?: 'PS' | 'ZP';
  /** One candidate, no poll. */
  unopposed?: boolean;
  /** false: counted but not declared. */
  declared?: boolean;
  rejected?: number | null;
  reservation?: string | null;
  electionDate?: string | null;
  panchayatSamitis?: string[];
  /** Per candidate (by index): details and gender. */
  details?: readonly Partial<CandidateDetails>[];
  genders?: readonly FormCandidate['gender'][];
  parties?: readonly (string | null)[];
}

function engineInput(n: number, o: SourceOptions): WardResultInput {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const notaId = n + 1;
  const unopposed = o.unopposed === true;
  return {
    ward: { id: 1, kind: o.kind ?? 'ZP', isUnopposed: unopposed, boothIds: [1] },
    candidates: [
      ...ids.map((id) => ({
        id,
        ballotPosition: id,
        nameHindi: `उम्मीदवार ${String(id)}`,
        partyId: null,
        isNota: false,
      })),
      ...(unopposed
        ? []
        : [{ id: notaId, ballotPosition: notaId, nameHindi: 'नोटा', partyId: null, isNota: true }]),
    ],
    boothEntries: unopposed
      ? []
      : [
          {
            boothId: 1,
            roundNo: 1,
            sheetTotal: ids.reduce((s, id) => s + votesFor(id), NOTA_VOTES),
            votes: [
              ...ids.map((id) => ({ candidateId: id, votes: votesFor(id) })),
              { candidateId: notaId, votes: NOTA_VOTES },
            ],
          },
        ],
    postalEntry: unopposed
      ? null
      : {
          sheetTotal: 0,
          rejectedCount: o.rejected === undefined ? 2 : o.rejected,
          votes: [...ids, notaId].map((candidateId) => ({ candidateId, votes: 0 })),
        },
    latestDeclaration: null,
  };
}

function declaredResult(input: WardResultInput, declare: boolean) {
  const counted = computeWardResult(input);
  if (!declare || counted.leader === null || counted.status === 'UNOPPOSED') return counted;
  return computeWardResult({
    ...input,
    latestDeclaration: {
      version: 1,
      status: 'DECLARED',
      winnerCandidateId: counted.leader.candidateId,
      margin: counted.margin ?? 0,
      snapshot: buildDeclarationSnapshot(counted),
    },
  });
}

export function formSource(o: SourceOptions = {}): FormSource {
  const n = o.unopposed === true ? 1 : (o.candidates ?? 2);
  const input = engineInput(n, o);
  const candidates: FormCandidate[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    position: i + 1,
    nameHindi: `उम्मीदवार ${String(i + 1)}`,
    partyHindi: o.parties?.[i] ?? null,
    gender: o.genders?.[i] ?? 'F',
    details: { ...NO_DETAILS, ...o.details?.[i] },
  }));
  const kind = o.kind ?? 'ZP';
  return {
    ward: { id: 1, kind, wardNo: 5, reservation: o.reservation ?? null },
    district: 'चूरू',
    body: kind === 'ZP' ? ZP_BODY : PS_BODY,
    panchayatSamitis: kind === 'ZP' ? (o.panchayatSamitis ?? ['बीदासर', 'सुजानगढ़']) : [],
    electionDate: o.electionDate ?? null,
    candidates,
    result: declaredResult(input, o.declared !== false),
  };
}

/** Pages in a PDF (pdfkit writes each page object uncompressed as "/Type /Page"). */
export const pageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

/** The Prarup-7 template of a ward kind. */
export const prarup7For = (kind: 'PS' | 'ZP'): Prarup7Template => PRARUP7_TEMPLATES[kind];
