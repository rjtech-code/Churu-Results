// FormSource -> Prarup-7 cells. Pure. Votes and the winner come from the result engine; candidate
// details come as saved. A value the system does not have is null (printed blank), never guessed:
// no category from the seat's reservation, no "O" in the F/M column, column (च) always blank.
import { candidateAge } from '../master-data/candidate-age.js';
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
    heldPanchSarpanch: null,
  };
}

function candidateRow(
  src: FormSource,
  c: FormCandidate,
  t: Prarup7Template,
  contested: boolean,
): Prarup7Row {
  const label = candidateLabel(c, t);
  return {
    uncontested: contested ? null : label,
    contested: contested ? label : null,
    particulars: particulars(c, t),
    votes: contested ? String(votesOf(src.result, c.id)) : null,
  };
}

/** The NOTA row: its number after the candidates, dashes in (क)-(ङ) as printed. */
function notaRow(src: FormSource, t: Prarup7Template): Prarup7Row {
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
    votes: String(src.result.notaVotes),
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

export function mapPrarup7(src: FormSource, t: Prarup7Template): Prarup7Data {
  const contested = src.result.status !== 'UNOPPOSED';
  const rows = src.candidates.map((c) => candidateRow(src, c, t, contested));
  const rejected = src.result.rejectedPostal;
  return {
    header: {
      bodyName: src.body.name,
      wardCount: String(src.body.wardCount),
      panchayatSamitis: blankIfEmpty(src.panchayatSamitis.join(t.formats.listSeparator)),
      district: src.district,
      electionDate: src.electionDate === null ? null : t.formats.date(src.electionDate),
    },
    signaturePlace: t.signaturePlace === 'district' ? src.district : null,
    wardNo: String(src.ward.wardNo),
    reservation: src.ward.reservation === null ? null : t.formats.bracketed(src.ward.reservation),
    contested,
    rows: contested ? [...rows, notaRow(src, t)] : rows,
    rejected: contested && rejected !== null ? String(rejected) : null,
    wardNoPadded: String(src.ward.wardNo).padStart(t.wardNoDigits, '0'),
    declaration: declaration(src, t),
  };
}
