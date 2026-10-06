import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadWard } from '../api/loaders';
import type { DeclarationItem, DeclarePreview, WardResult } from '../api/types';
import {
  DecisionFields,
  ResultTable,
  decisionBody,
  decisionProblem,
  emptyDecision,
} from '../components/DecisionFields';
import type { Decision } from '../components/DecisionFields';
import { ErrorBox, PanelError, SuccessBox, WarningBox } from '../components/ErrorBox';
import { SplitLayout } from '../components/SplitLayout';
import { wardShort, wardTitle } from '../components/format';
import { useApiData } from '../components/useApiData';

export function DeclarePage() {
  const wardId = idParam(useParams().wardId);
  const {
    data,
    error: loadError,
    reload,
  } = useApiData(async () => {
    const ward = await loadWard(wardId);
    try {
      return {
        ward,
        preview: await api<DeclarePreview>('POST', `/api/declare/wards/${wardId}/preview`, {}),
        previewError: null,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status !== 403 && err.status !== 404 && err.status !== 401) {
        return { ward, preview: null, previewError: err };
      }
      throw err;
    }
  }, [wardId]);
  const [decision, setDecision] = useState<Decision>(emptyDecision);
  const [error, setError] = useState<unknown>(null);
  const [changedNotice, setChangedNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ declaration: DeclarationItem; result: WardResult } | null>(null);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, preview, previewError } = data;

  const onDeclare = async () => {
    if (busy || !preview) return;
    const problem = decisionProblem(preview.wouldStore, decision);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const body = decisionBody(preview.result, preview.wouldStore, decision);
    setDecision((d) => ({ ...d, password: '' })); // never keep the password after the request
    try {
      setDone(
        await api<{ declaration: DeclarationItem; result: WardResult }>(
          'POST',
          `/api/declare/wards/${wardId}`,
          body,
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESULT_CHANGED') {
        setChangedNotice(true); // show the fresh result and ask again
        setDecision(emptyDecision);
        reload();
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="backlink">
        <Link to={`/wards/${wardId}`}>← {wardShort(ward)}</Link>
      </p>
      <h1 className="compact">घोषणा — {wardTitle(ward)}</h1>
      {done ? (
        <>
          <SuccessBox
            text={`वार्ड घोषित: विजेता ${done.declaration.winner.nameHindi}, अंतर ${done.declaration.margin}${done.declaration.status === 'TIE_RESOLVED' ? ' (लॉटरी से)' : ''}`}
          />
          <ResultTable result={done.result} />
          <Link className="btn btn-primary" to={`/wards/${wardId}`}>
            वार्ड पर वापस
          </Link>
        </>
      ) : preview === null ? (
        <ErrorBox error={previewError} />
      ) : (
        <SplitLayout
          panelLabel="घोषणा की पुष्टि"
          main={<ResultTable result={preview.result} />}
          panel={
            <>
              {changedNotice && <WarningBox text="परिणाम बदल गया है, कृपया नया परिणाम दोबारा जाँचें" />}
              <div className="summary-box">
                {preview.wouldStore.needsLottery ? (
                  <p className="big">शीर्ष पर बराबरी — लॉटरी आवश्यक</p>
                ) : (
                  <p className="big" data-testid="declare-winner">
                    विजेता: {preview.result.leader?.nameHindi} · अंतर: {preview.wouldStore.margin}
                  </p>
                )}
                <p>कुल वैध मत: {preview.result.totalValidVotes}</p>
              </div>
              <DecisionFields
                result={preview.result}
                store={preview.wouldStore}
                value={decision}
                onChange={setDecision}
              />
              <PanelError error={error} />
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary btn-big"
                  disabled={busy}
                  onClick={() => void onDeclare()}
                >
                  {busy ? 'घोषणा हो रही है…' : 'घोषणा की पुष्टि करें'}
                </button>
              </div>
            </>
          }
        />
      )}
    </>
  );
}
