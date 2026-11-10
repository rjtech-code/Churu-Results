import { useId, useState } from 'react';
import type { SubmitEvent } from 'react';
import type { NameCorrected } from '../api/adminTypes';
import { api } from '../api/api';
import { ErrorBox } from './ErrorBox';
import { Modal } from './Modal';
import { ReauthPasswordField } from './ReauthPasswordField';

export const NAME_MAX = 200;
export const NAME_REASON_MIN = 10;
export const NAME_REASON_MAX = 500;

/** The same normalization as the server (NFC, single spaces, trimmed): "राम  कुमार " = "राम कुमार". */
export function normalizeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** The first problem with the form, in Hindi; null when it may go to the confirm step. */
export function nameFormProblem(
  current: string,
  newName: string,
  reason: string,
  password: string,
): string | null {
  const name = normalizeName(newName);
  if (name === '') return 'नया नाम लिखें';
  if (name.length > NAME_MAX) return `नाम ${String(NAME_MAX)} अक्षरों से लंबा नहीं हो सकता`;
  if (name === normalizeName(current)) return 'नया नाम पुराने नाम जैसा ही है — कोई बदलाव नहीं';
  const r = reason.trim();
  if (r.length < NAME_REASON_MIN)
    return `नाम बदलने का कारण कम से कम ${String(NAME_REASON_MIN)} अक्षर का लिखें`;
  if (r.length > NAME_REASON_MAX) return `कारण ${String(NAME_REASON_MAX)} अक्षरों से अधिक नहीं हो सकता`;
  if (password === '') return 'अपना पासवर्ड लिखें';
  return null;
}

/**
 * "नाम सुधारें" (locked ward): current name (read only), new name, reason and the RO's own password,
 * then a "पुराना → नया" confirmation. Only the name changes. The password is sent once and cleared
 * after every try; it is never kept. "रुकें" (the safe choice) is first and is what Esc does.
 */
export function NameCorrectionDialog({
  wardId,
  candidate,
  onSaved,
  onCancel,
}: {
  wardId: number;
  candidate: { id: number; nameHindi: string; ballotNo: number };
  onSaved: (result: NameCorrected) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [newName, setNewName] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const next = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = nameFormProblem(candidate.nameHindi, newName, reason, password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<NameCorrected>(
        'POST',
        `/api/candidates/wards/${String(wardId)}/candidates/${String(candidate.id)}/name`,
        {
          currentName: candidate.nameHindi,
          newName: normalizeName(newName),
          reason: reason.trim(),
          password,
        },
      );
      onSaved(result);
    } catch (err) {
      setError(err);
      setStep('form'); // fix the problem there; the password must be typed again
    } finally {
      setPassword(''); // never kept after a try (like PasswordDialog)
      setBusy(false);
    }
  };

  const title = `बैलेट नंबर ${String(candidate.ballotNo)} — नाम सुधारें`;
  return (
    <Modal label={title} onCancel={onCancel}>
      {step === 'form' ? (
        <form className="password-dialog name-fix" onSubmit={next} noValidate>
          <h2>{title}</h2>
          <p className="big-explain">
            सूची लॉक है: केवल उम्मीदवार का नाम सुधारा जा सकता है। पार्टी, चुनाव चिह्न, क्रम और मत नहीं
            बदलेंगे।
          </p>
          <div className="field">
            <label htmlFor={`${ids}-old`}>अभी का नाम</label>
            <input id={`${ids}-old`} value={candidate.nameHindi} readOnly aria-readonly="true" />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-new`}>नया नाम (हिंदी)</label>
            <input
              id={`${ids}-new`}
              maxLength={NAME_MAX}
              autoComplete="off"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-reason`}>कारण (अनिवार्य, कम से कम {NAME_REASON_MIN} अक्षर)</label>
            <textarea
              id={`${ids}-reason`}
              rows={2}
              maxLength={NAME_REASON_MAX}
              placeholder="जैसे: नामांकन पत्र के अनुसार वर्तनी ठीक की"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <small>
              {reason.trim().length}/{NAME_REASON_MAX}
            </small>
          </div>
          <div className="field">
            <ReauthPasswordField id={`${ids}-password`} value={password} onChange={setPassword} />
          </div>
          <ErrorBox error={error} />
          <div className="actions">
            <button type="button" className="btn btn-secondary btn-big" onClick={onCancel}>
              रुकें
            </button>
            <button type="submit" className="btn btn-primary btn-big">
              आगे — जाँचें
            </button>
          </div>
        </form>
      ) : (
        <div className="password-dialog name-fix" data-testid="name-confirm">
          <h2>पक्का करें: नाम बदलें?</h2>
          <dl className="name-diff">
            <dt>पुराना नाम</dt>
            <dd className="name-old">{candidate.nameHindi}</dd>
            <dt>नया नाम</dt>
            <dd className="name-new">{normalizeName(newName)}</dd>
            <dt>कारण</dt>
            <dd>{reason.trim()}</dd>
          </dl>
          <p className="big-explain">
            यह बदलाव हर स्क्रीन, रिपोर्ट और परिणाम में दिखेगा और इतिहास में हमेशा दर्ज रहेगा।
          </p>
          <ErrorBox error={error} />
          <div className="actions">
            <button
              type="button"
              className="btn btn-secondary btn-big"
              disabled={busy}
              onClick={() => {
                setStep('form');
              }}
            >
              वापस
            </button>
            <button
              type="button"
              className="btn btn-primary btn-big"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? 'हो रहा है…' : 'नाम बदलें'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
