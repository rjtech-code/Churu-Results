// Declared winners: searchable and filterable (ZP / PS, party, Panchayat Samiti, women only).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ObserverWinners } from '../../api/observerTypes';
import { formatNumber, useLang } from './i18n';
import { Panel, Skeleton, StaleNote } from './parts';
import { useObserverPoll } from './useObserverPoll';

export function WinnersPage() {
  const { t } = useLang();
  const { data, stale, loading } = useObserverPoll<ObserverWinners>('/api/observer/winners');
  const [kind, setKind] = useState<'ALL' | 'ZP' | 'PS'>('ALL');
  const [party, setParty] = useState('ALL');
  const [ps, setPs] = useState('ALL');
  const [womenOnly, setWomenOnly] = useState(false);
  const [q, setQ] = useState('');

  const list = useMemo(() => data?.list ?? [], [data]);
  const parties = useMemo(() => [...new Set(list.map((w) => w.winner.party))].sort(), [list]);
  const psNames = useMemo(
    () => [...new Set(list.map((w) => w.psName).filter((n): n is string => n !== null))].sort(),
    [list],
  );
  const filtered = list
    .filter(
      (w) =>
        (kind === 'ALL' || w.kind === kind) &&
        (party === 'ALL' || w.winner.party === party) &&
        (ps === 'ALL' || w.psName === ps) &&
        (!womenOnly || w.isWoman) &&
        (q.trim() === '' ||
          w.winner.name.toLowerCase().includes(q.trim().toLowerCase()) ||
          String(w.wardNo) === q.trim()),
    )
    // Zila Parishad first (the senior body), then each Panchayat Samiti by name, ward in order.
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'ZP' ? -1 : 1) ||
        (a.psName ?? '').localeCompare(b.psName ?? '') ||
        a.wardNo - b.wardNo,
    );

  if (loading) return <Skeleton lines={8} />;
  if (data === null) return <StaleNote />;

  return (
    <div>
      <h1 className="obs-pagetitle">{t('winners')}</h1>
      <p className="obs-subline">
        {t('showing')} <strong className="obs-num">{filtered.length}</strong> {t('ofWinners')}{' '}
        <span className="obs-num">{list.length}</span>
      </p>
      {stale && <StaleNote />}
      <div className="obs-filters no-print">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          placeholder={t('searchHint')}
          aria-label={t('search')}
        />
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as 'ALL' | 'ZP' | 'PS');
          }}
          aria-label={t('ward')}
        >
          <option value="ALL">{t('all')}</option>
          <option value="ZP">{t('zp')}</option>
          <option value="PS">{t('ps')}</option>
        </select>
        <select
          value={party}
          onChange={(e) => {
            setParty(e.target.value);
          }}
          aria-label={t('filterParty')}
        >
          <option value="ALL">
            {t('filterParty')}: {t('all')}
          </option>
          {parties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={ps}
          onChange={(e) => {
            setPs(e.target.value);
          }}
          aria-label={t('filterPs')}
        >
          <option value="ALL">
            {t('filterPs')}: {t('all')}
          </option>
          {psNames.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="obs-check">
          <input
            type="checkbox"
            checked={womenOnly}
            onChange={(e) => {
              setWomenOnly(e.target.checked);
            }}
          />
          {t('womenOnly')}
        </label>
      </div>
      <Panel>
        {filtered.length === 0 ? (
          <p className="obs-muted">{list.length === 0 ? t('noWinnersYet') : t('noResults')}</p>
        ) : (
          <div className="obs-tablewrap">
            <table className="obs-table">
              <thead>
                <tr>
                  <th scope="col">{t('ward')}</th>
                  <th scope="col">{t('ps')}</th>
                  <th scope="col">{t('winner')}</th>
                  <th scope="col">{t('party')}</th>
                  <th scope="col" className="obs-right">
                    {t('margin')}
                  </th>
                  <th scope="col">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr key={w.wardId}>
                    <td>
                      <Link to={`/observer/wards/${String(w.wardId)}`} className="obs-wardlink">
                        {w.kind === 'ZP' ? t('zpShort') : t('psShort')} {w.wardNo}
                      </Link>
                    </td>
                    <td className="obs-muted">{w.psName ?? '—'}</td>
                    <td>
                      <strong>{w.winner.name}</strong>
                      {w.isWoman && <span className="obs-chip obs-chip-women"> {t('women')}</span>}
                    </td>
                    <td className="obs-muted">{w.winner.party}</td>
                    <td className="obs-right obs-num">
                      {w.margin === null || w.unopposed ? '—' : formatNumber(w.margin)}
                    </td>
                    <td>
                      {w.unopposed ? (
                        <span className="obs-chip obs-chip-unopposed">{t('unopposed')}</span>
                      ) : w.tieResolved ? (
                        <span className="obs-chip obs-chip-tie">{t('viaLottery')}</span>
                      ) : (
                        <span className="obs-chip obs-chip-declared">{t('declared')}</span>
                      )}
                      {w.isCorrected && (
                        <span className="obs-chip obs-chip-corrected"> {t('corrected')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
