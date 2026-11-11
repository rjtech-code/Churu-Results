// The observer overview: status, headline KPIs (PS / ZP split), party position, latest
// declarations — and a complete, confident zero state before counting day (structure + countdown).
import { Link } from 'react-router-dom';
import type { KindKpis, ObserverOverview } from '../../api/observerTypes';
import { formatIst, formatNumber, useLang } from './i18n';
import type { DictKey } from './i18n';
import { Num, Panel, PhasePill, ProgressBar, SeatBars, Skeleton, StaleNote } from './parts';
import { useObserverPoll } from './useObserverPoll';

/** Counting starts 08:00 IST on counting day. */
function countdownTo(dateIso: string): { days: number; hours: number; minutes: number } | null {
  const target = new Date(`${dateIso}T08:00:00+05:30`).getTime();
  const left = target - Date.now();
  if (Number.isNaN(target) || left <= 0) return null;
  const minutes = Math.floor(left / 60_000);
  return {
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
  };
}

function KpiCard({
  label,
  note,
  ps,
  zp,
  value,
  total,
}: {
  label: string;
  note?: string;
  ps: { done: number; total: number };
  zp: { done: number; total: number };
  value: number;
  total: number;
}) {
  const { t } = useLang();
  return (
    <div className="obs-kpi">
      <p className="obs-kpi-label">{label}</p>
      <p className="obs-kpi-value">
        <Num value={value} countUp />
        <span className="obs-kpi-total"> / {formatNumber(total)}</span>
      </p>
      {note !== undefined && <p className="obs-kpi-note">{note}</p>}
      <div className="obs-kpi-split">
        <span>
          <span className="obs-kpi-kind">{t('psShort')}</span>
          {formatNumber(ps.done)} / {formatNumber(ps.total)}
        </span>
        <span>
          <span className="obs-kpi-kind">{t('zpShort')}</span>
          {formatNumber(zp.done)} / {formatNumber(zp.total)}
        </span>
      </div>
    </div>
  );
}

