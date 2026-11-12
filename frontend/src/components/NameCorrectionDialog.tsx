import { useId, useState } from 'react';
import type { SubmitEvent } from 'react';
import {
  EDUCATION_HINDI,
  GENDER_HINDI,
  NO_CANDIDATE_DETAILS,
  pickDetails,
} from '../api/adminTypes';
import type {
  CandidateDetails,
  Gender,
  NameCorrected,
  RoCandidate,
  CorrectableField,
} from '../api/adminTypes';
import { api } from '../api/api';
import { CandidateDetailsFields } from './CandidateDetailsFields';
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

/** Hindi label of every detail that may be corrected after the lock (same list as the server). */
export const FIELD_HINDI: Record<CorrectableField, string> = {
  NAME: 'नाम',
  PARTY: 'पार्टी',
  GENDER: 'लिंग',
  CANDIDATE_CATEGORY: 'वर्ग (श्रेणी)',
  DOB: 'जन्म तिथि',
  AGE_STATED: 'उम्र',
  EDUCATION: 'शिक्षा',
  MOBILE: 'मोबाइल',
  ADDRESS: 'पता',
  OCCUPATION: 'व्यवसाय',
};

/** What the RO may correct here, and what the lock keeps frozen. */
export const FROZEN_HINT =
  'सूची लॉक है: उम्मीदवार का विवरण सुधारा जा सकता है। मतपत्र क्रम नहीं बदलेगा, और उम्मीदवार जोड़ा या हटाया नहीं जा सकता (नोटा भी नहीं)।';

/** Everything the dialog can change. */
export interface CorrectionForm extends CandidateDetails {
  nameHindi: string;
  partyId: number | null;
  gender: Gender;
}

export interface Party {
  id: number;
  shortName: string;
  nameHindi: string;
}

const partyText = (partyId: number | null, parties: readonly Party[]): string =>
  partyId === null ? 'निर्दलीय' : (parties.find((p) => p.id === partyId)?.shortName ?? '—');

/** The value of one field as the confirm step and the history show it. */
export function valueText(
  field: CorrectableField,
  f: CorrectionForm,
  parties: readonly Party[],
): string {
  switch (field) {
    case 'NAME':
      return normalizeName(f.nameHindi);
    case 'PARTY':
      return partyText(f.partyId, parties);
    case 'GENDER':
      return GENDER_HINDI[f.gender];
    case 'CANDIDATE_CATEGORY':
      return f.candidateCategory ?? '—';
    case 'DOB':
      return f.dob ?? '—';
    case 'AGE_STATED':
      return f.ageStated === null ? '—' : String(f.ageStated);
    case 'EDUCATION':
      return f.education === null ? '—' : EDUCATION_HINDI[f.education];
    case 'MOBILE':
      return f.mobile ?? '—';
    case 'ADDRESS':
      return f.address ?? '—';
    case 'OCCUPATION':
      return f.occupation ?? '—';
  }
}

const blank = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());

/** Fields whose value really changed, in a fixed order. */
export function changedFields(before: CorrectionForm, after: CorrectionForm): CorrectableField[] {
  const out: CorrectableField[] = [];
  if (normalizeName(after.nameHindi) !== normalizeName(before.nameHindi)) out.push('NAME');
  if (after.partyId !== before.partyId) out.push('PARTY');
  if (after.gender !== before.gender) out.push('GENDER');
  if (after.candidateCategory !== before.candidateCategory) out.push('CANDIDATE_CATEGORY');
  if (blank(after.dob) !== blank(before.dob)) out.push('DOB');
  if (after.ageStated !== before.ageStated) out.push('AGE_STATED');
  if (after.education !== before.education) out.push('EDUCATION');
  if (blank(after.mobile) !== blank(before.mobile)) out.push('MOBILE');
  if (blank(after.address) !== blank(before.address)) out.push('ADDRESS');
  if (blank(after.occupation) !== blank(before.occupation)) out.push('OCCUPATION');
  return out;
}

