import { Link, useParams } from 'react-router-dom';
import { api } from '../api/api';
import { idParam, loadBallot } from '../api/loaders';
import type { HistoryItem } from '../api/types';
import { DiffCells } from '../components/DiffList';
import { historyDiff } from '../components/historyDiff';
import type { EntryValue } from '../components/historyDiff';
import { ErrorBox } from '../components/ErrorBox';
import { formatDateTime } from '../components/format';
import { useApiData } from '../components/useApiData';

export const ACTION_HINDI: Record<string, string> = {
  ENTRY_CREATED: 'दर्ज की गई',
  ENTRY_UPDATED: 'सुधारी गई',
  ENTRY_VOIDED: 'रद्द की गई',
  POSTAL_CREATED: 'डाक मत दर्ज',
  POSTAL_UPDATED: 'डाक मत सुधारे गए',
  POSTAL_VOIDED: 'डाक मत रद्द',
};

export function HistoryPage({ kind }: { kind: 'BOOTH' | 'POSTAL' }) {
  const entryId = idParam(useParams().entryId);
  const { data, error } = useApiData(async () => {
    const base = kind === 'BOOTH' ? '/api/counting/entries' : '/api/counting/postal';
    const { history } = await api<{ history: HistoryItem[] }>('GET', `${base}/${entryId}/history`);
    const first = history[0]?.newValue as EntryValue | undefined;
    const wardId = first?.ward_id;
    const ballot = wardId === undefined ? [] : await loadBallot(wardId);
    return { history, ballot, wardId };
  }, [entryId, kind]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  return (
    <>
      {data.wardId !== undefined && (
        <p>
          <Link to={`/wards/${data.wardId}`}>← वार्ड पर वापस</Link>
        </p>
      )}
      <h1>{kind === 'BOOTH' ? 'एंट्री का इतिहास' : 'डाक मत का इतिहास'}</h1>
      <table className="list">
        <thead>
          <tr>
            <th>समय</th>
            <th>क्या हुआ</th>
            <th>किसने</th>
            <th>पहले</th>
            <th>बाद में</th>
            <th>कारण</th>
          </tr>
        </thead>
        <tbody>
          {data.history.map((h, i) => (
            <tr key={i}>
              <td>{formatDateTime(h.at)}</td>
              <td>{ACTION_HINDI[h.action] ?? h.action}</td>
              <td>{h.user ? (h.user.fullName ?? h.user.username) : '—'}</td>
              <DiffCells diff={historyDiff(h.action, h.oldValue, h.newValue, data.ballot)} />
              <td>{h.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
