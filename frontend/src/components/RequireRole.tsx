import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Header } from './Header';
import { RoTabs, RoTabsProvider, useTabsInHeader } from './RoTabs';
import { SiteFooter } from './SiteFooter';
import { homePath } from '../auth/home';

/** Pages for logged-in users of the given roles; others are sent to their own start page. */
export function RequireRole({
  roles,
  denied = 'redirect',
}: {
  roles: readonly Role[];
  /** Wrong role: 'redirect' to the user's own start page, or show the "not allowed" page. */
  denied?: 'redirect' | 'not-allowed';
}) {
  const { user } = useAuth();
  const tabsInHeader = useTabsInHeader();
  if (user === undefined) return <p className="loading">लोड हो रहा है…</p>;
  if (user === null) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return <Navigate to={denied === 'not-allowed' ? '/not-allowed' : homePath(user.role)} replace />;
  }
  return (
    <RoTabsProvider>
      <div className="site-shell">
        <Header />
        {/* Only the PS_RO has both lists (PS wards and the ZP wards of its booths). On wide screens
            the tabs are in the header row instead (Header). */}
        {user.role === 'PS_RO' && !tabsInHeader && <RoTabs placement="bar" />}
        <main className="page">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </RoTabsProvider>
  );
}
