import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireRole } from './components/RequireRole';
import { ScreenApp } from './screens/ScreenApp';
import { BoothEntryPage } from './pages/BoothEntryPage';
import { CombinedEntryPage } from './pages/CombinedEntryPage';
import { CorrectionPage } from './pages/CorrectionPage';
import { DeclarePage } from './pages/DeclarePage';
import { EntryEditPage } from './pages/EntryEditPage';
import { EntryVoidPage } from './pages/EntryVoidPage';
import { StoryPage } from './pages/StoryPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { PostalPage } from './pages/PostalPage';
import { NotAllowedPage, NotFoundPage } from './pages/SimplePages';
import { ReportWardPage } from './pages/reports/ReportWardPage';
import { ReportsHomePage } from './pages/reports/ReportsHomePage';
import { BoothEditPage } from './pages/admin/BoothEditPage';
import { BoothsPage } from './pages/admin/BoothsPage';
import { CandidateAreaPage } from './pages/admin/CandidateAreaPage';
import { CandidateCheckPage } from './pages/admin/CandidateCheckPage';
import { CandidateUploadPage } from './pages/admin/CandidateUploadPage';
import { CandidatesHomePage } from './pages/admin/CandidatesHomePage';
import { PartiesPage } from './pages/admin/PartiesPage';
import { UserSeatPage } from './pages/admin/UserSeatPage';
import { UsersPage } from './pages/admin/UsersPage';
import { WardCategoryPage } from './pages/admin/WardCategoryPage';
import { RoCandidateWardPage } from './pages/candidates/RoCandidateWardPage';
import { RoCandidateWardsPage } from './pages/candidates/RoCandidateWardsPage';
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
  return <Navigate to={user.role === 'DM' ? '/reports' : '/wards'} replace />;
}

export const router = createBrowserRouter([
  // Media-room TV screens: public, outside the dashboard (no AuthProvider, no /api/auth, no header).
  { path: '/screen/:n', element: <ScreenApp /> },
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
          // Part 14: the PS desk's combined PS + ZP parchi (the server refuses anyone but that PS_RO).
          { path: '/booths/:boothId/entry', element: <CombinedEntryPage /> },
          { path: '/wards/:wardId/postal', element: <PostalPage /> },
          { path: '/wards/:wardId/postal/history', element: <StoryPage kind="POSTAL" /> },
          { path: '/wards/:wardId/booths/:boothId/history', element: <StoryPage kind="BOOTH" /> },
          { path: '/wards/:wardId/declare', element: <DeclarePage /> },
          { path: '/wards/:wardId/correction', element: <CorrectionPage /> },
          { path: '/entries/:entryId/edit', element: <EntryEditPage /> },
          { path: '/entries/:entryId/void', element: <EntryVoidPage kind="BOOTH" /> },
          { path: '/entries/:entryId/history', element: <HistoryPage kind="BOOTH" /> },
          { path: '/postal/:entryId/void', element: <EntryVoidPage kind="POSTAL" /> },
          { path: '/postal/:entryId/history', element: <HistoryPage kind="POSTAL" /> },
          // Part 13: the RO's candidate lists.
          { path: '/candidates', element: <RoCandidateWardsPage /> },
          { path: '/candidates/:wardId', element: <RoCandidateWardPage /> },
        ],
      },
      {
        element: <RequireRole roles={['DM']} denied="not-allowed" />,
        // DM reports (Part 10). Other roles opening these URLs get the "not allowed" page.
        children: [
          { path: '/reports', element: <ReportsHomePage /> },
          { path: '/reports/wards/:wardId', element: <ReportWardPage /> },
          { path: '/dm', element: <Navigate to="/reports" replace /> },
          // Part 13: the DM's master-data tools (never votes, entries, declare or correction).
          { path: '/admin/parties', element: <PartiesPage /> },
          { path: '/admin/candidates', element: <CandidatesHomePage /> },
          { path: '/admin/candidates/upload', element: <CandidateUploadPage /> },
          { path: '/admin/candidates/check', element: <CandidateCheckPage /> },
          { path: '/admin/candidates/check/:area', element: <CandidateAreaPage /> },
          { path: '/admin/users', element: <UsersPage /> },
          { path: '/admin/users/:seat', element: <UserSeatPage /> },
          { path: '/admin/booths', element: <BoothsPage /> },
          { path: '/admin/booths/:psId/:boothId', element: <BoothEditPage /> },
          { path: '/admin/wards/:psId', element: <WardCategoryPage /> },
        ],
      },
      {
        element: <RequireRole roles={['PS_RO', 'ZP_RO', 'DM']} />,
        children: [{ path: '/not-allowed', element: <NotAllowedPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
