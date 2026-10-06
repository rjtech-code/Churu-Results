import { Link, useParams } from 'react-router-dom';
import { api } from '../api/api';
import { idParam, loadBallot } from '../api/loaders';
import type { BallotCandidate, HistoryItem } from '../api/types';
import { ErrorBox } from '../components/ErrorBox';
import { formatDateTime } from '../components/format';
import { useApiData } from '../components/useApiData';

const ACTION_HINDI: Record<string, string> = {
  ENTRY_CREATED: 'दर्ज की गई',
  ENTRY_UPDATED: 'सुधारी गई',
  ENTRY_VOIDED: 'रद्द की गई',
  POSTAL_CREATED: 'डाक मत दर्ज',
  POSTAL_UPDATED: 'डाक मत सुधारे गए',
  POSTAL_VOIDED: 'डाक मत रद्द',
};

interface EntryValue {
  ward_id?: number;
  round_no?: number;
  sheet_total?: number;
  rejected_count?: number | null;
  votes?: { candidateId: number; votes: number }[];
  correction_version?: number;
}

function describe(value: unknown, ballot: readonly BallotCandidate[]): string {
  if (typeof value !== 'object' || value === null) return '—';
  const v = value as EntryValue;
  if (v.votes === undefined) return '—';
  const name = (id: number) => {
    const c = ballot.find((b) => b.candidateId === id);
    return c === undefined ? `#${id}` : c.isNota ? 'नोटा' : c.nameHindi;
  };
  const parts = v.votes.map((x) => `${name(x.candidateId)}: ${x.votes}`);
  if (v.round_no !== undefined) parts.unshift(`राउंड ${v.round_no}`);
  if (v.sheet_total !== undefined) parts.push(`योग ${v.sheet_total}`);
  if (v.rejected_count !== undefined && v.rejected_count !== null) parts.push(`अस्वीकृत ${v.rejected_count}`);
  if (v.correction_version !== undefined) parts.push(`(संशोधन संस्करण ${v.correction_version})`);
  return parts.join(' · ');
}

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
              <td>{describe(h.oldValue, data.ballot)}</td>
              <td>{h.action.endsWith('VOIDED') ? 'रद्द' : describe(h.newValue, data.ballot)}</td>
              <td>{h.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
