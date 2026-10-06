// Party colours on the TV screens (screen 3). EDIT BEFORE COUNTING DAY: one entry per party short
// name exactly as imported (npm run import:parties). Colour is always shown next to the party name.
export const FIXED_PARTY_COLOURS: Readonly<Record<string, string>> = {
  BJP: '#e8740c', // saffron
  INC: '#1f6fd1', // blue
  BSP: '#1a237e', // dark blue
  RLP: '#7b8f00', // olive
  'CPI(M)': '#c62828', // red
  AAP: '#00838f', // teal
};

/** Independents (निर्दलीय, party null). */
export const INDEPENDENT_GREY = '#8c8c8c';

/** For parties not in the fixed map, in order of their sorted short names. */
export const PALETTE = [
  '#6a1b9a',
  '#2e7d32',
  '#ad1457',
  '#4e342e',
  '#283593',
  '#ef6c00',
  '#00695c',
  '#5d4037',
];

/**
 * A party's colour: the fixed map first; other parties get the palette by their position among
 * all unlisted short names (sorted), so the same data always gives the same colours.
 */
export function partyColour(shortName: string | null, allShortNames: readonly string[]): string {
  if (shortName === null) return INDEPENDENT_GREY;
  const fixed = FIXED_PARTY_COLOURS[shortName];
  if (fixed !== undefined) return fixed;
  const unlisted = [...new Set(allShortNames)].filter((s) => FIXED_PARTY_COLOURS[s] === undefined).sort();
  const i = unlisted.indexOf(shortName);
  return PALETTE[(i < 0 ? unlisted.length : i) % PALETTE.length] ?? INDEPENDENT_GREY;
}
