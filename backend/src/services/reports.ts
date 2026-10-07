// DM reports (Part 10): PURE builders from one consistent read. Nothing here adds votes: every vote
// number comes from result.ts (WardResult). Seats/progress reuse public-views so they match the TV
// screens exactly.
import { INDEPENDENT_HINDI, istIso, partySeats, wardCard } from './public-views.js';
import type { CandidateRef, PartyRef, PublicStatus, SeatRow, WardMeta } from './public-views.js';
import type { WardResult } from './result.js';

// ---------------------------------------------------------------- input

export interface ReportRaw {
  wards: {
    id: number;
    kind: 'PS' | 'ZP';
    wardNo: number;
    panchayatSamitiId: number | null;
    reservationCategory: string | null;
    isUnopposed: boolean;
  }[];
  ps: { id: number; name: string }[];
  parties: { id: number; shortName: string; nameHindi: string }[];
  candidates: {
    id: number;
    wardId: number;
    name: string;
    partyId: number | null;
    gender: 'M' | 'F' | 'O' | null;
    isNota: boolean;
  }[];
  booths: {
    id: number;
    psWardId: number | null;
    zpWardId: number | null;
    registeredVoters: number | null;
  }[];
  /** Every declaration version, by ward then version. */
  declarations: {
    wardId: number;
    version: number;
    status: 'DECLARED' | 'TIE_RESOLVED';
    winnerCandidateId: number;
    margin: number;
    lottery: { conductedBy: string; note: string } | null;
    notaHighestAck: boolean;
    correctionReason: string | null;
    declaredAt: Date;
    declaredBy: string;
  }[];
  /** Latest CONFIG_VOTER_CHECK_DISABLED audit row (startup warning), if any. */
  voterCheckDisabledAt: Date | null;
  /** Wards with candidates: the engine result, or UNAVAILABLE when its data broke a rule. */
  results: ReadonlyMap<number, WardResult | 'UNAVAILABLE'>;
}

// ---------------------------------------------------------------- output

export type ScopeKey = string; // 'ALL_PS' | 'ZP' | `PS:${id}`

export interface ReportWardRef {
  id: number;
  kind: 'PS' | 'ZP';
  wardNo: number;
  psName: string | null;
  label: string;
}

export interface PartyLabel {
  shortName: string | null;
  nameHindi: string;
}

export type AlarmKind =
  'DECLARATION_MISMATCH' | 'UNAVAILABLE' | 'VOTER_CHECK_DISABLED' | 'NOTA_HIGHEST_DECLARED';

export interface Alarm {
  kind: AlarmKind;
  ward: ReportWardRef | null;
  scope: ScopeKey | null;
  detail: string;
  at: string | null;
}

export interface WinnerRow {
  ward: ReportWardRef;
  name: string;
  party: PartyLabel;
  status: 'DECLARED' | 'TIE_RESOLVED' | 'UNOPPOSED';
}

export interface ScopeSections {
  progress: {
    wardsTotal: number;
    declared: number;
    unopposed: number;
    counting: number;
    notStarted: number;
    noCandidates: number;
    unavailable: number;
    boothsEntered: number;
    boothsTotal: number;
    postalEntered: number;
    postalTotal: number;
  };
  partySeats: SeatRow[];
  women: { total: number; byParty: { party: PartyLabel; count: number }[]; list: WinnerRow[] };
  reservation: { category: string; wards: number; decided: number; womenWinners: number }[] | null;
  nota: {
    notaVotes: number;
    totalValidVotes: number;
    highest: {
      ward: ReportWardRef;
      notaVotes: number;
      topCandidateVotes: number;
      status: PublicStatus;
    }[];
  };
  close: {
    ward: ReportWardRef;
    winner: string;
    runnerUp: string | null;
    margin: number;
    marginPercent: number;
    totalValidVotes: number;
  }[];
  lottery: {
    ward: ReportWardRef;
    winner: string;
    tiedVotes: number;
    conductedBy: string;
    note: string;
    declaredAt: string;
    declaredBy: string;
  }[];
  corrections: {
    ward: ReportWardRef;
    version: number;
    oldWinner: string;
    newWinner: string;
    reason: string;
    declaredBy: string;
    declaredAt: string;
  }[];
  turnout: {
    validVotes: number;
    registeredVoters: number;
    percent: number | null;
    wardsIncluded: number;
    wardsTotal: number;
  };
}

