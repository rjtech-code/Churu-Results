import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadWards } from '../api/loaders';
import { ErrorBox } from '../components/ErrorBox';
import { StatusBadge } from '../components/StatusBadge';
import { formatTime, wardShort } from '../components/format';
import { useApiData } from '../components/useApiData';

const REFRESH_MS = 15_000;

export function WardListPage() {
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
      <h1>मेरे वार्ड</h1>
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
