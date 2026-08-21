import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

/**
 * Session state lives entirely in the httpOnly cookie; this provider just asks
 * the server who we are on mount. Nothing about the user is cached in
 * localStorage, so signing out on the server signs out everywhere.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      setStatus('authenticated');
      setError(null);
      return data.user;
    } catch (err) {
      setUser(null);
      setStatus('anonymous');
      // A 401 is the normal "not signed in" answer, not a failure worth showing.
      setError(err.status === 401 || err.status === 0 ? null : err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    // Full page navigation: the OAuth handshake happens on the server.
    window.location.href = authApi.loginUrl();
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, error, isLoading: status === 'loading', refresh, login, logout }),
    [user, status, error, refresh, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