export interface ReportSummary {
  generatedAt: string;
  scopes: { key: ScopeKey; label: string }[];
  alarms: Alarm[];
  sections: Record<ScopeKey, ScopeSections>;
}

/** Close contest: margin <= 100 votes or <= 1% of the valid votes (NOTA included). */
export const CLOSE_MARGIN_VOTES = 100;
export function isCloseContest(margin: number, totalValidVotes: number): boolean {
  return margin <= CLOSE_MARGIN_VOTES || margin * 100 <= totalValidVotes; // integers only
}

const WINNER_STATUSES = new Set<PublicStatus>(['DECLARED', 'TIE_RESOLVED', 'UNOPPOSED']);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

interface WardInfo {
  meta: WardMeta;
  ref: ReportWardRef;
  scope: ScopeKey;
  reservation: string | null;
  result: WardResult | null;
  status: PublicStatus;
  registered: (number | null)[];
}

/** Builds every section for every scope (each PS, all PS together, ZP) plus the district alarms. */
export function buildReport(
  raw: ReportRaw,
  opts: { voterCheckOff: boolean; now: Date },
): ReportSummary {
  const psName = new Map(raw.ps.map((p) => [p.id, p.name]));
  const parties = new Map<number, PartyRef>(
    raw.parties.map((p) => [p.id, { shortName: p.shortName, nameHindi: p.nameHindi }]),
  );
  const candidates = new Map(raw.candidates.map((c) => [c.id, c]));
  const candidateRefs = new Map<number, CandidateRef>(
    raw.candidates.map((c) => [c.id, { name: c.name, partyId: c.partyId }]),
  );
  const partyOf = (partyId: number | null): PartyLabel => {
    const p = partyId === null ? undefined : parties.get(partyId);
    return p === undefined ? { shortName: null, nameHindi: INDEPENDENT_HINDI } : { ...p };
  };
  const nameOf = (candidateId: number | null) =>
    candidateId === null ? '' : (candidates.get(candidateId)?.name ?? '');
  const declarationsByWard = new Map<number, ReportRaw['declarations']>();
  for (const d of raw.declarations)
    declarationsByWard.set(d.wardId, [...(declarationsByWard.get(d.wardId) ?? []), d]);

  const wards: WardInfo[] = raw.wards.map((w) => {
    const ps = w.panchayatSamitiId === null ? null : (psName.get(w.panchayatSamitiId) ?? null);
    const ref: ReportWardRef = {
      id: w.id,
      kind: w.kind,
      wardNo: w.wardNo,
      psName: w.kind === 'PS' ? ps : null,
      label:
        w.kind === 'ZP' ? `ज़िला परिषद · वार्ड ${w.wardNo}` : `${ps ?? ''} · वार्ड ${w.wardNo}`,
    };
    const r = raw.results.get(w.id);
    const result = r === undefined || r === 'UNAVAILABLE' ? null : r;
    const status: PublicStatus =
      r === undefined ? 'NO_CANDIDATES' : r === 'UNAVAILABLE' ? 'UNAVAILABLE' : r.status;
    const registered = raw.booths
      .filter((b) => (w.kind === 'PS' ? b.psWardId : b.zpWardId) === w.id)
      .map((b) => b.registeredVoters);
    return {
      meta: {
        id: w.id,
        kind: w.kind,
        wardNo: w.wardNo,
        panchayatSamitiId: w.panchayatSamitiId,
        reservationCategory: w.reservationCategory,
        isUnopposed: w.isUnopposed,
        boothCount: registered.length,
      },
      ref,
      scope: w.kind === 'ZP' ? 'ZP' : `PS:${String(w.panchayatSamitiId)}`,
      reservation: w.reservationCategory,
      result,
      status,
      registered,
    };
  });

  const winnerOf = (w: WardInfo): WinnerRow | null => {
    if (w.result === null || !WINNER_STATUSES.has(w.status) || w.result.winnerCandidateId === null)
      return null;
    const c = candidates.get(w.result.winnerCandidateId);
    return {
      ward: w.ref,
      name: c?.name ?? '',
      party: partyOf(c?.partyId ?? null),
      status: w.status as WinnerRow['status'],
    };
  };
  const isWoman = (row: WinnerRow, w: WardInfo) =>
    w.result !== null &&
    candidates.get(w.result.winnerCandidateId ?? 0)?.gender === 'F' &&
    row.name !== '';

  const sectionsFor = (list: WardInfo[]): ScopeSections => {
    const count = (s: PublicStatus[]) => list.filter((w) => s.includes(w.status)).length;
    const counted = list.filter((w) => w.result !== null && !w.meta.isUnopposed);
    const progress = {
      wardsTotal: list.length,
      declared: count(['DECLARED', 'TIE_RESOLVED']),
      unopposed: count(['UNOPPOSED']),
      counting: count(['COUNTING', 'READY_TO_DECLARE', 'TIE_NEEDS_LOTTERY']),
      notStarted: count(['NOT_STARTED']),
      noCandidates: count(['NO_CANDIDATES']),
      unavailable: count(['UNAVAILABLE']),
      boothsEntered: list.reduce((s, w) => s + (w.result?.boothsEntered ?? 0), 0),
      boothsTotal: list.reduce((s, w) => s + (w.result?.boothsTotal ?? w.meta.boothCount), 0),
      postalEntered: counted.filter((w) => w.result?.postalEntered === true).length,
      postalTotal: list.filter((w) => !w.meta.isUnopposed).length,
    };

    const cards = list.map((w) => wardCard(w.meta, w.result, w.status, candidateRefs, parties));

    const women = list.flatMap((w) => {
      const row = winnerOf(w);
      return row !== null && isWoman(row, w) ? [row] : [];
    });
    const byParty = new Map<string, { party: PartyLabel; count: number }>();
    for (const row of women) {
      const key = row.party.shortName ?? '\u0000';
      byParty.set(key, { party: row.party, count: (byParty.get(key)?.count ?? 0) + 1 });
    }

    const withCategory = list.filter((w) => w.reservation !== null && w.reservation !== '');
    const categories = [...new Set(withCategory.map((w) => w.reservation ?? ''))].sort((a, b) =>
      a.localeCompare(b, 'hi'),
    );

    const nota = {
      notaVotes: list.reduce((s, w) => s + (w.result?.notaVotes ?? 0), 0),
      totalValidVotes: list.reduce((s, w) => s + (w.result?.totalValidVotes ?? 0), 0),
      highest: list.flatMap((w) =>
        w.result?.notaHighest === true
          ? [
              {
                ward: w.ref,
                notaVotes: w.result.notaVotes,
                topCandidateVotes: Math.max(
                  0,
                  ...w.result.candidates.filter((c) => !c.isNota).map((c) => c.totalVotes),
                ),
                status: w.status,
              },
            ]
          : [],
      ),
    };

    const close = list
      .flatMap((w) => {
        const r = w.result;
        if (
          r === null ||
          w.status !== 'DECLARED' ||
          r.margin === null ||
          !isCloseContest(r.margin, r.totalValidVotes)
        )
          return [];
        return [
          {
            ward: w.ref,
            winner: nameOf(r.winnerCandidateId),
            runnerUp: r.runnerUp?.nameHindi ?? null,
            margin: r.margin,
            marginPercent:
              r.totalValidVotes === 0 ? 0 : oneDecimal((r.margin * 100) / r.totalValidVotes),
            totalValidVotes: r.totalValidVotes,
          },
        ];
      })
      .sort((a, b) => a.margin - b.margin || a.ward.label.localeCompare(b.ward.label, 'hi'));

    const lottery = list.flatMap((w) => {
      const versions = declarationsByWard.get(w.ref.id) ?? [];
      const latest = versions[versions.length - 1];
      if (w.result === null || w.status !== 'TIE_RESOLVED' || latest?.status !== 'TIE_RESOLVED')
        return [];
      return [
        {
          ward: w.ref,
          winner: nameOf(latest.winnerCandidateId),
          tiedVotes: w.result.leader?.totalVotes ?? 0,
          conductedBy: latest.lottery?.conductedBy ?? '',
          note: latest.lottery?.note ?? '',
          declaredAt: istIso(latest.declaredAt),
          declaredBy: latest.declaredBy,
        },
      ];
    });

    const corrections = list.flatMap((w) => {
      const versions = declarationsByWard.get(w.ref.id) ?? [];
      return versions
        .filter((d) => d.version > 1)
        .map((d) => {
          const prev = versions.find((p) => p.version === d.version - 1);
          return {
            ward: w.ref,
            version: d.version,
            oldWinner: nameOf(prev?.winnerCandidateId ?? null),
            newWinner: nameOf(d.winnerCandidateId),
            reason: d.correctionReason ?? '',
            declaredBy: d.declaredBy,
            declaredAt: istIso(d.declaredAt),
          };
        });
    });

    // Turnout: fully counted, not unopposed, every booth has a registered-voter count.
    const turnoutWards = list.filter(
      (w) =>
        w.result !== null &&
        !w.meta.isUnopposed &&
        w.result.boothsTotal > 0 &&
        w.result.boothsEntered === w.result.boothsTotal &&
        w.result.postalEntered &&
        w.registered.length > 0 &&
        w.registered.every((r) => r !== null),
    );
    const validVotes = turnoutWards.reduce((s, w) => s + (w.result?.totalValidVotes ?? 0), 0);
    const registeredVoters = turnoutWards.reduce(
      (s, w) => s + w.registered.reduce<number>((t, r) => t + (r ?? 0), 0),
      0,
    );

    return {
      progress,
      partySeats: partySeats(cards),
      women: {
        total: women.length,
        byParty: [...byParty.values()].sort(
          (a, b) => b.count - a.count || a.party.nameHindi.localeCompare(b.party.nameHindi, 'hi'),
        ),
        list: women,
      },
      reservation:
        categories.length === 0
          ? null
          : categories.map((category) => {
              const inCat = withCategory.filter((w) => w.reservation === category);
              const winners = inCat.flatMap((w) => {
                const row = winnerOf(w);
                return row === null ? [] : [{ row, w }];
              });
              return {
                category,
                wards: inCat.length,
                decided: winners.length,
                womenWinners: winners.filter(({ row, w }) => isWoman(row, w)).length,
              };
            }),
      nota,
      close,
      lottery,
      corrections,
      turnout: {
        validVotes,
        registeredVoters,
        percent: registeredVoters === 0 ? null : oneDecimal((validVotes * 100) / registeredVoters),
        wardsIncluded: turnoutWards.length,
        wardsTotal: list.filter((w) => !w.meta.isUnopposed).length,
      },
    };
  };

  const psWards = wards.filter((w) => w.ref.kind === 'PS');
  const scopes: { key: ScopeKey; label: string; wards: WardInfo[] }[] = [
    { key: 'ALL_PS', label: 'सभी पंचायत समितियाँ', wards: psWards },
    ...raw.ps.map((p) => ({
      key: `PS:${String(p.id)}`,
      label: p.name,
      wards: psWards.filter((w) => w.meta.panchayatSamitiId === p.id),
    })),
    { key: 'ZP', label: 'ज़िला परिषद', wards: wards.filter((w) => w.ref.kind === 'ZP') },
  ];

  const alarms: Alarm[] = [];
  if (opts.voterCheckOff && raw.voterCheckDisabledAt !== null) {
    alarms.push({
      kind: 'VOTER_CHECK_DISABLED',
      ward: null,
      scope: null,
      detail: 'पंजीकृत मतदाता संख्या की जाँच बंद है (REQUIRE_VOTER_COUNTS=false)',
      at: istIso(raw.voterCheckDisabledAt),
    });
  }
  for (const w of wards) {
    if (w.status === 'UNAVAILABLE') {
      alarms.push({
        kind: 'UNAVAILABLE',
        ward: w.ref,
        scope: w.scope,
        detail: 'परिणाम की गणना नहीं हो सकी — इस वार्ड का डेटा जाँचें',
        at: null,
      });
    }
    if (w.result?.declarationMismatch === true) {
      alarms.push({
        kind: 'DECLARATION_MISMATCH',
        ward: w.ref,
        scope: w.scope,
        detail: 'घोषणा के बाद मत बदले हैं — घोषित परिणाम और वर्तमान मत मेल नहीं खाते',
        at: null,
      });
    }
    if (
      w.result?.notaHighest === true &&
      (w.status === 'DECLARED' || w.status === 'TIE_RESOLVED')
    ) {
      alarms.push({
        kind: 'NOTA_HIGHEST_DECLARED',
        ward: w.ref,
        scope: w.scope,
        detail: 'नोटा को सबसे अधिक मत मिले, फिर भी वार्ड घोषित',
        at: null,
      });
    }
  }

  return {
    generatedAt: istIso(opts.now),
    scopes: scopes.map(({ key, label }) => ({ key, label })),
    alarms,
    sections: Object.fromEntries(scopes.map((s) => [s.key, sectionsFor(s.wards)])),
  };
}
