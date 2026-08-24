import type { User } from '@table-sync/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('dnd-inv-token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('dnd-inv-token');
    const savedUser = localStorage.getItem('dnd-inv-user');
    if (savedToken && savedUser) {
      // localStorage corrompu (écriture partielle, quota, etc.) : sans ce garde,
      // JSON.parse lèverait au montage et blanchirait définitivement l'écran.
      let savedUserParsed: User;
      try {
        savedUserParsed = JSON.parse(savedUser) as User;
      } catch (err) {
        console.warn(
          'Session locale illisible (« dnd-inv-user ») — clé supprimée, reconnexion nécessaire.',
          err instanceof Error ? err.message : err,
        );
        localStorage.removeItem('dnd-inv-user');
        localStorage.removeItem('dnd-inv-token');
        setToken(null);
        setUser(null);
        setLoading(false);
        return;
      }
      setToken(savedToken);
      setUser(savedUserParsed);
      // Verify token is still valid
      api
        .get('/api/auth/me')
        .then((res) => {
          setUser(res.data.user);
          localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
        })
        .catch(() => {
          localStorage.removeItem('dnd-inv-token');
          localStorage.removeItem('dnd-inv-user');
          setToken(null);
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/api/auth/login', { username, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem('dnd-inv-token', t);
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string) => {
    const res = await api.post('/api/auth/register', { username, password, displayName });
    const { token: t, user: u } = res.data;
    localStorage.setItem('dnd-inv-token', t);
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('dnd-inv-token');
    localStorage.removeItem('dnd-inv-user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
