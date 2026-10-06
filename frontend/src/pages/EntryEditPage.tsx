import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { BoothEntryView } from '../api/types';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { ErrorBox } from '../components/ErrorBox';
import { LeaveGuard } from '../components/LeaveGuard';
import { ReasonField, reasonProblem } from '../components/ReasonField';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { wardShort } from '../components/format';
import { SplitLayout } from '../components/SplitLayout';
import { useApiData } from '../components/useApiData';
import type { WardFlash } from './WardDetailPage';

export const STALE_TEXT = 'किसी और ने इसे बदल दिया है, पेज दोबारा खोलें';

export function EntryEditPage() {
  const entryId = idParam(useParams().entryId);
  const navigate = useNavigate();
  const { data, error: loadError } = useApiData(async () => {
    const { entry } = await api<{ entry: BoothEntryView }>('GET', `/api/counting/entries/${entryId}`);
    const [ward, booths, ballot] = await Promise.all([
      loadWard(entry.wardId),
      loadBooths(entry.wardId),
      loadBallot(entry.wardId),
    ]);
    const booth = booths.booths.find((b) => b.boothId === entry.boothId);
    return {
      entry,
      ward,
      ballot,
      boothNo: booth?.boothNo ?? 0,
      boothName: booth?.nameHindi ?? '',
      registered: booth?.registeredVotersTotal ?? null,
    };
  }, [entryId]);
  const [values, setValues] = useState<SheetValues | null>(null);
  const [round, setRound] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allowLeave = useRef(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { entry, ward, ballot } = data;
  const saved = sheetValues(ballot, entry);
  const sheet = values ?? saved;
  const roundValue = round ?? String(entry.roundNo);
  const dirty =
    JSON.stringify(sheet) !== JSON.stringify(saved) || roundValue !== String(entry.roundNo) || reason !== '';

  const onNext = () => {
    setError(null);
    const check = checkSheet(ballot, sheet);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (roundValue === '' || Number(roundValue) < 1 || Number(roundValue) > 99) {
      setError('राउंड संख्या 1 से 99 के बीच लिखें');
      return;
    }
    const problem = reasonProblem(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setStage('confirm');
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const check = checkSheet(ballot, sheet);
    try {
      await api('PUT', `/api/counting/entries/${entryId}`, {
        rowVersion: entry.rowVersion,
        roundNo: Number(roundValue),
        sheetTotal: check.sheetTotal,
        votes: check.votes,
        reason: reason.trim(),
      });
      allowLeave.current = true;
      const state: WardFlash = { flash: `बूथ ${data.boothNo} की एंट्री सुधार दी गई` };
      void navigate(`/wards/${ward.id}`, { state });
    } catch (err) {
      setError(err);
      setStage('form'); // the error is shown next to "आगे", with every typed number kept
      setBusy(false);
    }
  };

  const stale = error instanceof ApiError && error.code === 'STALE_VERSION';
  const check = checkSheet(ballot, sheet);
  return (
    <>
      <LeaveGuard dirty={dirty} allowRef={allowLeave} />
      <p className="backlink">
        <Link to={`/wards/${ward.id}`}>← {wardShort(ward)}</Link>
      </p>
      <div className="sheet-header">
        <div className="big">
          एंट्री सुधार — बूथ संख्या {data.boothNo} — {data.boothName}
        </div>
        <div className="muted small">
          पंजीकृत मतदाता: {data.registered ?? 'दर्ज नहीं'} · मतपत्र:{' '}
          {ward.kind === 'PS' ? 'पंचायत समिति' : 'जिला परिषद'}
        </div>
      </div>
      {stage === 'form' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onNext();
          }}
        >
          <VoteSheet
            layout="split"
            idPrefix="edit"
            ballot={ballot}
            values={sheet}
            onChange={(v) => {
              setValues(v);
              if (typeof error === 'string') setError(null); // a local check message is stale now
            }}
            onSubmit={onNext}
            round={{ value: roundValue, onChange: setRound }}
            error={error}
            errorView={stale ? STALE_TEXT : undefined}
            extra={
              <ReasonField
                id="edit-reason"
                value={reason}
                onChange={setReason}
                label="सुधार का कारण (अनिवार्य, 10–500 अक्षर)"
              />
            }
            actions={
              <div className="actions">
                <button type="submit" className="btn btn-primary btn-big">
                  आगे
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
              title="पुष्टि करें — पहले और अब"
              rows={ballot.map((c) => ({
                key: c.candidateId,
                label: c.isNota ? 'नोटा' : `${c.ballotPosition}. ${c.nameHindi}`,
                value: Number(sheet.votes[c.candidateId]),
                before: entry.votes.find((v) => v.candidateId === c.candidateId)?.votes,
                isNota: c.isNota,
              }))}
              total={check.sheetTotal}
              totalBefore={entry.sheetTotal}
            />
          }
          panel={
            <>
              <p>
                कारण: <q>{reason.trim()}</q>
              </p>
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
