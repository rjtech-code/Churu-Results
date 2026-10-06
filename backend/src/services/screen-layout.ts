// Which Panchayat Samitis appear on media-room screens 1 and 2 (screen 3 is always Zila Parishad).
// Stored as JSON in app_settings.screen_layout. Pure helpers, shared by the API and the scripts.

export const SCREEN_LAYOUT_KEY = 'screen_layout';

export type ScreenLayout = Record<'1' | '2', string[]>;

export const DEFAULT_SCREEN_LAYOUT: ScreenLayout = {
  '1': [
    'CHURU PANCHAYAT SAMITI',
    'CHURU NORTH HQ CHURU PANCHAYAT SAMITI',
    'SARDARSHAHAR PANCHAYAT SAMITI',
    'SARDARSHAHAR EAST PANCHAYAT SAMITI',
    'TARANAGAR EAST PANCHAYAT SAMITI',
    'TARANAGAR WEST(BHALERI) HQ TARANAGAR PANCHAYAT SAMITI',
    'RATANGARH PANCHAYAT SAMITI',
  ],
  '2': [
    'SUJANGARH PANCHAYAT SAMITI',
    'BIDASAR PANCHAYAT SAMITI',
    'BHANIPURA PANCHAYAT SAMITI',
    'RAJGARH PANCHAYAT SAMITI',
    'CHANDGOTHI HQ RAJGARH PANCHAYAT SAMITI',
    'SIDDHMUKH PANCHAYAT SAMITI',
  ],
};

function key(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleUpperCase('en-US');
}

/**
 * Checks a layout against the Panchayat Samitis in the database: only screens "1" and "2", every
 * PS exactly once across both, no unknown names. Returns the problems (empty = valid) and the
 * layout with names spelled exactly as stored.
 */
export function validateScreenLayout(
  raw: unknown,
  psNames: readonly string[],
): { problems: string[]; layout: ScreenLayout | null } {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      problems: ['The layout must be a JSON object like {"1": [...], "2": [...]}.'],
      layout: null,
    };
  }
  const obj = raw as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => k !== '1' && k !== '2');
  if (extra.length > 0) {
    problems.push(
      `Only screens "1" and "2" can be set (screen 3 is always Zila Parishad); unexpected: ${extra.join(', ')}.`,
    );
  }
  const byKey = new Map(psNames.map((n) => [key(n), n]));
  const seen = new Map<string, string>();
  const layout: ScreenLayout = { '1': [], '2': [] };
  for (const screen of ['1', '2'] as const) {
    const list = obj[screen];
    if (!Array.isArray(list)) {
      problems.push(`Screen ${screen} must be a list of Panchayat Samiti names.`);
      continue;
    }
    for (const item of list as unknown[]) {
      if (typeof item !== 'string') {
        problems.push(`Screen ${screen}: every entry must be a name (text).`);
        continue;
      }
      const stored = byKey.get(key(item));
      if (stored === undefined) {
        problems.push(`Screen ${screen}: unknown Panchayat Samiti "${item}".`);
        continue;
      }
      const earlier = seen.get(stored);
      if (earlier !== undefined) {
        problems.push(
          `"${stored}" appears more than once (screen ${earlier} and screen ${screen}).`,
        );
        continue;
      }
      seen.set(stored, screen);
      layout[screen].push(stored);
    }
  }
  for (const name of psNames) {
    if (!seen.has(name))
      problems.push(`"${name}" is missing: every Panchayat Samiti must be on screen 1 or 2.`);
  }
  return { problems, layout: problems.length === 0 ? layout : null };
}
