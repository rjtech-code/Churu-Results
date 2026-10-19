import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandPanel } from './login/BrandPanel';
import { LoginCard } from './login/LoginCard';

export function LoginPage() {
  const { user } = useAuth();

  if (user) return <Navigate to={user.role === 'DM' ? '/reports' : '/wards'} replace />;

  return (
    <main className="login-page">
      <LoginCard />
      <BrandPanel />
    </main>
  );
}
