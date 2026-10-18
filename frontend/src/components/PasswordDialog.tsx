import { useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { ErrorBox } from './ErrorBox';
import { Modal } from './Modal';
import { ReauthPasswordField } from './ReauthPasswordField';

/**
 * Confirmation box for a sensitive action: one sentence saying what will happen, optional extra
 * fields (reason, name, "LOCK"), and the user's password typed again. The password is cleared after
 * every try and never kept. "रुकें" (the safe choice) is first and is what Esc does.
 * askPassword={false}: the same box as a plain "are you sure?" (onConfirm gets an empty string).
 */
export function PasswordDialog({
  title,
  explain,
  confirmLabel,
  danger = false,
  canConfirm = true,
  askPassword = true,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  /** One sentence: what will happen. */
  explain: string;
  confirmLabel: string;
  danger?: boolean;
  /** Extra fields complete? (The password is checked here.) */
  canConfirm?: boolean;
  /** false: no password field (a plain confirmation). */
  askPassword?: boolean;
  /** Runs the action; throw to show the error and stay open. */
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (askPassword && password === '') {
      setError('अपना पासवर्ड लिखें');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err);
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Modal label={title} onCancel={onCancel}>
      <form className="password-dialog" onSubmit={(e) => void submit(e)}>
        <h2>{title}</h2>
        <p className="big-explain">{explain}</p>
        {children}
        {askPassword && (
          <div className="field">
            <ReauthPasswordField id="confirm-password" value={password} onChange={setPassword} />
          </div>
        )}
        <ErrorBox error={error} />
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-big" onClick={onCancel} disabled={busy}>
            रुकें
          </button>
          <button
            type="submit"
            className={`btn btn-big ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy || !canConfirm}
          >
            {busy ? 'हो रहा है…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
