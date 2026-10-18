// FormSource -> Part-II table. Pure. Every number is the result engine's (WardResult); nothing is
// added up here.
import type { FormSource, Part2Data } from './form-data.js';
import type { Part2Template } from './templates/types.js';
import { votesOf } from './votes.js';

export function mapPart2(src: FormSource, t: Part2Template): Part2Data {
  return {
    rows: src.candidates.map((c) => ({
      serial: t.serial(c.position),
      name: c.nameHindi,
      votes: String(votesOf(src.result, c.id)),
    })),
    nota: String(src.result.notaVotes),
    total: String(src.result.totalValidVotes),
  };
}
