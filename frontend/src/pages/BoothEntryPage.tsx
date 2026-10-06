import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { EntryPreview } from '../api/types';
import { getLastRound, setLastRound } from '../auth/lastRound';
import { ConfirmPanel, WardAfter } from '../components/ConfirmPanel';
import { ErrorBox, WarningBox } from '../components/ErrorBox';
import { SplitLayout } from '../components/SplitLayout';
import { LeaveGuard } from '../components/LeaveGuard';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { wardShort } from '../components/format';
import { useApiData } from '../components/useApiData';
import type { WardFlash } from './WardDetailPage';

export function BoothEntryPage() {
  const params = useParams();
  const wardId = idParam(params.wardId);
  const boothId = idParam(params.boothId);
  const navigate = useNavigate();
  const { data, error: loadError } = useApiData(async () => {
    const [ward, booths, ballot] = await Promise.all([
      loadWard(wardId),
      loadBooths(wardId),
      loadBallot(wardId),
    ]);
    const booth = booths.booths.find((b) => b.boothId === boothId);
    if (!booth) throw new ApiError(404, 'NOT_FOUND', {});
    return { ward, booths, booth, ballot };
  }, [wardId, boothId]);

  const [values, setValues] = useState<SheetValues | null>(null);
  const [round, setRound] = useState(String(getLastRound()));
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allowLeave = useRef(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, booth, ballot, booths } = data;
  const sheet = values ?? sheetValues(ballot);
  const dirty = Object.values(sheet.votes).some((v) => v !== '') || sheet.total !== '';
  const body = (check: ReturnType<typeof checkSheet>) => ({
    wardId,
    boothId,
    ballotFor: ward.kind,
    roundNo: Number(round),
    sheetTotal: check.sheetTotal,
    votes: check.votes,
  });

  const onNext = async () => {
    if (busy) return;
    setError(null);
    if (round === '' || Number(round) < 1 || Number(round) > 99) {
      setError('राउंड संख्या 1 से 99 के बीच लिखें');
      return;
    }
    const check = checkSheet(ballot, sheet);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    try {
      setPreview(await api<EntryPreview>('POST', '/api/counting/entries/preview', body(check)));
      setStage('confirm');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (busy) return; // no double submit
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/counting/entries', body(checkSheet(ballot, sheet)));
      setLastRound(Number(round));
      allowLeave.current = true;
      const next = booths.booths.find((b) => !b.entered && b.boothId !== boothId);
      const state: WardFlash = {
        flash: `बूथ ${booth.boothNo} की एंट्री सेव हो गई`,
        highlightBoothId: next?.boothId ?? null,
      };
      void navigate(`/wards/${wardId}`, { state });
    } catch (err) {
      setError(err);
      setStage('form'); // the error is shown next to "आगे", with every typed number kept
      setBusy(false);
    }
  };

  const alreadyEntered = error instanceof ApiError && error.code === 'ALREADY_ENTERED';
  return (
    <>
      <LeaveGuard dirty={dirty} allowRef={allowLeave} />
      <p className="backlink">
        <Link to={`/wards/${wardId}`}>← {wardShort(ward)}</Link>
      </p>
      <div className="sheet-header">
        <div className="big">
          बूथ संख्या {booth.boothNo} — {booth.nameHindi}
        </div>
        <div className="muted small">
          पंजीकृत मतदाता: {booth.registeredVotersTotal ?? 'दर्ज नहीं'} · मतपत्र:{' '}
          {ward.kind === 'PS' ? 'पंचायत समिति' : 'जिला परिषद'}
        </div>
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
            idPrefix="entry"
            ballot={ballot}
            values={sheet}
            onChange={(v) => {
              setValues(v);
              if (typeof error === 'string') setError(null); // a local check message is stale now
            }}
            onSubmit={() => void onNext()}
            round={{ value: round, onChange: setRound }}
            autoFocusFirstCandidate
            error={error}
            errorView={
              alreadyEntered ? (
                <>
                  यह बूथ पहले ही दर्ज हो चुका है — दोबारा एंट्री नहीं हो सकती।{' '}
                  <Link to={`/wards/${wardId}`}>वार्ड पर वापस जाएँ</Link>
                </>
              ) : undefined
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

      {stage === 'confirm' && preview && (
        <SplitLayout
          panelLabel="पुष्टि"
          main={
            <ConfirmPanel
              title={`पुष्टि करें — बूथ ${booth.boothNo}, राउंड ${preview.summary.roundNo ?? round}`}
              rows={preview.summary.votes.map((v) => ({
                key: v.candidateId,
                label: v.isNota ? 'नोटा' : `${v.ballotPosition}. ${v.nameHindi}`,
                value: v.votes,
                isNota: v.isNota,
              }))}
              total={preview.summary.sheetTotal}
            >
              <WardAfter preview={preview} />
            </ConfirmPanel>
          }
          panel={
            <>
              <p className="big">क्या ये संख्याएँ पर्ची से मेल खाती हैं?</p>
              {preview.warnings.includes('VOTER_COUNT_MISSING') && (
                <WarningBox text="इस बूथ की पंजीकृत मतदाता संख्या दर्ज नहीं है, इसलिए वह जाँच नहीं हुई" />
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
