// The Super Admin shell: the same refined institutional surface as the observer dashboard
// (tokens.css — deep navy, warm ivory, muted gold), never the operator header, so the setup panel
// cannot be mistaken for a counting screen. SUPER_ADMIN only; every other role is sent to its own
// start page, exactly as before (the server is the authority either way).
//
// The Guide (/guide) belongs to BOTH the Super Admin and the DM. RequireSetupPage keeps that
// unchanged: the Super Admin sees it in this shell, the DM in the operator shell as always.
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { homePath } from '../../auth/home';
import { RequireRole } from '../../components/RequireRole';
import { SiteFooter } from '../../components/SiteFooter';
import '../../styles/superadmin.css';

const NAV: readonly (readonly [string, string])[] = [
  ['/superadmin', 'सेटअप पैनल'],
  ['/guide', 'Guide'],
];

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="sa-shell">
      <header className="sa-topbar no-print">
        <div className="sa-topbar-inner">
          <NavLink to="/superadmin" className="sa-brand" end>
            <span className="sa-brand-name">Super Admin</span>
            <span className="sa-brand-sub">चूरू पंचायत चुनाव 2026 — setup panel</span>
          </NavLink>
          <div className="sa-topbar-tools">
            <span className="sa-who" title={user?.username}>
              <span className="sa-who-label">लॉगिन</span>
              <span className="sa-who-name">{user?.fullName ?? user?.username}</span>
            </span>
            <button
              type="button"
              className="sa-topbtn"
              onClick={() => {
                void logout();
              }}
            >
              लॉगआउट
            </button>
          </div>
        </div>
        <nav className="sa-nav" aria-label="मुख्य मेनू">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/superadmin'}
              className={({ isActive }) => `sa-navitem${isActive ? ' active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="sa-main">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

/** SUPER_ADMIN-only pages under the Super Admin shell. */
export function RequireSuperAdmin() {
  const { user } = useAuth();
  if (user === undefined) return <p className="loading">लोड हो रहा है…</p>;
  if (user === null) return <Navigate to="/login" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to={homePath(user.role)} replace />;
  return <Shell />;
}

/**
 * A page both setup roles may open (the Guide): the Super Admin gets this shell, the DM the
 * operator shell it has always had. Who may open it does not change.
 */
export function RequireSetupPage() {
  const { user } = useAuth();
  if (user?.role === 'SUPER_ADMIN') return <Shell />;
  return <RequireRole roles={['DM', 'SUPER_ADMIN']} />;
}
