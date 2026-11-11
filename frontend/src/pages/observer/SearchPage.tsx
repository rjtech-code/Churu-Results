// Search results: ward number, Panchayat Samiti or candidate name (server-side match).
import { Link, useSearchParams } from 'react-router-dom';
import type { SearchHit } from '../../api/observerTypes';
import { useLang } from './i18n';
import { Panel, Skeleton, StaleNote, StatusChip } from './parts';
import { useObserverPoll } from './useObserverPoll';

export function SearchPage() {
  const { t } = useLang();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, loading, notFound } = useObserverPoll<{ hits: SearchHit[] }>(
    `/api/observer/search?q=${encodeURIComponent(q)}`,
  );
  if (q.trim() === '' || notFound) return <p className="obs-muted">{t('noResults')}</p>;
  if (loading) return <Skeleton lines={5} />;
  if (data === null) return <StaleNote />;
  return (
    <div>
      <h1 className="obs-pagetitle">
        {t('searchResults')}: <span className="obs-pagetitle-ps">“{q}”</span>
      </h1>
      <Panel>
        {data.hits.length === 0 ? (
          <p className="obs-muted">{t('noResults')}</p>
        ) : (
          <ul className="obs-hits">
            {data.hits.map((h) => (
              <li key={h.wardId}>
                <Link to={`/observer/wards/${String(h.wardId)}`} className="obs-hit">
                  <span className="obs-hit-ward">
                    {h.kind === 'ZP' ? t('zpShort') : t('psShort')} {t('ward')} {h.wardNo}
                    {h.psName !== null && <span className="obs-muted"> · {h.psName}</span>}
                  </span>
                  <StatusChip
                    row={{
                      status: h.status,
                      unopposed: false,
                      noCandidates: false,
                      tieNeedsLottery: false,
                    }}
                  />
                  {h.winner !== null && (
                    <span className="obs-muted">
                      {t('winner')}: {h.winner.name} · {h.winner.party}
                    </span>
                  )}
                  {h.matchedCandidates.length > 0 && (
                    <span className="obs-muted">
                      {t('matched')}:{' '}
                      {h.matchedCandidates
                        .map((c) => `${c.name} (${c.party ?? t('independent')})`)
                        .join(', ')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
