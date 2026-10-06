import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { EntryPreview, PostalEntryView } from '../api/types';
import { ConfirmPanel, WardAfter } from '../components/ConfirmPanel';
import { ErrorBox } from '../components/ErrorBox';
import { LeaveGuard } from '../components/LeaveGuard';
import { NumberField } from '../components/NumberField';
import { ReasonField, emptyReason, reasonProblem, reasonText } from '../components/ReasonField';
import type { ReasonValue } from '../components/ReasonField';
import { NO_CHANGE_TEXT, VoteSheet, checkSheet, sameAsSaved, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { wardShort, wardTitle } from '../components/format';
import { SplitLayout } from '../components/SplitLayout';
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
  const [reason, setReason] = useState<ReasonValue>(emptyReason);
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
  const dirty =
    JSON.stringify(sheet) !== JSON.stringify(saved) ||
    rejected !== null ||
    reason.choice !== '' ||
    reason.details !== '';

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
      const typedRejected = rejectedValue === '' ? null : Number(rejectedValue);
      if (typedRejected === entry.rejectedCount && sameAsSaved(ballot, sheet, entry)) {
        setError(NO_CHANGE_TEXT); // nothing to correct: no confirm screen
        return;
      }
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
          reason: reasonText(reason),
        });
      } else {
        await api('POST', `/api/counting/wards/${wardId}/postal`, payload());
      }
      allowLeave.current = true;
      const state: WardFlash = { flash: editing ? 'डाक मत सुधार दिए गए' : 'डाक मत सेव हो गए' };
      void navigate(`/wards/${wardId}`, { state });
    } catch (err) {
      setError(err);
      setStage('form'); // the error is shown next to "आगे", with every typed number kept
      setBusy(false);
    }
  };

  const check = checkSheet(ballot, sheet);
  const stale = error instanceof ApiError && error.code === 'STALE_VERSION';
  return (
    <>
      <LeaveGuard dirty={dirty} allowRef={allowLeave} />
      <p className="backlink">
        <Link to={`/wards/${wardId}`}>← {wardShort(ward)}</Link>
      </p>
      <div className="sheet-header">
        <div className="big">{editing ? 'डाक मत पत्र — सुधार' : 'डाक मत पत्र'}</div>
        <div className="muted small">{wardTitle(ward)}</div>
      </div>
      {stage === 'form' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onNext();
          }}
        >
          <VoteSheet
            layout="split"
            idPrefix="postal"
            ballot={ballot}
            values={sheet}
            onChange={(v) => {
              setValues(v);
              if (typeof error === 'string') setError(null); // a local check message is stale now
            }}
            onSubmit={() => void onNext()}
            autoFocusFirstCandidate
            error={error}
            errorView={stale ? STALE_TEXT : undefined}
            extra={
              <>
                <div className="field-row">
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
                    label="सुधार का कारण (अनिवार्य)"
                  />
                )}
              </>
            }
            actions={
              <div className="actions">
                <button type="submit" className="btn btn-primary btn-big" disabled={busy}>
                  {busy ? 'जाँच हो रही है…' : 'आगे'}
                </button>
              </div>
            }
          />
        </form>
      )}
      {stage === 'confirm' && (
        <SplitLayout
          panelLabel="पुष्टि"
          main={
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
              {preview && <WardAfter preview={preview} />}
            </ConfirmPanel>
          }
          panel={
            <>
              <p className="big" data-testid="confirm-rejected">
                अस्वीकृत डाक मत (योग से अलग): {rejectedValue === '' ? '—' : rejectedValue}
              </p>
              {editing && (
                <p>
                  कारण: <q>{reasonText(reason)}</q>
                </p>
              )}
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary btn-big"
                  disabled={busy}
                  onClick={() => void onSave()}
                >
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
            </>
          }
        />
      )}
    </>
  );
}
