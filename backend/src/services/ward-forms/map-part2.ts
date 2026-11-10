// -> प्रारूप–14 भाग–II cells. Pure. Ward sheet: every number is the result engine's (WardResult).
// Booth sheet: every number is the booth's live entry as the RO saved it. Nothing is added up here.
import { boothLabel } from '../booth-no.js';
import type { Cell, FormSource, Part2Data } from './form-data.js';
import type { Part2Template } from './templates/types.js';
import { votesOf } from './votes.js';

/** What the header and footer of the form need (both sheets). */
export interface Part2Head {
  kind: 'PS' | 'ZP';
  bodyName: string;
  wardNo: number;
  district: string;
  electionDate: string | null;
}

/** One booth's live entry, in the ward's ballot order (NOTA separate). */
export interface BoothSheet {
  boothNo: number;
  boothSuffix: string;
  boothName: string;
  candidates: readonly { position: number; nameHindi: string; votes: number }[];
  notaVotes: number;
  /** The sheet total the RO typed (= candidates + NOTA, checked at entry). */
  sheetTotal: number;
}

function head(h: Part2Head, t: Part2Template, booth: Cell) {
  return {
    kind: h.kind,
    bodyName: h.bodyName,
    wardNo: String(h.wardNo).padStart(t.wardNoDigits, '0'),
    booth,
    date: h.electionDate === null ? null : t.date(h.electionDate),
    place: h.district,
  };
}

/** The ward sheet (votes of the whole ward, from the result engine). */
export function mapPart2(src: FormSource, t: Part2Template): Part2Data {
  return {
    ...head(
      {
        kind: src.ward.kind,
        bodyName: src.body.name,
        wardNo: src.ward.wardNo,
        district: src.district,
        electionDate: src.electionDate,
      },
      t,
      null,
    ),
    rows: src.candidates.map((c) => ({
      serial: String(c.position),
      name: c.nameHindi,
      votes: String(votesOf(src.result, c.id)),
    })),
    notaSerial: String(src.candidates.length + 1),
    nota: String(src.result.notaVotes),
    total: String(src.result.totalValidVotes),
  };
}

/** The booth sheet (one booth's live entry, numbers exactly as saved). */
export function mapBoothPart2(h: Part2Head, b: BoothSheet, t: Part2Template): Part2Data {
  return {
    ...head(h, t, `${boothLabel(b.boothNo, b.boothSuffix)} – ${b.boothName}`),
    rows: b.candidates.map((c) => ({
      serial: String(c.position),
      name: c.nameHindi,
      votes: String(c.votes),
    })),
    notaSerial: String(b.candidates.length + 1),
    nota: String(b.notaVotes),
    total: String(b.sheetTotal),
  };
}
