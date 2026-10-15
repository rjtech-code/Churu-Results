// "कुल उम्मीदवार सूची": one flat row per real candidate (PS and ZP), for CSV and Excel. Read only.
// Votes and the declared winner come from the result engine (readReportData -> computeWardResult);
// nothing is added up here. NOTA is not listed (it only counts inside the ward's valid votes).
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Cell } from './csv.js';
import { readReportData } from './reports.data.js';

export const CANDIDATE_LIST_HEADERS = [
  'क्र.सं.',
  'चुनाव (पंचायत समिति / जिला परिषद)',
  'पंचायत समिति',
  'वार्ड नंबर',
  'क्रम',
  'उम्मीदवार का नाम',
  'पार्टी',
  'चुनाव चिन्ह',
  'लिंग',
  'आरक्षण श्रेणी',
  'मिले वोट',
  'डाक मतपत्र',
  'वार्ड के कुल वैध वोट',
  'परिणाम',
  'सूची की स्थिति',
] as const;

const GENDER: Record<string, string> = { M: 'पुरुष', F: 'महिला', O: 'अन्य' };
const ZP_LABEL = 'ज़िला परिषद'; // same text the other reports show in the PS column for ZP wards
const collator = new Intl.Collator('hi');

/** Locked wins; else the list marked ready; else still being prepared. */
function listStatus(isLocked: boolean, readyAt: unknown): string {
  if (isLocked) return 'लॉक';
  return readyAt === null || readyAt === undefined ? 'प्रक्रिया में' : 'तैयार';
}

export async function candidateListRows(pool: Pool): Promise<Cell[][]> {
  const raw = await readReportData(pool);
  const [wardState] = await pool.execute<RowDataPacket[]>(
    'SELECT id, is_locked, candidates_ready_at FROM ward',
  );
  const state = new Map(wardState.map((w) => [Number(w.id), w]));
  const [partyRows] = await pool.execute<RowDataPacket[]>('SELECT id, symbol FROM party');
  const symbol = new Map(partyRows.map((p) => [Number(p.id), String(p.symbol)]));
  const psName = new Map(raw.ps.map((p) => [p.id, p.name]));
  const partyName = new Map(raw.parties.map((p) => [p.id, p.nameHindi]));

  const rows: { sort: [number, string, number, number]; cells: Cell[] }[] = [];
  for (const w of raw.wards) {
    const result = raw.results.get(w.id);
    const isZp = w.kind === 'ZP';
    const ps = isZp ? ZP_LABEL : (psName.get(w.panchayatSamitiId ?? 0) ?? '');
    const st = state.get(w.id);
    const status = listStatus(Number(st?.is_locked) === 1, st?.candidates_ready_at);
    const declared = result === undefined || result === 'UNAVAILABLE' ? null : result.declaration;
    for (const c of raw.candidates) {
      if (c.wardId !== w.id || c.isNota) continue;
      // UNAVAILABLE: the engine refused this ward's data, so no vote number is shown at all.
      const engine =
        result === 'UNAVAILABLE' ? null : result?.candidates.find((x) => x.id === c.id);
      // मिले वोट = booth + postal, the same total the result screens show; postal also on its own.
      const votes = result === 'UNAVAILABLE' ? null : (engine?.totalVotes ?? 0);
      const postal = result === 'UNAVAILABLE' ? null : (engine?.postalVotes ?? 0);
      const wardTotal = result === 'UNAVAILABLE' ? null : (result?.totalValidVotes ?? 0);
      // Unopposed: the engine's own UNOPPOSED status names the only candidate as the winner.
      const unopposedWinner =
        result !== undefined &&
        result !== 'UNAVAILABLE' &&
        result.status === 'UNOPPOSED' &&
        result.winnerCandidateId === c.id;
      const outcome =
        declared !== null
          ? declared.winnerCandidateId === c.id
            ? 'विजयी'
            : 'पराजित'
          : unopposedWinner
            ? 'निर्विरोध विजयी'
            : 'घोषित नहीं';
      rows.push({
        sort: [isZp ? 1 : 0, ps, w.wardNo, engine?.ballotPosition ?? 0],
        cells: [
          0,
          isZp ? 'जिला परिषद' : 'पंचायत समिति',
          ps,
          w.wardNo,
          engine?.ballotPosition ?? 0,
          c.name,
          c.partyId === null ? 'निर्दलीय' : (partyName.get(c.partyId) ?? ''),
          c.partyId === null ? null : (symbol.get(c.partyId) ?? null),
          c.gender === null ? null : (GENDER[c.gender] ?? null),
          w.reservationCategory,
          votes,
          postal,
          wardTotal,
          outcome,
          status,
        ],
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.sort[0] - b.sort[0] ||
      collator.compare(a.sort[1], b.sort[1]) ||
      a.sort[2] - b.sort[2] ||
      a.sort[3] - b.sort[3],
  );
  return rows.map((r, i) => [i + 1, ...r.cells.slice(1)]);
}
