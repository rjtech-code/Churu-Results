// Panchayat Samitis: 13 cards with booth progress and wards declared, drilling into one PS's wards.
import { Link, useParams } from 'react-router-dom';
import type { ObserverPsDetail, ObserverPsList, ObserverWardRow } from '../../api/observerTypes';
import { formatNumber, useLang } from './i18n';
import { Panel, ProgressBar, ProgressRing, Skeleton, StaleNote, StatusChip } from './parts';
import { useObserverPoll } from './useObserverPoll';

export function WardTable({ wards, showPs = false }: { wards: ObserverWardRow[]; showPs?: boolean }) {
  const { t } = useLang();
  return (
    <div className="obs-tablewrap">
      <table className="obs-table">
        <thead>
          <tr>
            <th scope="col">{t('ward')}</th>
            {showPs && <th scope="col">{t('ps')}</th>}
            <th scope="col">{t('status')}</th>
            <th scope="col">{t('progress')}</th>
            <th scope="col">{t('postal')}</th>
            <th scope="col">{t('winner')}</th>
            <th scope="col" className="obs-right">
              {t('margin')}
            </th>
          </tr>
        </thead>
        <tbody>
          {wards.map((w) => (
            <tr key={w.wardId}>
              <td>
                <Link to={`/observer/wards/${String(w.wardId)}`} className="obs-wardlink">
                  {t('ward')} {w.wardNo}
                </Link>
              </td>
              {showPs && <td className="obs-muted">{w.psName ?? '—'}</td>}
              <td>
                <StatusChip row={w} />
              </td>
              <td>
                <ProgressBar done={w.boothsDone} total={w.boothsTotal} label={t('progress')} />
              </td>
              <td>{w.postalDone === null ? '—' : w.postalDone ? t('entered') : t('pending')}</td>
              <td>
                {w.winner === null ? (
                  <span className="obs-muted">—</span>
                ) : (
                  <>
                    <strong>{w.winner.name}</strong>
                    <span className="obs-muted"> · {w.winner.party}</span>
                  </>
                )}
              </td>
              <td className="obs-right obs-num">
                {w.margin === null ? <span className="obs-muted">—</span> : formatNumber(w.margin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PsListPage() {
  const { t } = useLang();
  const { data, stale, loading } = useObserverPoll<ObserverPsList>('/api/observer/ps');
  if (loading) return <Skeleton lines={6} />;
  if (data === null) return <StaleNote />;
  return (
    <div>
      <h1 className="obs-pagetitle">{t('panchayatSamitis')}</h1>
      <p className="obs-subline">
        {t('wardsDeclared')}: <strong className="obs-num">{formatNumber(data.summary.declared)}</strong>{' '}
        / <span className="obs-num">{formatNumber(data.summary.wardsTotal)}</span> ·{' '}
        {t('boothsCounted')}:{' '}
        <strong className="obs-num">{formatNumber(data.summary.boothsDone)}</strong> /{' '}
        <span className="obs-num">{formatNumber(data.summary.boothsTotal)}</span>
      </p>
      {stale && <StaleNote />}
      <div className="obs-cards">
        {data.list.map((ps) => (
          <Link key={ps.psId} to={`/observer/ps/${String(ps.psId)}`} className="obs-card">
            <ProgressRing done={ps.boothsDone} total={ps.boothsTotal} />
            <span className="obs-card-body">
              <span className="obs-card-name">{ps.psName}</span>
              <span className="obs-card-stats">
                <span className="obs-card-stat">
                  <span className="obs-card-stat-num">
                    {formatNumber(ps.declared)}
                    <span className="obs-card-stat-of">/{formatNumber(ps.wardsTotal)}</span>
                  </span>
                  <span className="obs-card-stat-label">{t('declaredOf')}</span>
                </span>
                <span className="obs-card-stat">
                  <span className="obs-card-stat-num">
                    {formatNumber(ps.boothsDone)}
                    <span className="obs-card-stat-of">/{formatNumber(ps.boothsTotal)}</span>
                  </span>
                  <span className="obs-card-stat-label">{t('psSheets')}</span>
                </span>
                <span className="obs-card-stat">
                  <span className="obs-card-stat-num">
                    {formatNumber(ps.zpBoothsDone)}
                    <span className="obs-card-stat-of">/{formatNumber(ps.zpBoothsTotal)}</span>
                  </span>
                  <span className="obs-card-stat-label">{t('zpSheets')}</span>
                </span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PsDetailPage() {
  const { t } = useLang();
  const { psId } = useParams();
  const { data, stale, loading, notFound } = useObserverPoll<ObserverPsDetail>(
    `/api/observer/ps/${psId ?? ''}`,
  );
  if (notFound) return <p className="obs-muted">{t('noResults')}</p>;
  if (loading) return <Skeleton lines={8} />;
  if (data === null) return <StaleNote />;
  return (
    <div>
      <p className="obs-breadcrumb no-print">
        <Link to="/observer/ps">← {t('panchayatSamitis')}</Link>
      </p>
      <h1 className="obs-pagetitle">{data.ps.psName}</h1>
      <p className="obs-subline">
        {t('wardsDeclared')}: <strong>{formatNumber(data.ps.declared)}</strong> /{' '}
        {formatNumber(data.ps.wardsTotal)} · {t('boothsCounted')}:{' '}
        <strong>{formatNumber(data.ps.boothsDone)}</strong> / {formatNumber(data.ps.boothsTotal)}
      </p>
      {stale && <StaleNote />}
      <Panel>
        <WardTable wards={data.wards} />
      </Panel>
    </div>
  );
}
