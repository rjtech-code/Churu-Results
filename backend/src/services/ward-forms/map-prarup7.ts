// FormSource -> Prarup-7 cells. Pure. Votes and the winner come from the result engine; candidate
// details come as saved. A value the system does not have is null (printed blank), never guessed:
// no category from the seat's reservation, no "O" in the F/M column, and column (च) blank unless
// "previously held the post of Panch/Sarpanch" was actually recorded for that candidate.
import { candidateAge } from '../master-data/candidate-age.js';
import { HELD_PANCH_SARPANCH_HI } from '../master-data/candidate-details.js';
import type {
  Cell,
  FormCandidate,
  FormSource,
  Particulars,
  Prarup7Data,
  Prarup7Declaration,
  Prarup7Row,
} from './form-data.js';
import { PLACEHOLDER } from './templates/prarup7.template.js';
import type { Prarup7Template } from './templates/types.js';
import { votesOf } from './votes.js';

const partyOf = (c: FormCandidate, t: Prarup7Template): string =>
  t.formats.bracketed(c.partyHindi ?? t.labels.independent);

/** "1. नाम" and "(पार्टी)" on two lines, as on the form. */
const candidateLabel = (c: FormCandidate, t: Prarup7Template): string =>
  [t.formats.numbered(c.position, c.nameHindi), partyOf(c, t)].join(t.formats.lineBreak);

function particulars(c: FormCandidate, t: Prarup7Template): Particulars {
  const d = c.details;
  const age = candidateAge(d);
  return {
    address: d.address,
    category: d.candidateCategory === null ? null : t.labels.category[d.candidateCategory],
    education: d.education === null ? null : t.labels.education[d.education],
    age: age === null ? null : String(age),
    occupation: d.occupation,
    // (च): हाँ / नहीं, and a BLANK cell when it was never recorded — never "नहीं" as a default.
    heldPanchSarpanch:
      d.heldPanchSarpanch === null ? null : HELD_PANCH_SARPANCH_HI[d.heldPanchSarpanch],
  };
}

/** `votes` is the counting result, or null on the blank form (the cell is left to be written in). */
function candidateRow(
  c: FormCandidate,
  t: Prarup7Template,
  contested: boolean,
  votes: Cell,
): Prarup7Row {
  const label = candidateLabel(c, t);
  return {
    uncontested: contested ? null : label,
    contested: contested ? label : null,
    particulars: particulars(c, t),
    votes,
  };
}

/** The NOTA row: its number after the candidates, dashes in (क)-(ङ) as printed. */
function notaRow(src: FormSource, t: Prarup7Template, votes: Cell): Prarup7Row {
  const none = t.text.none;
  return {
    uncontested: null,
    contested: [
      t.formats.numbered(src.candidates.length + 1, t.text.notaName),
      t.text.notaNote,
    ].join(t.formats.lineBreak),
    particulars: {
      address: none,
      category: none,
      education: none,
      age: none,
      occupation: none,
      heldPanchSarpanch: null,
    },
    votes,
  };
}

function declaration(src: FormSource, t: Prarup7Template): Prarup7Declaration {
  const winner = src.candidates.find((c) => c.id === src.result.winnerCandidateId);
  // Eligibility allows only declared / uncontested wards, which always have a winner.
  if (winner === undefined) throw new Error('Prarup-7: the ward has no winner');
  const g = winner.gender;
  const category = winner.details.candidateCategory;
  return {
    office: t.text.declarationOffice.replace(PLACEHOLDER.name, src.body.name),
    nameAndAddress: [winner.nameHindi, partyOf(winner, t), winner.details.address].filter(
      (line): line is string => line !== null,
    ),
    gender: g === 'M' || g === 'F' ? t.labels.gender[g] : null,
    category: category === null ? null : t.labels.declarationCategory[category],
  };
}

const blankIfEmpty = (s: string): Cell => (s === '' ? null : s);

/** The RO's name for the footer: trimmed; empty or missing = null (a blank line, never a username). */
function nameOrBlank(name: string | null | undefined): Cell {
  const v = name?.replace(/\s+/g, ' ').trim() ?? '';
  return v === '' ? null : v;
}

