import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { api } from '../api/api';
import { ErrorBox } from './ErrorBox';
import { Modal } from './Modal';
import { ReauthPasswordField } from './ReauthPasswordField';
import { chosenPasswordProblems, problemText } from './chosenPassword';
import { PHONE_ERROR, normalizePhone } from './phone';

export interface SavedCredentials {
  username: string;
  password: string | null;
  /** false: only the mobile number changed. */
  credentialsChanged?: boolean;
}

/**
 * "बदलें": ONE small form for an RO's username and password. "देखें" shows the current password
 * (needs the DM's password), "अपने आप बनाएं" fills a strong easy-to-read one, or type your own.
 * One "सेव करें". The DM's password is typed once in this form and cleared after every try.
 */
export function CredentialsDialog({
  userId,
  currentUsername,
  currentPhone,
  title,
  onSaved,
  onCancel,
}: {
  userId: number;
  currentUsername: string;
  currentPhone: string | null;
  title: string;
  onSaved: (saved: SavedCredentials) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(currentUsername);
  const [phone, setPhone] = useState(currentPhone ?? '');
  const [pw, setPw] = useState('');
  // The password shown by "देखें": saving it unchanged must not count as a password change.
  const [viewed, setViewed] = useState<string | null>(null);
  const [dmPw, setDmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const passwordChanged = pw !== '' && pw !== viewed;
  const usernameChanged = username.trim() !== currentUsername;
  const problems = passwordChanged ? chosenPasswordProblems(pw, pw, username.trim()) : [];
  // The mobile number is optional: empty keeps the old one; a typed one must be valid.
  const cleanPhone = normalizePhone(phone);
  const phoneBad = phone.trim() !== '' && cleanPhone === null;
  const phoneChanged = cleanPhone !== null && cleanPhone !== currentPhone;
  const canSave =
    (passwordChanged || usernameChanged || phoneChanged) &&
    problems.length === 0 &&
    username.trim() !== '' &&
    !phoneBad;

  const guarded = async (work: () => Promise<void>) => {
    if (busy) return;
    if (dmPw === '') {
      setError('अपना पासवर्ड लिखें');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setDmPw('');
      setBusy(false);
    }
  };

  const view = () =>
    guarded(async () => {
      const out = await api<{ password: string }>('POST', `/api/admin/users/${userId}/view-password`, {
        password: dmPw,
      });
      setPw(out.password);
      setViewed(out.password);
    });

  const generate = async () => {
    if (busy) return;
    setError(null);
    try {
      const out = await api<{ password: string }>('POST', '/api/admin/users/generate-password', {});
      setPw(out.password);
    } catch (err) {
      setError(err);
    }
  };

  const save = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    void guarded(async () => {
      const saved = await api<SavedCredentials>('POST', `/api/admin/users/${userId}/update-credentials`, {
        username: username.trim(),
        ...(passwordChanged ? { newPassword: pw } : {}),
        ...(phoneChanged ? { phone: cleanPhone } : {}),
        password: dmPw,
      });
      setPw('');
      onSaved(saved);
    });
  };

  return (
    <Modal label={title} onCancel={onCancel}>
      <form className="password-dialog" onSubmit={save}>
        <h2>{title}</h2>
        <div className="field">
          <label htmlFor="cred-username">यूज़रनेम</label>
          <input
            id="cred-username"
            autoComplete="off"
            maxLength={30}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="cred-password">पासवर्ड (खाली छोड़ें तो पासवर्ड वही रहेगा)</label>
          <input
            id="cred-password"
            autoComplete="off"
            maxLength={128}
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="cred-phone">मोबाइल नंबर (खाली छोड़ें तो नंबर वही रहेगा)</label>
          <input
            id="cred-phone"
            inputMode="tel"
            autoComplete="off"
            maxLength={20}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
          />
          {phoneBad && <p className="msg msg-error">{PHONE_ERROR}</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => void view()} disabled={busy}>
            देखें
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void generate()} disabled={busy}>
            अपने आप बनाएं
          </button>
        </div>
        {passwordChanged && problems.length > 0 && (
          <ul className="pw-hints" data-testid="pw-hints">
            {problems.map((p) => (
              <li key={p}>✗ {problemText(p)}</li>
            ))}
          </ul>
        )}
        {passwordChanged && problems.length === 0 && (
          <p className="msg msg-ok">✓ पासवर्ड नियमों के अनुसार है</p>
        )}
        <div className="field">
          <ReauthPasswordField id="confirm-password" value={dmPw} onChange={setDmPw} />
        </div>
        {(passwordChanged || usernameChanged) && (
          <p className="muted">सेव करने पर इस RO का चल रहा सेशन बंद हो जाएगा।</p>
        )}
        <ErrorBox error={error} />
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-big" onClick={onCancel} disabled={busy}>
            रुकें
          </button>
          <button type="submit" className="btn btn-primary btn-big" disabled={busy || !canSave}>
            {busy ? 'हो रहा है…' : 'सेव करें'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
