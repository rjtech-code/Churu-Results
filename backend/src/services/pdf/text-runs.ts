// Splits text into runs of one script, so each run is drawn with a font that has its glyphs: the
// bundled Noto Sans Devanagari has no Latin letters, and the PDF's built-in Latin fonts have no
// Devanagari. Pure.

export type Script = 'deva' | 'latin';

export interface TextRun {
  script: Script;
  text: string;
}

// Devanagari, Devanagari Extended, Vedic Extensions, ZWNJ/ZWJ (they shape conjuncts) and the dotted
// circle the font uses for a lone matra.
const DEVA = /[ऀ-ॿ꣠-ꣿ᳐-᳿‌‍◌]/u;
const NEUTRAL = /\s/u;

function scriptOf(ch: string): Script | null {
  if (NEUTRAL.test(ch)) return null;
  return DEVA.test(ch) ? 'deva' : 'latin';
}

/**
 * Runs in text order. Whitespace joins the run it is in (or the next one at the start), so words keep
 * their spaces; any other non-Devanagari character (digits, punctuation, Latin) is a Latin run.
 */
export function splitRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let pending = '';
  for (const ch of text) {
    const script = scriptOf(ch);
    const last = runs.at(-1);
    if (script === null) {
      if (last === undefined) pending += ch;
      else last.text += ch;
    } else if (last?.script === script) {
      last.text += ch;
    } else {
      runs.push({ script, text: pending + ch });
      pending = '';
    }
  }
  if (pending !== '') runs.push({ script: 'latin', text: pending });
  return runs;
}