/** The first problem with the form, in Hindi; null when it may go to the confirm step. */
export function correctionProblem(
  before: CorrectionForm,
  after: CorrectionForm,
  reason: string,
  password: string,
): string | null {
  const name = normalizeName(after.nameHindi);
  if (name === '') return 'नया नाम लिखें';
  if (name.length > NAME_MAX) return `नाम ${String(NAME_MAX)} अक्षरों से लंबा नहीं हो सकता`;
  if (changedFields(before, after).length === 0) return 'कोई बदलाव नहीं — पहले कुछ सुधारें';
  const r = reason.trim();
  if (r.length < NAME_REASON_MIN)
    return `सुधार का कारण कम से कम ${String(NAME_REASON_MIN)} अक्षर का लिखें`;
  if (r.length > NAME_REASON_MAX) return `कारण ${String(NAME_REASON_MAX)} अक्षरों से अधिक नहीं हो सकता`;
  if (password === '') return 'अपना पासवर्ड लिखें';
  return null;
}

/** The name-only check the old "नाम सुधारें" form used (kept: same rules, one field). */
export function nameFormProblem(
  current: string,
  newName: string,
  reason: string,
  password: string,
): string | null {
  const before: CorrectionForm = {
    nameHindi: current,
    partyId: null,
    gender: 'M',
    ...NO_CANDIDATE_DETAILS,
  };
  const name = normalizeName(newName);
  if (name !== '' && name.length <= NAME_MAX && name === normalizeName(current)) {
    return 'नया नाम पुराने नाम जैसा ही है — कोई बदलाव नहीं';
  }
  return correctionProblem(before, { ...before, nameHindi: newName }, reason, password);
}

/** Only the fields that changed are sent; a field left out means "unchanged" on the server. */
function bodyOf(
  before: CorrectionForm,
  after: CorrectionForm,
  fields: readonly CorrectableField[],
  reason: string,
  password: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    currentName: before.nameHindi,
    reason: reason.trim(),
    password,
  };
  const details = pickDetails(after);
  for (const field of fields) {
    switch (field) {
      case 'NAME':
        body.newName = normalizeName(after.nameHindi);
        break;
      case 'PARTY':
        body.partyId = after.partyId;
        body.confirmPartyChange = true;
        break;
      case 'GENDER':
        body.gender = after.gender;
        break;
      case 'CANDIDATE_CATEGORY':
        body.candidateCategory = details.candidateCategory;
        break;
      case 'DOB':
        body.dob = details.dob;
        break;
      case 'AGE_STATED':
        body.ageStated = details.ageStated;
        break;
      case 'EDUCATION':
        body.education = details.education;
        break;
      case 'MOBILE':
        body.mobile = details.mobile;
        break;
      case 'ADDRESS':
        body.address = details.address;
        break;
      case 'OCCUPATION':
        body.occupation = details.occupation;
        break;
    }
  }
  return body;
}

/**
 * "विवरण सुधारें" (locked ward): one form with every editable detail pre-filled (name, party, लिंग,
 * वर्ग, जन्म तिथि / उम्र, शिक्षा, मोबाइल, पता, व्यवसाय), changed fields highlighted, then a confirm
 * step that lists ONLY what changed as "पुराना → नया", with the reason and the RO's own password.
 * The ballot order, adding / removing a candidate and NOTA are not here at all (and the server
 * refuses them). The password is sent once and cleared after every try; it is never kept.
 */
