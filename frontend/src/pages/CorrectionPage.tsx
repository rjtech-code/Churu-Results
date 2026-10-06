import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/api';
import { idParam, loadBallot, loadBooths, loadWard } from '../api/loaders';
import type { BoothEntryView, CorrectionPreview, DeclarationItem, PostalEntryView } from '../api/types';
import {
  DecisionFields,
  ResultTable,
  decisionBody,
  decisionProblem,
  emptyDecision,
} from '../components/DecisionFields';
import type { Decision } from '../components/DecisionFields';
import { ErrorBox, SuccessBox, WarningBox } from '../components/ErrorBox';
import { ReasonField, reasonProblem } from '../components/ReasonField';
import { VoteSheet, checkSheet, sheetValues } from '../components/VoteSheet';
import type { SheetValues } from '../components/VoteSheet';
import { formatDateTime, wardShort, wardTitle } from '../components/format';
import { useApiData } from '../components/useApiData';
import { STALE_TEXT } from './EntryEditPage';

interface Picked {
  key: string;
  kind: 'BOOTH' | 'POSTAL';
  entry: BoothEntryView | PostalEntryView;
  label: string;
  values: SheetValues;
}

export function CorrectionPage() {
  const wardId = idParam(useParams().wardId);
  const {
    data,
    error: loadError,
    reload,
  } = useApiData(async () => {
    const [ward, booths, ballot, { declarations }] = await Promise.all([
      loadWard(wardId),
      loadBooths(wardId),
      loadBallot(wardId),
      api<{ declarations: DeclarationItem[] }>('GET', `/api/declare/wards/${wardId}/declarations`),
    ]);
    return { ward, booths, ballot, declarations };
  }, [wardId]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [decision, setDecision] = useState<Decision>(emptyDecision);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, booths, ballot, declarations } = data;

  const toggle = async (kind: 'BOOTH' | 'POSTAL', entryId: number, label: string) => {
    const key = `${kind}:${entryId}`;
    setPreview(null);
    if (picked.some((p) => p.key === key)) {
      setPicked(picked.filter((p) => p.key !== key));
      return;
    }
    try {
      const path = kind === 'BOOTH' ? `/api/counting/entries/${entryId}` : `/api/counting/postal/${entryId}`;
      const { entry } = await api<{ entry: BoothEntryView | PostalEntryView }>('GET', path);
      setPicked([...picked, { key, kind, entry, label, values: sheetValues(ballot, entry) }]);
    } catch (err) {
      setError(err);
    }
  };

  const changes = () =>
    picked.map((p) => {
      const check = checkSheet(ballot, p.values);
      return {
        kind: p.kind,
        entryId: p.entry.id,
        rowVersion: p.entry.rowVersion,
        sheetTotal: check.sheetTotal,
        votes: check.votes,
      };
    });

  const onPreview = async () => {
    setError(null);
    if (picked.length === 0) {
      setError('पहले बदलने वाली एंट्री चुनें');
      return;
    }
    for (const p of picked) {
      const check = checkSheet(ballot, p.values);
      if (!check.ok) {
        setError(`${p.label}: ${check.message ?? ''}`);
        return;
      }
    }
    const problem = reasonProblem(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      setPreview(
        await api<CorrectionPreview>('POST', `/api/declare/wards/${wardId}/correction/preview`, {
          changes: changes(),
        }),
      );
      setDecision(emptyDecision);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (busy || !preview) return;
    const problem = decisionProblem(preview.wouldStore, decision);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      ...decisionBody(preview.after, preview.wouldStore, decision),
      reason: reason.trim(),
      changes: changes(),
    };
    setDecision((d) => ({ ...d, password: '' }));
    try {
      const res = await api<{ declaration: DeclarationItem }>(
        'POST',
        `/api/declare/wards/${wardId}/correction`,
        body,
      );
      setNotice(
        `संशोधन सेव हुआ: संस्करण ${res.declaration.version}, विजेता ${res.declaration.winner.nameHindi}`,
      );
      setPicked([]);
      setReason('');
      setPreview(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESULT_CHANGED') {
        setPreview(null);
        setError('परिणाम बदल गया है, कृपया दोबारा पूर्वावलोकन करें');
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
      <h1>संशोधन — {wardTitle(ward)}</h1>
      <SuccessBox text={notice} />
      <h2>घोषणा के सभी संस्करण</h2>
      <table className="list" data-testid="declaration-versions">
        <thead>
          <tr>
            <th>संस्करण</th>
            <th>विजेता</th>
            <th>अंतर</th>
            <th>कुल वैध मत</th>
            <th>किसने / कब</th>
            <th>संशोधन का कारण</th>
          </tr>
        </thead>
        <tbody>
          {declarations.map((d) => (
            <tr key={d.version}>
              <td className="numcell">{d.version}</td>
              <td>
                {d.winner.nameHindi}
                {d.status === 'TIE_RESOLVED' ? ' (लॉटरी)' : ''}
              </td>
              <td className="numcell">{d.margin}</td>
              <td className="numcell">{d.totalValidVotes ?? '—'}</td>
              <td>
                {d.declaredBy.fullName ?? d.declaredBy.username} · {formatDateTime(d.declaredAt)}
              </td>
              <td>{d.correctionReason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>1. बदलने वाली एंट्री चुनें</h2>
      <div className="pick-list">
        {booths.booths
          .filter((b) => b.entryId !== null)
          .map((b) => (
            <label key={b.boothId} className="checkbox">
              <input
                type="checkbox"
                checked={picked.some((p) => p.key === `BOOTH:${b.entryId ?? 0}`)}
                onChange={() => void toggle('BOOTH', b.entryId ?? 0, `बूथ ${b.boothNo}`)}
              />{' '}
              बूथ {b.boothNo} — {b.nameHindi}
            </label>
          ))}
        {booths.postal.entryId !== null && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={picked.some((p) => p.key === `POSTAL:${booths.postal.entryId ?? 0}`)}
              onChange={() => void toggle('POSTAL', booths.postal.entryId ?? 0, 'डाक मत')}
            />{' '}
            डाक मत
          </label>
        )}
      </div>

      {picked.map((p, i) => (
        <section key={p.key} className="card">
          <h3>{p.label}</h3>
          <VoteSheet
            idPrefix={`corr-${i}`}
            ballot={ballot}
            values={p.values}
            onChange={(values) => {
              setPreview(null);
              setPicked(picked.map((x) => (x.key === p.key ? { ...x, values } : x)));
            }}
            onSubmit={() => void onPreview()}
          />
        </section>
      ))}

      <h2>2. कारण और पूर्वावलोकन</h2>
      <ReasonField
        id="correction-reason"
        value={reason}
        onChange={setReason}
        label="संशोधन का कारण (अनिवार्य, 10–500 अक्षर)"
      />
      {error instanceof ApiError && error.code === 'STALE_VERSION' ? (
        <ErrorBox error={STALE_TEXT} />
      ) : (
        <ErrorBox error={error} />
      )}
      <div className="actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void onPreview()}>
          पूर्वावलोकन
        </button>
      </div>

      {preview && (
        <section className="confirm">
          <h2>3. पुष्टि — नया संस्करण {preview.wouldStore.version}</h2>
          {preview.warnings.includes('VOTER_COUNT_MISSING') && (
            <WarningBox text="कुछ बूथों की मतदाता संख्या दर्ज नहीं है" />
          )}
          <h3>संशोधन के बाद</h3>
          <ResultTable result={preview.after} />
          <p className="big">
            {preview.wouldStore.needsLottery
              ? 'शीर्ष पर बराबरी — लॉटरी आवश्यक'
              : `विजेता: ${preview.after.leader?.nameHindi ?? ''} · अंतर: ${preview.wouldStore.margin}`}
          </p>
          <p>
            पहले: विजेता {declarations[declarations.length - 1]?.winner.nameHindi ?? '—'}, कुल वैध मत{' '}
            {preview.before.totalValidVotes}
          </p>
          <DecisionFields
            result={preview.after}
            store={preview.wouldStore}
            value={decision}
            onChange={setDecision}
          />
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? 'सेव हो रहा है…' : 'संशोधन की पुष्टि करें'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
