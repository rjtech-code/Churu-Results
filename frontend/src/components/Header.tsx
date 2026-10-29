import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HINDI, formatTime } from './format';

const DM_MENU = [
  ['/reports', 'रिपोर्ट'],
  ['/admin/candidates', 'उम्मीदवार सूची'],
  ['/admin/users', 'RO सूची'],
  ['/admin/booths', 'बूथ / वार्ड'],
  ['/admin/parties', 'पार्टी सूची'],
] as const;
const SUPER_ADMIN_MENU = [
  ['/superadmin', 'Super Admin'],
  ['/guide', 'Guide'],
] as const;
const RO_MENU = [
  ['/wards', 'मेरे वार्ड'],
  ['/candidates', 'उम्मीदवार'],
] as const;

/** The menu: at most 5 plain items, always visible (no hidden menus). */
function Menu({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <nav className="mainnav no-print" aria-label="मुख्य मेनू">
      {items.map(([to, label]) => (
        <NavLink key={to} to={to} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

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
      {/* In the header row itself: the menu takes no extra height (forms must fit one screen). */}
      <Menu items={user.role === 'DM' ? DM_MENU : user.role === 'SUPER_ADMIN' ? SUPER_ADMIN_MENU : RO_MENU} />
      <div className="who">
        {user.role === 'DM' ? (
          <Link to="/profile" className="who-link" title="मेरी प्रोफ़ाइल">
            <strong>{user.fullName ?? user.username}</strong>
          </Link>
        ) : (
          <strong>{user.fullName ?? user.username}</strong>
        )}{' '}
        · {ROLE_HINDI[user.role]}
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
