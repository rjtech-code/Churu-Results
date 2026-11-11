// Zila Parishad: the 39 wards with status, booth progress across every Panchayat Samiti, and the
// winner and margin once declared.
import type { ObserverZp } from '../../api/observerTypes';
import { formatNumber, useLang } from './i18n';
import { Panel, Skeleton, StaleNote } from './parts';
import { WardTable } from './PsPages';
import { useObserverPoll } from './useObserverPoll';

export function ZpPage() {
  const { t } = useLang();
  const { data, stale, loading } = useObserverPoll<ObserverZp>('/api/observer/zp');
  if (loading) return <Skeleton lines={8} />;
  if (data === null) return <StaleNote />;
  const s = data.summary;
  return (
    <div>
      <h1 className="obs-pagetitle">{t('zilaParishad')}</h1>
      <p className="obs-subline">
        {t('wardsDeclared')}: <strong>{formatNumber(s.declared)}</strong> /{' '}
        {formatNumber(s.wardsTotal)} · {t('boothsCounted')}:{' '}
        <strong>{formatNumber(s.boothsDone)}</strong> / {formatNumber(s.boothsTotal)} ·{' '}
        {t('postalEntered')}: <strong>{formatNumber(s.postalDone)}</strong> /{' '}
        {formatNumber(s.postalTotal)}
      </p>
      {stale && <StaleNote />}
      <Panel>
        <WardTable wards={data.wards} />
      </Panel>
    </div>
  );
}
