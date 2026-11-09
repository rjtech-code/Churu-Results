// Official order: which Panchayat Samiti's RO enters the postal ballots of each Zila Parishad ward.
// Pure data + checks, shared by the zp-postal:set-default script and its tests. PS are matched to the
// database by English name (as stored), never by id: ids change with every geography import.

export const ZP_WARD_COUNT = 39;
export const PS_COUNT = 13;

/** PS English name (exactly as in the geography file) -> the ZP ward numbers it enters postal for. */
export type ZpPostalMapping = Readonly<Record<string, readonly number[]>>;

export const DEFAULT_ZP_POSTAL_MAPPING: ZpPostalMapping = {
  'BHANIPURA PANCHAYAT SAMITI': [1, 2, 3],
  'SARDARSHAHAR PANCHAYAT SAMITI': [4, 5, 6],
  'SARDARSHAHAR EAST PANCHAYAT SAMITI': [7, 8],
  'RATANGARH PANCHAYAT SAMITI': [9, 10, 19, 20, 21],
  'BIDASAR PANCHAYAT SAMITI': [11, 12, 13, 14],
  'SUJANGARH PANCHAYAT SAMITI': [15, 16, 17, 18],
  'CHURU PANCHAYAT SAMITI': [22, 26],
  'CHURU NORTH HQ CHURU PANCHAYAT SAMITI': [23, 24, 25],
  'RAJGARH PANCHAYAT SAMITI': [27, 30, 31, 32],
  'CHANDGOTHI HQ RAJGARH PANCHAYAT SAMITI': [28, 29],
  'SIDDHMUKH PANCHAYAT SAMITI': [33, 34],
  'TARANAGAR EAST PANCHAYAT SAMITI': [35, 38],
  'TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI': [36, 37, 39],
};

/** Same matching rule as the screen layout: NFC, single spaces, upper case. */
export function psKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleUpperCase('en-US');
}

/**
 * The mapping on its own: exactly PS_COUNT different PS, every ZP ward 1..ZP_WARD_COUNT exactly once.
 * Returns the problems (empty = valid) and ward no -> PS name.
 */
export function checkZpPostalMapping(mapping: ZpPostalMapping): {
  problems: string[];
  byWard: Map<number, string>;
} {
  const problems: string[] = [];
  const byWard = new Map<number, string>();
  const names = Object.keys(mapping);
  if (names.length !== PS_COUNT)
    problems.push(
      `The mapping must name ${String(PS_COUNT)} Panchayat Samitis, not ${String(names.length)}.`,
    );
  const keys = new Set<string>();
  for (const name of names) {
    if (keys.has(psKey(name))) problems.push(`Panchayat Samiti "${name}" is listed twice.`);
    keys.add(psKey(name));
    for (const no of mapping[name] ?? []) {
      if (!Number.isInteger(no) || no < 1 || no > ZP_WARD_COUNT) {
        problems.push(
          `"${name}": ZP ward ${String(no)} does not exist (1-${String(ZP_WARD_COUNT)}).`,
        );
        continue;
      }
      const other = byWard.get(no);
      if (other !== undefined)
        problems.push(`ZP ward ${String(no)} is assigned twice: "${other}" and "${name}".`);
      else byWard.set(no, name);
    }
  }
  for (let no = 1; no <= ZP_WARD_COUNT; no++) {
    if (!byWard.has(no))
      problems.push(`ZP ward ${String(no)} is not assigned to any Panchayat Samiti.`);
  }
  return { problems, byWard };
}
