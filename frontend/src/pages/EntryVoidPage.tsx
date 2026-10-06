import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { BallotCandidate, BoothEntryView, PostalEntryView } from '../api/types';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { ErrorBox } from '../components/ErrorBox';
import { ReasonField, reasonProblem } from '../components/ReasonField';
import { wardShort } from '../components/format';
import { useApiData } from '../components/useApiData';
import { STALE_TEXT } from './EntryEditPage';
import type { WardFlash } from './WardDetailPage';

/** Void a booth entry (kind BOOTH) or a postal entry (kind POSTAL). */
export function EntryVoidPage({ kind }: { kind: 'BOOTH' | 'POSTAL' }) {
  const entryId = idParam(useParams().entryId);
  const navigate = useNavigate();
  const base = kind === 'BOOTH' ? '/api/counting/entries' : '/api/counting/postal';
  const { data, error: loadError } = useApiData(async () => {
    const { entry } = await api<{ entry: BoothEntryView | PostalEntryView }>('GET', `${base}/${entryId}`);
    const [ward, booths, ballot] = await Promise.all([
      loadWard(entry.wardId),
      loadBooths(entry.wardId),
      loadBallot(entry.wardId),
    ]);
    const booth = entry.kind === 'BOOTH' ? booths.booths.find((b) => b.boothId === entry.boothId) : undefined;
    return { entry, ward, ballot, booth };
  }, [entryId, base]);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { entry, ward, ballot, booth } = data;
  const what = kind === 'BOOTH' ? `बूथ ${booth?.boothNo ?? ''} — ${booth?.nameHindi ?? ''}` : 'डाक मत';

  const onVoid = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('POST', `${base}/${entryId}/void`, { rowVersion: entry.rowVersion, reason: reason.trim() });
      const state: WardFlash = { flash: `${what} की एंट्री रद्द कर दी गई — अब दोबारा दर्ज की जा सकती है` };
      void navigate(`/wards/${ward.id}`, { state });
    } catch (err) {
      setError(err);
      setAsking(false);
      setBusy(false);
    }
  };

  return (
    <>
      <p className="backlink">
        <Link to={`/wards/${ward.id}`}>← {wardShort(ward)}</Link>
      </p>
      <h1>{kind === 'BOOTH' ? 'एंट्री रद्द करें' : 'डाक मत रद्द करें'}</h1>
      {error instanceof ApiError && error.code === 'STALE_VERSION' ? (
        <ErrorBox error={STALE_TEXT} />
      ) : (
        <ErrorBox error={error} />
      )}
      <ConfirmPanel title={what} rows={rowsOf(ballot, entry.votes)} total={entry.sheetTotal}>
        {entry.kind === 'POSTAL' && <p>अस्वीकृत डाक मत: {entry.rejectedCount ?? '—'}</p>}
      </ConfirmPanel>
      <ReasonField
        id="void-reason"
        value={reason}
        onChange={setReason}
        label="रद्द करने का कारण (अनिवार्य, 10–500 अक्षर)"
      />
      <div className="actions">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            const problem = reasonProblem(reason);
            if (problem) setError(problem);
            else {
              setError(null);
              setAsking(true);
            }
          }}
        >
          एंट्री रद्द करें
        </button>
      </div>
      {asking && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-label="पक्का रद्द करें?">
            <p>
              क्या आप पक्का <strong>{what}</strong> की एंट्री रद्द करना चाहते हैं? पूरी एंट्री इतिहास में
              सुरक्षित रहेगी।
            </p>
            <div className="actions">
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void onVoid()}>
                {busy ? 'रद्द हो रहा है…' : 'हाँ, रद्द करें'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  setAsking(false);
                }}
              >
                नहीं
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function rowsOf(
  ballot: readonly BallotCandidate[],
  votes: readonly { candidateId: number; votes: number }[],
) {
  return [...ballot]
    .sort((a, b) => Number(a.isNota) - Number(b.isNota) || a.ballotPosition - b.ballotPosition)
    .map((c) => ({
      key: c.candidateId,
      label: c.isNota ? 'नोटा' : `${c.ballotPosition}. ${c.nameHindi}`,
      value: votes.find((v) => v.candidateId === c.candidateId)?.votes ?? 0,
      isNota: c.isNota,
    }));
}
