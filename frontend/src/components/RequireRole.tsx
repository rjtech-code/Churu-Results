import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Header } from './Header';

/** Pages for logged-in users of the given roles; others are sent to their own start page. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { user } = useAuth();
  if (user === undefined) return <p className="loading">लोड हो रहा है…</p>;
  if (user === null) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={user.role === 'DM' ? '/dm' : '/wards'} replace />;
  return (
    <>
      <Header />
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
