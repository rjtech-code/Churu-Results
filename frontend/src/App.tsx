import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireRole } from './components/RequireRole';
import { BoothEntryPage } from './pages/BoothEntryPage';
import { CorrectionPage } from './pages/CorrectionPage';
import { DeclarePage } from './pages/DeclarePage';
import { EntryEditPage } from './pages/EntryEditPage';
import { EntryVoidPage } from './pages/EntryVoidPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { PostalPage } from './pages/PostalPage';
import { DmPlaceholderPage, NotAllowedPage, NotFoundPage } from './pages/SimplePages';
import { WardDetailPage } from './pages/WardDetailPage';
import { WardListPage } from './pages/WardListPage';

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function Home() {
  const { user } = useAuth();
  if (user === undefined) return <p className="loading">लोड हो रहा है…</p>;
  if (user === null) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'DM' ? '/dm' : '/wards'} replace />;
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <Home /> },
      {
        element: <RequireRole roles={['PS_RO', 'ZP_RO']} />,
        children: [
          { path: '/wards', element: <WardListPage /> },
          { path: '/wards/:wardId', element: <WardDetailPage /> },
          { path: '/wards/:wardId/booths/:boothId/entry', element: <BoothEntryPage /> },
          { path: '/wards/:wardId/postal', element: <PostalPage /> },
          { path: '/wards/:wardId/declare', element: <DeclarePage /> },
          { path: '/wards/:wardId/correction', element: <CorrectionPage /> },
          { path: '/entries/:entryId/edit', element: <EntryEditPage /> },
          { path: '/entries/:entryId/void', element: <EntryVoidPage kind="BOOTH" /> },
          { path: '/entries/:entryId/history', element: <HistoryPage kind="BOOTH" /> },
          { path: '/postal/:entryId/void', element: <EntryVoidPage kind="POSTAL" /> },
          { path: '/postal/:entryId/history', element: <HistoryPage kind="POSTAL" /> },
        ],
      },
      {
        element: <RequireRole roles={['DM']} />,
        children: [{ path: '/dm', element: <DmPlaceholderPage /> }],
      },
      {
        element: <RequireRole roles={['PS_RO', 'ZP_RO', 'DM']} />,
        children: [{ path: '/not-allowed', element: <NotAllowedPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
