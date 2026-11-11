// One ward: candidates in ballot order with party and votes (exactly what the DM reports show —
// live totals once counting has started), NOTA, winner and margin when declared, booth progress
// and postal status. Strictly read-only.
import { Link, useParams } from 'react-router-dom';
import type { ObserverWardDetail } from '../../api/observerTypes';
import { formatIst, formatNumber, useLang } from './i18n';
import type { DictKey } from './i18n';
import { Panel, ProgressBar, Skeleton, StaleNote } from './parts';
import { useObserverPoll } from './useObserverPoll';

const STATUS_KEY: Record<string, DictKey> = {
  NOT_STARTED: 'notStarted',
  COUNTING: 'inProgress',
  READY_TO_DECLARE: 'ready',
  TIE_NEEDS_LOTTERY: 'tie',
  DECLARED: 'declared',
  TIE_RESOLVED: 'declared',
  UNOPPOSED: 'unopposed',
  NO_CANDIDATES: 'noCandidates',
  UNAVAILABLE: 'unavailable',
};

export function WardPage() {
  const { lang, t } = useLang();
  const { wardId } = useParams();
  const { data, stale, loading, notFound } = useObserverPoll<ObserverWardDetail>(
    `/api/observer/wards/${wardId ?? ''}`,
  );
  if (notFound) return <p className="obs-muted">{t('noResults')}</p>;
  if (loading) return <Skeleton lines={10} />;
  if (data === null) return <StaleNote />;

  const w = data.ward;
  const counted = w.status !== 'NOT_STARTED' && w.status !== 'NO_CANDIDATES' && !w.unavailable;
  const maxVotes = Math.max(...data.candidates.map((c) => c.totalVotes), 1);
  const statusKey = STATUS_KEY[w.status] ?? 'notStarted';

  return (
    <div>
      <p className="obs-breadcrumb no-print">
        <Link to={w.kind === 'ZP' ? '/observer/zp' : '/observer/ps'}>
          ← {w.kind === 'ZP' ? t('zilaParishad') : t('panchayatSamitis')}
        </Link>
      </p>
      <h1 className="obs-pagetitle">
        {w.kind === 'ZP' ? t('zp') : t('ps')} · {t('ward')} {w.wardNo}
        {w.psName !== null && <span className="obs-pagetitle-ps"> · {w.psName}</span>}
      </h1>
      <p className="obs-subline">
        <span className={`obs-chip obs-chip-${statusKey}`}>{t(statusKey)}</span>
        {w.reservationCategory !== null && (
          <span className="obs-muted">
            {' '}
            · {t('reservation')}: {w.reservationCategory}
          </span>
        )}
        {counted && (
          <span className="obs-muted">
            {' '}
            · {t('validVotes')}: <strong className="obs-num">{formatNumber(w.totalValidVotes)}</strong>
            {w.rejectedPostal !== null &&
              ` · ${t('rejectedPostal')}: ${formatNumber(w.rejectedPostal)}`}
          </span>
        )}
      </p>
      {stale && <StaleNote />}

      <Panel title={t('results')}>
        {(() => {
          const winner = data.candidates.find((c) => c.isWinner);
          if (winner === undefined) return null;
          return (
            <div className="obs-result-banner">
              <span className="obs-result-label">{t('winner')}</span>
              <span className="obs-result-name">{winner.name}</span>
              <span className="obs-result-party">{winner.party?.shortName ?? t('independent')}</span>
              <span className="obs-result-votes">
                <span className="obs-num">{formatNumber(winner.totalVotes)}</span> {t('votes')}
              </span>
              {w.margin !== null && !w.isUnopposed && (
                <span className="obs-result-margin">
                  {t('margin')} <span className="obs-num">{formatNumber(w.margin)}</span>
                </span>
              )}
            </div>
          );
        })()}
        <div className="obs-tablewrap">
          <table className="obs-table obs-candidates">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('candidate')}</th>
                <th scope="col">{t('party')}</th>
                <th scope="col" className="obs-right">
                  {t('boothVotes')}
                </th>
                <th scope="col" className="obs-right">
                  {t('postalVotes')}
                </th>
                <th scope="col" className="obs-right">
                  {t('total')}
                </th>
                <th scope="col" className="obs-votebar-col" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.id} className={c.isWinner ? 'obs-winner-row' : c.isNota ? 'obs-nota-row' : ''}>
                  <td className="obs-muted">{c.isNota ? '—' : c.ballotPosition}</td>
                  <td>
                    <strong>{c.isNota ? t('nota') : c.name}</strong>
                    {c.isWinner && <span className="obs-chip obs-chip-declared"> {t('winner')}</span>}
                  </td>
                  <td className="obs-muted">
                    {c.isNota ? '—' : (c.party?.shortName ?? t('independent'))}
                  </td>
                  <td className="obs-right obs-num">{counted ? formatNumber(c.boothVotes) : '—'}</td>
                  <td className="obs-right obs-num">{counted ? formatNumber(c.postalVotes) : '—'}</td>
                  <td className="obs-right obs-num obs-total">
                    {counted ? formatNumber(c.totalVotes) : '—'}
                  </td>
                  <td className="obs-votebar-col" aria-hidden="true">
                    {counted && !c.isNota && (
                      <span className="obs-votebar">
                        <span
                          className="obs-votebar-fill"
                          style={{ width: `${String((c.totalVotes / maxVotes) * 100)}%` }}
                        />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {w.margin !== null && counted && data.candidates.every((c) => !c.isWinner) && (
          <p className="obs-subline">
            {t('margin')}: <strong className="obs-num">{formatNumber(w.margin)}</strong>
          </p>
        )}
      </Panel>

      <div className="obs-grid obs-grid-2">
        <Panel title={t('boothProgressOfWard')}>
          <ProgressBar done={w.boothsEntered} total={w.boothsTotal} label={t('progress')} />
          <div className="obs-booths">
            {data.booths.map((b) => (
              <span
                key={`${b.psName}-${b.boothNo}`}
                className={`obs-booth${b.entered ? ' entered' : ''}`}
                title={`${b.name} · ${b.psName} · ${b.entered ? t('entered') : t('pending')}`}
              >
                {b.boothNo}
              </span>
            ))}
          </div>
          <p className="obs-muted obs-subline">
            {t('postal')}: {data.postal.entered ? t('entered') : t('pending')}
          </p>
        </Panel>

        <Panel title={t('declarationHistory')}>
          {data.declarations.length === 0 ? (
            <p className="obs-muted">{t('noDeclarationsYet')}</p>
          ) : (
            <ol className="obs-declarations">
              {data.declarations.map((d) => (
                <li key={d.version}>
                  <span className="obs-decl-head">
                    {t('version')} {d.version}
                    {d.version > 1 && <span className="obs-chip obs-chip-corrected">{t('corrected')}</span>}
                    {d.status === 'TIE_RESOLVED' && (
                      <span className="obs-chip obs-chip-tie">{t('viaLottery')}</span>
                    )}
                  </span>
                  <span>
                    {t('winner')}: <strong>{d.winner.name}</strong> · {t('margin')}{' '}
                    <span className="obs-num">{formatNumber(d.margin)}</span>
                  </span>
                  <time className="obs-muted" dateTime={d.declaredAt}>
                    {formatIst(d.declaredAt, lang)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
