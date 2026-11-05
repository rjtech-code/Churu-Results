import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandPanel } from './login/BrandPanel';
import { LoginCard } from './login/LoginCard';
import { homePath } from '../auth/home';
import { SiteFooter } from '../components/SiteFooter';

export function LoginPage({ superAdmin = false }: { superAdmin?: boolean }) {
  const { user } = useAuth();

  if (user) return <Navigate to={homePath(user.role)} replace />;

  return (
    <div className="site-shell login-shell">
      <main className="login-page">
        <LoginCard superAdmin={superAdmin} />
        <BrandPanel />
      </main>
      <SiteFooter />
    </div>
  );
}