/**
 * Everything on the form that is NOT a counting result: the printed headings' values (the body, the
 * ward count, the Panchayat Samitis, the district, the election date), the ward number and its
 * reservation, स्थान / दिनांक and the Returning Officer's name. The filled form and the blank form
 * print these identically — they are known before a single vote is counted.
 */
function formFacts(
  src: FormSource,
  t: Prarup7Template,
  roName: string | null,
): Omit<Prarup7Data, 'contested' | 'rows' | 'rejected' | 'declaration' | 'lot'> {
  const date = src.electionDate === null ? null : t.formats.date(src.electionDate);
  return {
    header: {
      bodyName: src.body.name,
      wardCount: String(src.body.wardCount),
      panchayatSamitis: blankIfEmpty(src.panchayatSamitis.join(t.formats.listSeparator)),
      district: src.district,
      electionDate: date,
    },
    place: src.district,
    date,
    roName: nameOrBlank(roName),
    wardNo: String(src.ward.wardNo),
    reservation: src.ward.reservation === null ? null : t.formats.bracketed(src.ward.reservation),
    wardNoPadded: String(src.ward.wardNo).padStart(t.wardNoDigits, '0'),
  };
}

/**
 * Column 7 "नियम 51 के अधीन लॉट का यदि कोई हो, परिणाम": filled ONLY for a ward whose tie was
 * resolved by lot, from what the RO recorded with that declaration — who the lot fell to, who
 * conducted it, and their note. Every other ward leaves the column empty, as the form expects
 * ("यदि कोई हो"). Nothing here is recomputed: the winner is the declaration's winner.
 */
function lotResult(src: FormSource, t: Prarup7Template): string[] {
  if (src.lottery === null) return [];
  const winner = src.candidates.find((c) => c.id === src.result.winnerCandidateId);
  return [
    winner === undefined ? null : t.formats.labelled(t.text.lotWinner, winner.nameHindi),
    src.lottery.conductedBy === ''
      ? null
      : t.formats.labelled(t.text.lotConductedBy, src.lottery.conductedBy),
    src.lottery.note === '' ? null : src.lottery.note,
  ].filter((line): line is string => line !== null);
}

/**
 * `roName`: the downloading RO's own full name (users.full_name). The route passes null for a DM
 * download (that line stays blank, as before).
 */
export function mapPrarup7(
  src: FormSource,
  t: Prarup7Template,
  roName: string | null = null,
): Prarup7Data {
  const contested = src.result.status !== 'UNOPPOSED';
  const rows = src.candidates.map((c) =>
    candidateRow(c, t, contested, contested ? String(votesOf(src.result, c.id)) : null),
  );
  const rejected = src.result.rejectedPostal;
  return {
    ...formFacts(src, t, roName),
    contested,
    rows: contested ? [...rows, notaRow(src, t, String(src.result.notaVotes))] : rows,
    rejected: contested && rejected !== null ? String(rejected) : null,
    lot: lotResult(src, t),
    declaration: declaration(src, t),
  };
}

/**
 * The BLANK प्ररूप–7: the SAME sheet, printed before the result exists, for the officers to fill in
 * by hand. Everything fixed is printed — the headings and rule numbers, the ward and body details,
 * the candidates in ballot order with their particulars, the NOTA row, the declaration's own table
 * and the Returning Officer's block — and every cell that is a counting RESULT is left empty:
 * each candidate's votes, the NOTA votes, the rejected postal ballots, and the elected member's
 * name, address, gender and category in the declaration.
 *
 * It is always laid out as a contested ballot (names in column 3, a NOTA row): what the ward turns
 * out to be is a result, and this form is printed before there is one.
 */
export function mapBlankPrarup7(
  src: FormSource,
  t: Prarup7Template,
  roName: string | null = null,
): Prarup7Data {
  const rows = src.candidates.map((c) => candidateRow(c, t, true, null));
  return {
    ...formFacts(src, t, roName),
    contested: true,
    rows: [...rows, notaRow(src, t, null)],
    rejected: null,
    // The lot is a result too: the blank sheet leaves column 7 to the pen.
    lot: [],
    // The declaration's heading, its column heads and its numbers are the template's; only the
    // elected member's own cells are empty here.
    declaration: {
      office: t.text.declarationOffice.replace(PLACEHOLDER.name, src.body.name),
      nameAndAddress: [],
      gender: null,
      category: null,
    },
  };
}
