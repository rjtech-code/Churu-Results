import { Link, useParams } from 'react-router-dom';
import { api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { StoryItem } from '../api/types';
import { ErrorBox } from '../components/ErrorBox';
import { formatDateTime, wardShort } from '../components/format';
import { useApiData } from '../components/useApiData';
import { ACTION_HINDI, describeValue } from './HistoryPage';

/**
 * The whole story of one booth ballot (kind BOOTH) or of a ward's postal ballots (kind POSTAL):
 * created, updated, voided, re-created ... oldest first, across every entry ever made.
 */
export function StoryPage({ kind }: { kind: 'BOOTH' | 'POSTAL' }) {
  const params = useParams();
  const wardId = idParam(params.wardId);
  const boothId = kind === 'BOOTH' ? idParam(params.boothId) : null;
  const { data, error } = useApiData(async () => {
    const [ward, booths, ballot] = await Promise.all([
      loadWard(wardId),
      loadBooths(wardId),
      loadBallot(wardId),
    ]);
    const path =
      boothId === null
        ? `/api/counting/wards/${wardId}/postal/history`
        : `/api/counting/booths/${boothId}/history?ballotFor=${ward.kind}`;
    const { history } = await api<{ history: StoryItem[] }>('GET', path);
    const booth = booths.booths.find((b) => b.boothId === boothId);
    return { ward, ballot, history, booth };
  }, [wardId, boothId]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, ballot, history, booth } = data;
  const title =
    kind === 'BOOTH'
      ? `बूथ ${booth?.boothNo ?? ''} — ${booth?.nameHindi ?? ''}: पूरा इतिहास`
      : 'डाक मत: पूरा इतिहास';
  return (
    <>
      <p className="backlink">
        <Link to={`/wards/${ward.id}`}>← {wardShort(ward)}</Link>
      </p>
      <h1>{title}</h1>
      <p className="muted">
        सबसे पुराना पहले। रद्द की गई एंट्री भी दिखती हैं; दोबारा दर्ज करने पर नई एंट्री संख्या बनती है।
      </p>
      {history.length === 0 ? (
        <p>अभी कोई इतिहास नहीं — यह {kind === 'BOOTH' ? 'बूथ' : 'डाक मत'} कभी दर्ज नहीं हुआ।</p>
      ) : (
        <table className="list" data-testid="story">
          <thead>
            <tr>
              <th>समय</th>
              <th>एंट्री</th>
              <th>क्या हुआ</th>
              <th>किसने</th>
              <th>पहले</th>
              <th>बाद में</th>
              <th>कारण</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} className={h.entryVoided ? 'voided-row' : undefined}>
                <td>{formatDateTime(h.at)}</td>
                <td className="numcell">
                  #{h.entryId}
                  {h.entryVoided ? ' (रद्द)' : ''}
                </td>
                <td>{ACTION_HINDI[h.action] ?? h.action}</td>
                <td>{h.user ? (h.user.fullName ?? h.user.username) : '—'}</td>
                <td>{describeValue(h.oldValue, ballot)}</td>
                <td>{h.action.endsWith('VOIDED') ? 'रद्द' : describeValue(h.newValue, ballot)}</td>
                <td>{h.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
