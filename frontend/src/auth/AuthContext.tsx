import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, fetchCsrf, resetCsrf, setSessionLostHandler } from '../api/api';
import { ERROR_MESSAGES } from '../api/errors';
import type { Me } from '../api/types';

interface AuthState {
  /** undefined while the first /me check runs; null when logged out. */
  user: Me | null | undefined;
  /** Message for the login page (e.g. session expired). */
  notice: string | null;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // A lost session anywhere: forget everything and go to the login page with the reason.
    setSessionLostHandler((code) => {
      setUser(null);
      const message = ERROR_MESSAGES[code];
      setNotice(typeof message === 'string' ? message : null);
      void navigate('/login', { replace: true });
    });
    return () => {
      setSessionLostHandler(null);
    };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    api<Me>('GET', '/api/auth/me').then(
      (me) => {
        if (!cancelled) setUser(me);
      },
      () => {
        if (!cancelled) setUser(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    resetCsrf();
    await fetchCsrf();
    const me = await api<Me>('POST', '/api/auth/login', { username, password });
    resetCsrf(); // the server issues a new token on login
    setUser(me);
    setNotice(null);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/auth/logout');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    resetCsrf();
    setUser(null);
    void navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      notice,
      login,
      logout,
      clearNotice: () => {
        setNotice(null);
      },
    }),
    [user, notice, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