export function CandidateCorrectionDialog({
  wardId,
  candidate,
  parties,
  countingStarted = false,
  onSaved,
  onCancel,
}: {
  wardId: number;
  candidate: RoCandidate & { id: number; ballotNo: number };
  parties: readonly Party[];
  countingStarted?: boolean;
  onSaved: (result: NameCorrected) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const before: CorrectionForm = {
    nameHindi: candidate.nameHindi,
    partyId: candidate.partyId,
    gender: candidate.gender,
    dob: candidate.dob,
    ageStated: candidate.ageStated,
    education: candidate.education,
    mobile: candidate.mobile,
    candidateCategory: candidate.candidateCategory,
    address: candidate.address,
    occupation: candidate.occupation,
  };
  const [form, setForm] = useState<CorrectionForm>(before);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [partyOk, setPartyOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fields = changedFields(before, form);
  const partyChanged = fields.includes('PARTY');
  const change = (patch: Partial<CorrectionForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };
  const marked = (field: CorrectableField) => (fields.includes(field) ? ' cw-field-changed' : '');

  const next = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = correctionProblem(before, form, reason, password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setPartyOk(false);
    setStep('confirm');
  };

  const save = async () => {
    if (busy) return;
    if (partyChanged && !partyOk) {
      setError('पार्टी बदलने की पुष्टि करें (नीचे का बॉक्स चुनें)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<NameCorrected>(
        'POST',
        `/api/candidates/wards/${String(wardId)}/candidates/${String(candidate.id)}/details`,
        bodyOf(before, form, fields, reason, password),
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

  const title = `बैलेट नंबर ${String(candidate.ballotNo)} — विवरण सुधारें`;
  return (
    <Modal label={title} onCancel={onCancel}>
      {step === 'form' ? (
        <form className="password-dialog name-fix" onSubmit={next} noValidate>
          <h2>{title}</h2>
          <p className="big-explain">{FROZEN_HINT}</p>
          <div className={`field${marked('NAME')}`}>
            <label htmlFor={`${ids}-new`}>नाम (हिंदी)</label>
            <input
              id={`${ids}-new`}
              maxLength={NAME_MAX}
              autoComplete="off"
              value={form.nameHindi}
              onChange={(e) => {
                change({ nameHindi: e.target.value });
              }}
            />
            <small className="muted">अभी का नाम: {candidate.nameHindi}</small>
          </div>
          <div className={`field${marked('PARTY')}`}>
            <label htmlFor={`${ids}-party`}>पार्टी</label>
            <select
              id={`${ids}-party`}
              value={form.partyId === null ? '' : String(form.partyId)}
              onChange={(e) => {
                change({ partyId: e.target.value === '' ? null : Number(e.target.value) });
              }}
            >
              <option value="">निर्दलीय</option>
              {parties.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.nameHindi} ({p.shortName})
                </option>
              ))}
            </select>
            {partyChanged && (
              <small className="cw-err" data-testid="party-warn">
                पार्टी बदलने से पार्टी-वार सीट गिनती बदलेगी
                {countingStarted ? ' — इस वार्ड की मतगणना शुरू हो चुकी है, ध्यान से जाँचें' : ''}।
              </small>
            )}
          </div>
          <div className={`field${marked('GENDER')}`}>
            <label htmlFor={`${ids}-gender`}>लिंग</label>
            <select
              id={`${ids}-gender`}
              value={form.gender}
              onChange={(e) => {
                change({ gender: e.target.value as Gender });
              }}
            >
              {(['M', 'F', 'O'] as const).map((g) => (
                <option key={g} value={g}>
                  {GENDER_HINDI[g]}
                </option>
              ))}
            </select>
          </div>
          <div
            className={
              fields.some((f) => f !== 'NAME' && f !== 'PARTY' && f !== 'GENDER')
                ? 'cw-field-changed'
                : undefined
            }
          >
            <CandidateDetailsFields
              idPrefix={`${ids}-details`}
              label="उम्मीदवार"
              value={form}
              disabled={false}
              onChange={(patch) => {
                change(patch);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-reason`}>कारण (अनिवार्य, कम से कम {NAME_REASON_MIN} अक्षर)</label>
            <textarea
              id={`${ids}-reason`}
              rows={2}
              maxLength={NAME_REASON_MAX}
              placeholder="जैसे: नामांकन पत्र के अनुसार विवरण ठीक किया"
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
          <h2>पक्का करें: विवरण बदलें?</h2>
          <dl className="name-diff" data-testid="change-list">
            {fields.map((field) => (
              <div key={field} className="name-diff-row">
                <dt>{FIELD_HINDI[field]}</dt>
                <dd>
                  <span className="name-old">{valueText(field, before, parties)}</span>{' '}
                  <span aria-label="से">→</span>{' '}
                  <strong className="name-new">{valueText(field, form, parties)}</strong>
                </dd>
              </div>
            ))}
            <div className="name-diff-row">
              <dt>कारण</dt>
              <dd>{reason.trim()}</dd>
            </div>
          </dl>
          {partyChanged && (
            <div className="msg msg-warn" data-testid="party-confirm">
              <p>
                पार्टी बदल रही है: <strong>{valueText('PARTY', before, parties)}</strong> →{' '}
                <strong>{valueText('PARTY', form, parties)}</strong>। इससे पार्टी-वार सीट गिनती बदलेगी।
              </p>
              {countingStarted && (
                <p>
                  <strong>ध्यान दें:</strong> इस वार्ड की मतगणना शुरू हो चुकी है। बदलाव रिपोर्ट और
                  पार्टी-वार गिनती में तुरंत दिखेगा।
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={partyOk}
                  onChange={(e) => {
                    setPartyOk(e.target.checked);
                    setError(null);
                  }}
                />{' '}
                मैंने पार्टी का बदलाव जाँच लिया है
              </label>
            </div>
          )}
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
              {busy ? 'हो रहा है…' : 'विवरण बदलें'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
