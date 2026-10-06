import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/api';
import { messageFor } from '../api/errors';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login, notice } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'DM' ? '/dm' : '/wards'} replace />;

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const typed = password;
    setPassword(''); // the password is not kept longer than the request
    try {
      const me = await login(username.trim(), typed);
      void navigate(me.role === 'DM' ? '/dm' : '/wards', { replace: true });
    } catch (err) {
      // A malformed username is just "wrong username or password" for the operator.
      setError(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED'
          ? 'गलत यूज़रनेम या पासवर्ड'
          : messageFor(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1>चूरू पंचायत चुनाव 2026</h1>
      <h2>मतगणना डैशबोर्ड — लॉगिन</h2>
      {notice && (
        <div className="msg msg-warn" role="status">
          ! {notice}
        </div>
      )}
      {error && (
        <div className="msg msg-error" role="alert">
          ✗ {error}
        </div>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="login-form">
        <label htmlFor="username">यूज़रनेम</label>
        <input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          autoFocus
        />
        <label htmlFor="password">पासवर्ड</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || username === '' || password === ''}
        >
          {busy ? 'जाँच हो रही है…' : 'लॉगिन करें'}
        </button>
      </form>
    </main>
  );
}
