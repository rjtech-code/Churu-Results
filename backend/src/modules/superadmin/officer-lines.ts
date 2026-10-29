// The import code reports problems in technical English (for the CLI). The Super Admin panel shows
// them as short, plain messages: simple Hindi sentences that keep the English terms officers use
// (Booth, Ward, Excel, Column, File). Every known pattern has a version here; anything else becomes a
// generic line and the original is logged on the server. Never shows SQL, table names or paths.

/** Which file a line is about (as the officer knows it). */
export type LineSource = 'geography' | 'voters' | 'psNames' | 'fixes' | 'dm';

const SOURCE_NAME: Readonly<Record<LineSource, string>> = {
  geography: 'Geography file',
  voters: 'Voters file',
  psNames: 'PS Hindi names file',
  fixes: 'Fixes file',
  dm: 'DM account',
};

export const GENERIC_LINE = 'एक problem मिली — screen की photo लेकर technical team को बताएँ';
const SERVER_ERROR_LINE = 'कुछ save नहीं हुआ (server error) — technical team को बताएँ';

type Rule = readonly [RegExp, (m: RegExpMatchArray) => string, LineSource?];

/** [pattern, Hindi text, optional file the line is really about]. Order matters (first match). */
const RULES: readonly Rule[] = [
  [/^"(.+)" is empty$/, (m) => `Column "${m[1] ?? ''}" खाली है`],
  [
    /^"(.+)" must be .+, got "(.*)"$/,
    (m) => `Column "${m[1] ?? ''}" में "${m[2] ?? ''}" गलत है — यहाँ number चाहिए`,
  ],
  [
    /^District must be Churu, got "(.*)"$/,
    (m) => `District "${m[1] ?? ''}" लिखा है — यहाँ Churu होना चाहिए`,
  ],
  [
    /^Booth (\d+) of (.+) has conflicting (.+?): (.+)\. Correct the source file/,
    (m) =>
      `Booth ${m[1] ?? ''} (${m[2] ?? ''}) की rows में अलग-अलग ${m[3] ?? ''}: ${m[4] ?? ''} — Excel ठीक करें या approved fix जोड़ें`,
  ],
  [
    /^(.+): found (\d+), expected (\d+)\./,
    (m) => `${m[1] ?? ''}: file में ${m[2] ?? ''}, official count ${m[3] ?? ''} — file check करें`,
  ],
  [
    /^No Hindi name for "(.+)";/,
    (m) => `"${m[1] ?? ''}" का Hindi name नहीं है — English name दिखेगा`,
    'psNames',
  ],
  [
    /^PS names file: "(.+)" is not a Panchayat Samiti in the data file\.$/,
    (m) => `"${m[1] ?? ''}" Geography file में नहीं है`,
    'psNames',
  ],
  [
    /^PS names file: Hindi name "(.+)" is used for (.+)\.$/,
    (m) =>
      `Hindi name "${m[1] ?? ''}" एक से ज़्यादा PS को दिया है (${(m[2] ?? '').replace(/ and /g, ', ')})`,
    'psNames',
  ],
  [/^PS names file/, () => 'File का format सही नहीं — sample file देखें', 'psNames'],
  [
    /^Fixes file entry #(\d+): booth (\d+) of "(.+)" is not in the data file\.$/,
    (m) => `Entry ${m[1] ?? ''}: Booth ${m[2] ?? ''} ("${m[3] ?? ''}") Geography file में नहीं है`,
    'fixes',
  ],
  [
    /^Fixes file entry #(\d+):/,
    (m) => `Entry ${m[1] ?? ''} अधूरी या गलत है — sample file देखें`,
    'fixes',
  ],
  [/^Fixes file/, () => 'File का format सही नहीं — sample file देखें', 'fixes'],
  [/^Cannot read (PS names file)/, () => 'File पढ़ी नहीं जा सकी — सही JSON file चुनें', 'psNames'],
  [
    /^Cannot read (fixes file|Fixes file)/i,
    () => 'File पढ़ी नहीं जा सकी — सही JSON file चुनें',
    'fixes',
  ],
  [/^Cannot read/, () => 'File पढ़ी नहीं जा सकी — सही Excel (.xlsx) file चुनें'],
  [
    /^No sheet has all required columns \((.+?)\)\./,
    (m) => `ज़रूरी columns नहीं मिले (${m[1] ?? ''}) — पहली row के नाम sample file से मिलाएँ`,
  ],
  [
    /^Sheet "(.+)" has the column\(s\) (.+) more than once\.$/,
    (m) => `Sheet "${m[1] ?? ''}" में column ${m[2] ?? ''} दो बार है`,
  ],
  [
    /^Unknown booth: (.+) has no booth (\d+)$/,
    (m) => `Booth ${m[2] ?? ''} (${m[1] ?? ''}) Geography file में नहीं है`,
  ],
  [
    /^Missing booth: booth (\d+) of (.+) is not in the file$/,
    (m) => `Booth ${m[1] ?? ''} (${m[2] ?? ''}) के voters इस file में नहीं हैं`,
  ],
  [/^The same booth appears more than once$/, () => 'एक ही Booth एक से ज़्यादा बार लिखा है'],
  [
    /^voters_total (\d+) does not equal male (\d+) \+ female (\d+) \+ other (\d+) = (\d+)$/,
    (m) =>
      `Total ${m[1] ?? ''} है, पर male ${m[2] ?? ''} + female ${m[3] ?? ''} + other ${m[4] ?? ''} = ${m[5] ?? ''} — दोनों बराबर होने चाहिए`,
  ],
  [
    /^The file has (\d+) booths .*expected exactly (\d+)$/,
    (m) => `File में ${m[1] ?? ''} booths हैं; ठीक ${m[2] ?? ''} होने चाहिए`,
  ],
  [
    /^Total_Elector grand total (\d+) is not the expected (\d+)$/,
    (m) => `Total voters ${m[1] ?? ''} हैं; official count ${m[2] ?? ''} है`,
  ],
  [
    /^Total_Elector grand total (\d+) does not equal SUM\((\w+)\.Voters\) (\d+)$/,
    (m) =>
      `Total voters ${m[1] ?? ''}, sheet ${m[2] ?? ''} के total ${m[3] ?? ''} से match नहीं करते`,
  ],
  [
    /^The file has no sheet "(.+)" to cross-check$/,
    (m) => `File में "${m[1] ?? ''}" sheet नहीं है (match के लिए ज़रूरी)`,
  ],
  [/^Unknown Panchayat Samiti "(.+)"$/, (m) => `Panchayat Samiti "${m[1] ?? ''}" नहीं मिली`],
  [
    /^Panchayat Samiti "(.+)" is in the database with user accounts but not in the file/,
    (m) =>
      `"${m[1] ?? ''}" के RO accounts हैं, पर यह PS नई file में नहीं है — इसे हटाया नहीं जा सकता`,
  ],
  [
    /^Booth (\d+) of (.+) already has counting entries/,
    (m) => `Booth ${m[1] ?? ''} (${m[2] ?? ''}) में counting शुरू हो चुकी है`,
  ],
  [/^That is not a valid email address\.$/, () => 'Email address सही नहीं है', 'dm'],
  [/^An email is required/, () => 'Email लिखें', 'dm'],
  [
    /^Another account already has this email\.$/,
    () => 'यह email किसी और account में पहले से है',
    'dm',
  ],
  [/^No active DM account\.$/, () => 'कोई active DM account नहीं है', 'dm'],
  [/^(Stopped; nothing was written\.|Unexpected server error|not saved)/, () => SERVER_ERROR_LINE],
];

/**
 * One technical report line ("[row 5] ..." / "[rows 3, 4] ...") as a plain line for the screen.
 * `source` says which upload it came from (some lines name their own file).
 */
export function officerLine(source: LineSource, english: string): string {
  const rowMatch = /^\[(rows?) ([\d, ]+)\] (.*)$/.exec(english);
  const rows = rowMatch ? `Row ${rowMatch[2] ?? ''}` : null;
  const text = rowMatch ? (rowMatch[3] ?? '') : english;
  for (const [pattern, plain, own] of RULES) {
    const m = pattern.exec(text);
    if (m) {
      const where = SOURCE_NAME[own ?? source];
      return `${where}${rows === null ? '' : ` · ${rows}`}: ${plain(m)}`;
    }
  }
  console.error(`[superadmin] untranslated ${source} line: ${english}`);
  return `${SOURCE_NAME[source]}${rows === null ? '' : ` · ${rows}`}: ${GENERIC_LINE}`;
}

export const officerLines = (source: LineSource, lines: readonly string[]) =>
  lines.map((l) => officerLine(source, l));