function ZeroState({ overview }: { overview: ObserverOverview }) {
  const { t } = useLang();
  const s = overview.structure;
  const left = countdownTo(overview.countingDate);
  // Before counting day the party panels and the feed would all read "nothing yet": the structure
  // of the election and the countdown are the real content, so they carry the page instead.
  const facts: [DictKey, number][] = [
    ['panchayatSamitis', s.panchayatSamitis],
    ['psWards', s.psWards],
    ['zpWards', s.zpWards],
    ['structureBooths', s.booths],
    ['structureCandidates', s.candidates],
    ['structureParties', s.parties],
  ];
  const sections: [string, DictKey, DictKey][] = [
    ['/observer/ps', 'panchayatSamitis', 'psBlurb'],
    ['/observer/zp', 'zilaParishad', 'zpBlurb'],
    ['/observer/winners', 'winners', 'winnersBlurb'],
    ['/observer/reports', 'reports', 'reportsBlurb'],
  ];
  return (
    <>
      <div className="obs-grid obs-grid-2">
        <Panel title={t('countdown')}>
          {left === null ? (
            <p className="obs-muted">{t('countingNotStarted')}</p>
          ) : (
            <div className="obs-countdown" role="timer">
              {(
                [
                  ['days', left.days],
                  ['hours', left.hours],
                  ['minutes', left.minutes],
                ] as [DictKey, number][]
              ).map(([key, value]) => (
                <span key={key} className="obs-countdown-cell">
                  <span className="obs-countdown-num">{formatNumber(value)}</span>
                  <span className="obs-countdown-unit">{t(key)}</span>
                </span>
              ))}
            </div>
          )}
          <p className="obs-venue">
            {t('countingDate')}: <strong>20 Nov 2026, 08:00 IST</strong>
            <br />
            {t('countingVenue')}
          </p>
        </Panel>
        <Panel title={t('structure')}>
          <dl className="obs-facts">
            {facts.map(([key, value]) => (
              <div key={key} className="obs-fact">
                <dt>{t(key)}</dt>
                <dd>
                  <Num value={value} countUp />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel title={t('whatYouWillSee')}>
        <div className="obs-sections">
          {sections.map(([to, title, blurb]) => (
            <Link key={to} to={to} className="obs-section">
              <span className="obs-section-name">{t(title)} →</span>
              <span className="obs-section-blurb">{t(blurb)}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}

function Feed({ overview }: { overview: ObserverOverview }) {
  const { lang, t } = useLang();
  if (overview.feed.length === 0) return <p className="obs-muted">{t('noDeclarationsYet')}</p>;
  return (
    <ol className="obs-feed obs-feed-scroll">
      {overview.feed.map((f) => (
        <li key={`${String(f.wardId)}-${String(f.version)}`}>
          <Link to={`/observer/wards/${String(f.wardId)}`} className="obs-feed-item">
            <span className="obs-feed-ward">
              <span className={`obs-kindtag obs-kindtag-${f.kind.toLowerCase()}`}>
                {f.kind === 'ZP' ? t('zpShort') : t('psShort')}
              </span>
              {t('ward')} {f.wardNo}
              {f.psName !== null && <span className="obs-muted"> · {f.psName}</span>}
            </span>
            <span className="obs-feed-winner">
              {f.winner.name}
              <span className="obs-muted">
                {' '}
                · {f.winner.party?.shortName ?? t('independent')} · {t('margin')} {formatNumber(f.margin)}
              </span>
            </span>
            <span className="obs-feed-meta">
              {f.isCorrection && <span className="obs-chip obs-chip-corrected">{t('corrected')}</span>}
              {f.status === 'TIE_RESOLVED' && (
                <span className="obs-chip obs-chip-tie">{t('viaLottery')}</span>
              )}
              <time dateTime={f.declaredAt}>{formatIst(f.declaredAt, lang)}</time>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function OverviewPage() {
  const { lang, t } = useLang();
  const { data, stale, loading, loadedAt } = useObserverPoll<ObserverOverview>('/api/observer/overview');

  if (loading)
    return (
      <div className="obs-grid">
        <Skeleton lines={2} />
        <Skeleton lines={4} />
        <Skeleton lines={4} />
      </div>
    );
  if (data === null) return <StaleNote />;

  const { ps, zp } = data.kpis;
  const sum = (pick: (k: KindKpis) => number) => pick(ps) + pick(zp);
  const declared = (k: KindKpis) => k.declared + k.unopposed;

  return (
    <div className="obs-overview">
      <div className="obs-statusline">
        <PhasePill phase={data.phase} />
        <span className="obs-updated">
          {t('lastUpdated')}: <time dateTime={data.generatedAt}>{formatIst(data.generatedAt, lang)}</time>
          {loadedAt !== null && !stale && <span className="obs-live-dot" aria-label={t('live')} />}
        </span>
        <button
          type="button"
          className="obs-lang obs-print no-print"
          onClick={() => {
            window.print();
          }}
        >
          {t('print')}
        </button>
      </div>
      {stale && <StaleNote />}

      <div className="obs-kpis">
        <KpiCard
          label={t('wardsDeclared')}
          value={sum(declared)}
          total={sum((k) => k.wardsTotal)}
          ps={{ done: declared(ps), total: ps.wardsTotal }}
          zp={{ done: declared(zp), total: zp.wardsTotal }}
        />
        <KpiCard
          label={t('boothsCounted')}
          note={t('boothSheetsNote')}
          value={sum((k) => k.boothsEntered)}
          total={sum((k) => k.boothsTotal)}
          ps={{ done: ps.boothsEntered, total: ps.boothsTotal }}
          zp={{ done: zp.boothsEntered, total: zp.boothsTotal }}
        />
        <KpiCard
          label={t('postalEntered')}
          value={sum((k) => k.postalEntered)}
          total={sum((k) => k.postalTotal)}
          ps={{ done: ps.postalEntered, total: ps.postalTotal }}
          zp={{ done: zp.postalEntered, total: zp.postalTotal }}
        />
      </div>

      {data.phase === 'NOT_STARTED' ? (
        <ZeroState overview={data} />
      ) : (
        <>
          <div className="obs-grid obs-grid-2">
            <Panel
              title={`${t('partyPosition')} · ${t('zilaParishad')}`}
              actions={
                <Link className="obs-viewall" to="/observer/zp">
                  {t('viewAll')} →
                </Link>
              }
            >
              <SeatBars rows={data.partySeats.zp} />
            </Panel>
            <Panel
              title={`${t('partyPosition')} · ${t('panchayatSamitis')}`}
              actions={
                <Link className="obs-viewall" to="/observer/ps">
                  {t('viewAll')} →
                </Link>
              }
            >
              <SeatBars rows={data.partySeats.ps} />
            </Panel>
          </div>

          <div className="obs-grid obs-grid-feed">
            <Panel title={t('countingAtAGlance')}>
              <div className="obs-progress-pair">
                <p className="obs-progress-label">{t('zilaParishad')}</p>
                <ProgressBar done={zp.boothsEntered} total={zp.boothsTotal} label={t('boothsCounted')} />
                <p className="obs-progress-label">{t('panchayatSamitis')}</p>
                <ProgressBar done={ps.boothsEntered} total={ps.boothsTotal} label={t('boothsCounted')} />
              </div>
              <dl className="obs-facts obs-facts-compact">
                <div className="obs-fact">
                  <dt>{t('wardsCounting')}</dt>
                  <dd>{formatNumber(ps.counting + zp.counting)}</dd>
                </div>
                <div className="obs-fact">
                  <dt>{t('wardsNotStarted')}</dt>
                  <dd>{formatNumber(ps.notStarted + zp.notStarted)}</dd>
                </div>
                <div className="obs-fact">
                  <dt>{t('unopposed')}</dt>
                  <dd>{formatNumber(ps.unopposed + zp.unopposed)}</dd>
                </div>
              </dl>
              <p className="obs-venue">
                {t('countingDate')}: <strong>20 Nov 2026</strong> · {t('countingVenue')}
              </p>
            </Panel>
            <Panel
              title={t('latestDeclarations')}
              actions={
                <Link className="obs-viewall" to="/observer/winners">
                  {t('viewAll')} →
                </Link>
              }
            >
              <Feed overview={data} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
