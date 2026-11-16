// सारणी-"क" (सदस्य जिला परिषद) and सारणी-"ख" (सदस्य पंचायत समिति): the two official summary tables
// of elected members. Pure logic — it takes the SAME ReportRaw the DM reports and the ST Formats are
// built from (readReportData), so a name, a party or a ward can never disagree with the reports.
//
// One row per ward in ward-number order, numbered from 1:
//   क्र.सं. | निर्वाचन क्षेत्र संख्याक | निर्वाचन क्षेत्र का वर्गीकरण | निर्वाचित सदस्य का नाम |
//   संबद्ध मान्यता प्राप्त राजनैतिक दल का नाम
//
// The elected member is the winner of the ward's LATEST declaration (ward_declarations keeps every
// version; the newest one is the result in force). A ward that is unopposed has an elected member
// without a declaration, and it is printed too — the table lists elected members, and the officer
// signs it. A ward that is not decided yet keeps its row with the number and the classification, so
// what is still pending is visible, with the two member columns empty.
import { parseReservation } from './st-format-common.js';
import { INDEPENDENT_HINDI } from './public-views.js';
import type { ReportRaw } from './reports.js';

/**
 * The classification column wants the short official forms the template lists:
 * अ.जा. / अ.ज.जा. / अ.पि.व. / महिला / सामान्य.
 *
 * `ward.reservation_category` holds the longer text of the candidate list; the values in Churu's own
 * list are "सामान्य", "सामान्य महिला", "अनुसूचित जाति", "अनुसूचित जाति महिला", "अन्य पिछड़ा वर्ग" and
 * "अन्य पिछड़ा वर्ग महिला". They are read by parseReservation() — the ONE parser the ST Formats
 * already use — which also understands SC / ST / OBC / GEN, "अ.जा.", "(महिला)", "(W)" and so on.
 * A general seat reserved for a woman is printed as plain महिला, as the template's own list of five
 * has महिला beside सामान्य; every other reserved seat for a woman adds महिला to its category.
 *
 * Anything that does not parse leaves the cell EMPTY and is reported back to the officer
 * (`unmappedCategories`) — it is never guessed at.
 */
const SHORT: Readonly<Record<'SC' | 'ST' | 'OBC' | 'GEN', string>> = {
  SC: 'अ.जा.',
  ST: 'अ.ज.जा.',
  OBC: 'अ.पि.व.',
  GEN: 'सामान्य',
};

export function classificationOf(reservation: string | null): string | null {
  const parsed = parseReservation(reservation);
  if (parsed === null) return null;
  if (parsed.category === 'GEN') return parsed.women ? 'महिला' : SHORT.GEN;
  return parsed.women ? `${SHORT[parsed.category]} महिला` : SHORT[parsed.category];
}

export interface SarniRow {
  /** क्र.सं. */
  serial: number;
  /** निर्वाचन क्षेत्र संख्याक */
  wardNo: number;
  /** निर्वाचन क्षेत्र का वर्गीकरण, or null when the stored text does not map (empty cell). */
  classification: string | null;
  /** निर्वाचित सदस्य का नाम — empty while the ward is not decided. */
  memberName: string;
  /** संबद्ध मान्यता प्राप्त राजनैतिक दल का नाम — empty while the ward is not decided. */
  partyName: string;
}

export interface Sarni {
  kind: 'ZP' | 'PS';
  /** The Panchayat Samiti this सारणी-"ख" is for (Hindi name), null for सारणी-"क". */
  psName: string | null;
  rows: SarniRow[];
  /** How many rows name an elected member (the rest are still pending). */
  decided: number;
  /** reservation_category values that did not map, for the officer to look at. */
  unmappedCategories: string[];
}

/** The ward's elected member: the winner of its newest declaration, or an unopposed winner. */
function winnerIdOf(raw: ReportRaw, wardId: number): number | null {
  const versions = raw.declarations.filter((d) => d.wardId === wardId);
  const latest = versions.reduce<(typeof versions)[number] | null>(
    (best, d) => (best === null || d.version > best.version ? d : best),
    null,
  );
  if (latest !== null) return latest.winnerCandidateId;
  // No declaration row: an unopposed ward still has an elected member (the result engine's winner).
  const result = raw.results.get(wardId);
  if (result === undefined || result === 'UNAVAILABLE' || result.status !== 'UNOPPOSED')
    return null;
  return result.winnerCandidateId;
}

/**
 * `scope` is 'ZP' for सारणी-"क" (every ZP ward of the district) or a Panchayat Samiti id for
 * सारणी-"ख" (every PS ward of that Panchayat Samiti).
 */
export function buildSarni(raw: ReportRaw, scope: 'ZP' | { psId: number }): Sarni {
  const isZp = scope === 'ZP';
  const psId = isZp ? null : scope.psId;
  const candidates = new Map(raw.candidates.map((c) => [c.id, c]));
  const parties = new Map(raw.parties.map((p) => [p.id, p]));
  const wards = raw.wards
    .filter((w) => (isZp ? w.kind === 'ZP' : w.kind === 'PS' && w.panchayatSamitiId === psId))
    .sort((a, b) => a.wardNo - b.wardNo);

  const unmapped = new Set<string>();
  let decided = 0;
  const rows = wards.map((w, i): SarniRow => {
    const classification = classificationOf(w.reservationCategory);
    if (classification === null && (w.reservationCategory ?? '').trim() !== '') {
      unmapped.add((w.reservationCategory ?? '').trim());
    }
    const winnerId = winnerIdOf(raw, w.id);
    const winner = winnerId === null ? undefined : candidates.get(winnerId);
    if (winner !== undefined) decided++;
    const party = winner?.partyId == null ? null : (parties.get(winner.partyId) ?? null);
    return {
      serial: i + 1,
      wardNo: w.wardNo,
      classification,
      memberName: winner?.name ?? '',
      // The full Hindi name of the party; an independent member is निर्दलीय (the portal's one word
      // for it, from public-views.ts).
      partyName: winner === undefined ? '' : (party?.nameHindi ?? INDEPENDENT_HINDI),
    };
  });

  return {
    kind: isZp ? 'ZP' : 'PS',
    psName: isZp ? null : (raw.ps.find((p) => p.id === psId)?.name ?? null),
    rows,
    decided,
    unmappedCategories: [...unmapped].sort((a, b) => a.localeCompare(b, 'hi')),
  };
}
