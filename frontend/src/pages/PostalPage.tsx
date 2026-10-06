import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { EntryPreview, PostalEntryView } from '../api/types';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { ErrorBox } from '../components/ErrorBox';
import { LeaveGuard } from '../components/LeaveGuard';
import { NumberField } from '../components/NumberField';
import { ReasonField, reasonProblem } from '../components/ReasonField';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { wardTitle } from '../components/format';
import { useApiData } from '../components/useApiData';
import { STALE_TEXT } from './EntryEditPage';
import type { WardFlash } from './WardDetailPage';

/** Postal ballots of a ward: create (with preview) or edit (with reason) the single postal entry. */
export function PostalPage() {
  const wardId = idParam(useParams().wardId);
  const navigate = useNavigate();
  const { data, error: loadError } = useApiData(async () => {
    const [ward, booths, ballot] = await Promise.all([
      loadWard(wardId),
      loadBooths(wardId),
      loadBallot(wardId),
    ]);
    const entry =
      booths.postal.entryId === null
        ? null
        : (await api<{ entry: PostalEntryView }>('GET', `/api/counting/postal/${booths.postal.entryId}`))
            .entry;
    return { ward, ballot, entry };
  }, [wardId]);
  const [values, setValues] = useState<SheetValues | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allowLeave = useRef(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, ballot, entry } = data;
  const editing = entry !== null;
  const saved = sheetValues(ballot, entry ?? undefined);
  const sheet = values ?? saved;
  const rejectedValue = rejected ?? (entry?.rejectedCount == null ? '' : String(entry.rejectedCount));
  const dirty = JSON.stringify(sheet) !== JSON.stringify(saved) || rejected !== null || reason !== '';

  const payload = () => {
    const check = checkSheet(ballot, sheet);
    return {
      sheetTotal: check.sheetTotal,
      votes: check.votes,
      ...(rejectedValue === '' ? {} : { rejectedCount: Number(rejectedValue) }),
    };
  };

  const onNext = async () => {
    if (busy) return;
    setError(null);
    const check = checkSheet(ballot, sheet);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (editing) {
      const problem = reasonProblem(reason);
      if (problem) {
        setError(problem);
        return;
      }
      setStage('confirm');
      return;
    }
    setBusy(true);
    try {
      setPreview(await api<EntryPreview>('POST', `/api/counting/wards/${wardId}/postal/preview`, payload()));
      setStage('confirm');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api('PUT', `/api/counting/postal/${entry.id}`, {
          rowVersion: entry.rowVersion,
          ...payload(),
          reason: reason.trim(),
        });
      } else {
        await api('POST', `/api/counting/wards/${wardId}/postal`, payload());
      }
      allowLeave.current = true;
      const state: WardFlash = { flash: editing ? 'डाक मत सुधार दिए गए' : 'डाक मत सेव हो गए' };
      void navigate(`/wards/${wardId}`, { state });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const check = checkSheet(ballot, sheet);
  return (
    <>
      <LeaveGuard dirty={dirty} allowRef={allowLeave} />
      <p>
        <Link to={`/wards/${wardId}`}>← {wardTitle(ward)}</Link>
      </p>
      <h1>{editing ? 'डाक मत — सुधार' : 'डाक मत'}</h1>
      <div className="sheet-header">
        <div className="big">{wardTitle(ward)} — डाक मत पत्र</div>
      </div>
      {error instanceof ApiError && error.code === 'STALE_VERSION' ? (
        <ErrorBox error={STALE_TEXT} />
      ) : (
        <ErrorBox error={error} />
      )}
      {stage === 'form' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onNext();
          }}
        >
          <VoteSheet
            idPrefix="postal"
            ballot={ballot}
            values={sheet}
            onChange={setValues}
            onSubmit={() => void onNext()}
            autoFocusFirstCandidate
          />
          <div className="field-row separate">
            <label htmlFor="postal-rejected">अस्वीकृत डाक मत (वैकल्पिक — योग में नहीं जुड़ते)</label>
            <NumberField
              id="postal-rejected"
              label="अस्वीकृत डाक मत"
              className="num-small"
              value={rejectedValue}
              onChange={setRejected}
            />
          </div>
          {editing && (
            <ReasonField
              id="postal-reason"
              value={reason}
              onChange={setReason}
              label="सुधार का कारण (अनिवार्य, 10–500 अक्षर)"
            />
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              आगे
            </button>
          </div>
        </form>
      )}
      {stage === 'confirm' && (
        <ConfirmPanel
          title="पुष्टि करें — डाक मत"
          rows={ballot.map((c) => ({
            key: c.candidateId,
            label: c.isNota ? 'नोटा' : `${c.ballotPosition}. ${c.nameHindi}`,
            value: Number(sheet.votes[c.candidateId]),
            before: editing ? entry.votes.find((v) => v.candidateId === c.candidateId)?.votes : undefined,
            isNota: c.isNota,
          }))}
          total={check.sheetTotal}
          totalBefore={entry?.sheetTotal}
        >
          <p data-testid="confirm-rejected">
            अस्वीकृत डाक मत (योग से अलग): {rejectedValue === '' ? '—' : rejectedValue}
          </p>
          {preview && (
            <>
              <h3>सेव के बाद वार्ड का कुल योग</h3>
              <table className="confirm-table">
                <tbody>
                  {preview.wardAfter.candidates.map((c) => (
                    <tr key={c.id}>
                      <td>{c.isNota ? 'नोटा' : c.nameHindi}</td>
                      <td className="numcell">{c.totalVotes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSave()}>
              {busy ? 'सेव हो रहा है…' : 'पुष्टि करें और सेव करें'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setStage('form');
              }}
            >
              वापस जाकर सुधारें
            </button>
          </div>
        </ConfirmPanel>
      )}
    </>
  );
}
