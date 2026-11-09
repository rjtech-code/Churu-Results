import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadPsZpPostalWards, loadPsZpWards, loadWards } from '../api/loaders';
import { useRole } from '../auth/AuthContext';
import { ErrorBox } from '../components/ErrorBox';
import { StFormatPanel } from '../components/StFormatPanel';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatTime, wardShort } from '../components/format';
import { useApiData } from '../components/useApiData';

const REFRESH_MS = 15_000;

/** PS_RO's "जिला परिषद" tab: ZP wards holding this PS's booths (own-PS progress only). */
function PsZpWardList() {
  const { data: wards, error, reload, loadedAt } = useApiData(loadPsZpWards, []);
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(t);
    };
  }, [reload]);
  return (
    <>
      <ErrorBox error={error} />
      <p className="muted">अपडेट हर 15 सेकंड में · अंतिम अपडेट {loadedAt ? formatTime(loadedAt) : '—'}</p>
      {wards === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>जिला परिषद वार्ड</th>
              <th>आपके बूथ दर्ज</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {wards.map((w) => (
              <tr key={w.id}>
                <td className="ward-name">वार्ड {w.wardNo}</td>
                <td className="numcell">
                  {w.boothsEntered}/{w.boothsTotal}
                  {w.state === 'DECLARED' && <div className="small muted">घोषित</div>}
                </td>
                <td>
                  <Link className="btn btn-secondary" to={`/zp/${w.id}`}>
                    खोलें
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {wards !== null && wards.length === 0 && <p>कोई वार्ड नहीं मिला।</p>}
      <PsZpPostalList />
    </>
  );
}

/** Official order: the ZP wards whose postal ballots this PS_RO enters (one entry per ward). */
function PsZpPostalList() {
  const { data: wards, error } = useApiData(loadPsZpPostalWards, []);
  return (
    <section aria-labelledby="zp-postal-title">
      <h2 id="zp-postal-title">ZP Ward के डाक मत (आपको सौंपे गए)</h2>
      <ErrorBox error={error} />
      {wards === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : wards.length === 0 ? (
        <p className="muted">आपकी पंचायत समिति को किसी ZP Ward का Postal नहीं सौंपा गया है।</p>
      ) : (
        <table className="list" data-testid="zp-postal-list">
          <thead>
            <tr>
              <th>ZP Ward</th>
              <th>डाक मत</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {wards.map((w) => {
              const open = w.state === 'OPEN';
              return (
                <tr key={w.id}>
                  <td className="ward-name">वार्ड {w.wardNo}</td>
                  <td>
                    {w.postal.entered ? `✓ दर्ज (${formatDateTime(w.postal.enteredAt)})` : 'बाकी'}
                    {w.state === 'DECLARED' && <div className="small muted">घोषित</div>}
                  </td>
                  <td className="actions">
                    {open && (
                      <Link className="btn btn-secondary" to={`/zp-postal/${w.id}`}>
                        {w.postal.entered ? 'सुधारें' : 'डाक मत दर्ज करें'}
                      </Link>
                    )}
                    {open && w.postal.entryId !== null && (
                      <Link className="btn btn-secondary" to={`/postal/${w.postal.entryId}/void`}>
                        रद्द करें
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function WardListPage() {
  const role = useRole();
  const [params, setParams] = useSearchParams();
  const zpTab = role === 'PS_RO' && params.get('ballot') === 'ZP';
  return (
    <>
      <h1>मेरे वार्ड</h1>
      {role === 'PS_RO' && (
        <div className="tabs" role="tablist">
          {(['PS', 'ZP'] as const).map((b) => {
            const active = (b === 'ZP') === zpTab;
            return (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={active}
                className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setParams(b === 'ZP' ? { ballot: 'ZP' } : {}, { replace: true });
                }}
              >
                {b === 'PS' ? 'पंचायत समिति' : 'जिला परिषद'}
              </button>
            );
          })}
        </div>
      )}
      {zpTab ? <PsZpWardList /> : <PsWardList />}
      {role === 'ZP_RO' && <StFormatPanel kind="ZP" />}
      {role === 'PS_RO' && <StFormatPanel kind="PS" />}
    </>
  );
}

function PsWardList() {
  const { data: wards, error, reload, loadedAt } = useApiData(loadWards, []);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(t);
    };
  }, [reload]);

  const shown = (wards ?? []).filter((w) => filter === '' || String(w.wardNo).startsWith(filter));
  return (
    <>
      <ErrorBox error={error} />
      <div className="toolbar">
        <label htmlFor="ward-filter">वार्ड संख्या से खोजें</label>
        <input
          id="ward-filter"
          className="num num-small"
          inputMode="numeric"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value.replace(/\D/g, ''));
          }}
        />
        <span className="muted">
          अपने आप हर 15 सेकंड में ताज़ा · अंतिम अपडेट {loadedAt ? formatTime(loadedAt) : '—'}
        </span>
      </div>
      {wards === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>वार्ड</th>
              <th>स्थिति</th>
              <th>बूथ दर्ज</th>
              <th>डाक मत</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.id}>
                <td className="ward-name">{wardShort(w)}</td>
                <td>
                  <StatusBadge status={w.status} />
                </td>
                <td className="numcell">
                  {w.boothsEntered}/{w.boothsTotal}
                  {w.kind === 'ZP' && w.boothsByPs.length > 0 && (
                    <div className="small muted" data-testid="booths-by-ps">
                      {w.boothsByPs.map((p) => `${p.psName} ${p.entered}/${p.total}`).join(', ')}
                    </div>
                  )}
                </td>
                <td>{w.isUnopposed ? '—' : w.postalEntered ? '✓ दर्ज' : 'बाकी'}</td>
                <td>
                  <Link className="btn btn-secondary" to={`/wards/${w.id}`}>
                    खोलें
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {wards !== null && shown.length === 0 && <p>कोई वार्ड नहीं मिला।</p>}
    </>
  );
}
