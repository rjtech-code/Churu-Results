import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/api';
import { messageFor } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { LoginAlert } from './LoginAlert';
import { LOGIN_TEXTS as T } from './loginTexts';
import { PasswordInput } from './PasswordInput';

export function LoginCard() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const typed = password;
    setPassword(''); // the password is not kept longer than the request
    try {
      const me = await login(username.trim(), typed);
      void navigate(me.role === 'DM' ? '/reports' : '/wards', { replace: true });
    } catch (err) {
      // A malformed username is just "wrong username or password" for the operator.
      setError(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? T.wrongCredentials : messageFor(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login-card" aria-labelledby="login-title">
      <h1 id="login-title" lang="en">
        {T.cardTitleEn}
      </h1>
      <p className="login-help" lang="en">
        {T.cardHelpEn}
      </p>
      {notice && <LoginAlert kind="warn" text={notice} />}
      {error && <LoginAlert kind="error" text={error} />}
      <form
        onSubmit={(e) => {
          setShowPassword(false); // never leave a password visible on a shared counting-room screen
          void onSubmit(e);
        }}
        className="login-form"
      >
        <label htmlFor="username">{T.username}</label>
        <input
          id="username"
          className="login-input"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          autoFocus
        />
        <label htmlFor="password">{T.password}</label>
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          shown={showPassword}
          onToggle={() => {
            setShowPassword((v) => !v);
          }}
        />
        <button
          type="submit"
          className="login-submit"
          aria-busy={busy}
          disabled={busy || username === '' || password === ''}
        >
          {busy && <span className="login-spinner" aria-hidden="true" />}
          {busy ? T.submitBusy : T.submit}
        </button>
      </form>
    </section>
  );
}
