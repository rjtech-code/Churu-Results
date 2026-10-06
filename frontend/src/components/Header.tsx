import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HINDI, formatTime } from './format';

export function Header() {
  const { user, logout } = useAuth();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  if (!user) return null;
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        चूरू पंचायत चुनाव 2026 — मतगणना
      </Link>
      <div className="who">
        <strong>{user.fullName ?? user.username}</strong> · {ROLE_HINDI[user.role]}
        {user.panchayatSamiti ? ` · ${user.panchayatSamiti.name}` : ''}
      </div>
      <div className="clock" aria-label="समय">
        {formatTime(now)}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
        लॉगआउट
      </button>
    </header>
  );
}
