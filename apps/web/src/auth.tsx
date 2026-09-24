import type { User } from '@table-sync/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { purgeSession } from './api';
import { syncTutorialWithServer } from './tutorial/serverSync';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
    email: string,
  ) => Promise<void>;
  logout: () => void;
  /** Recharge l'utilisateur courant depuis /me (profil modifié ailleurs). */
  refreshUser: () => Promise<User>;
  /**
   * Adopte une session déjà authentifiée (réinitialisation de mot de passe :
   * l'API renvoie {token, refreshToken, user} comme login). Publique ici pour
   * que la page de reset branche le contexte sans dupliquer les clés
   * localStorage.
   */
  adoptSession: (token: string, user: User, refreshToken?: string) => void;
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
        purgeSession();
        setToken(null);
        setUser(null);
        setLoading(false);
        return;
      }
      setToken(savedToken);
      setUser(savedUserParsed);
      // Verify token is still valid. JWT expiré mais refresh token valide :
      // l'intercepteur 401 de api.ts rafraîchit ET rejoue /me — la promesse
      // résolue ici est déjà celle de la requête sauvée.
      api
        .get('/api/auth/me')
        .then((res) => {
          setUser(res.data.user);
          localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
          // Visite guidée : convergence serveur ↔ localStorage AVANT que
          // loading passe à false — aucune page (donc aucun déclencheur de
          // visite) ne peut se monter avec un état périmé.
          syncTutorialWithServer(res.data.user);
        })
        .catch((err: any) => {
          // Ne purger la session QUE sur un 401 réel (jeton expiré, refresh
          // impossible — l'intercepteur a déjà essayé) : ouvrir la PWA dans
          // un trou réseau doit garder la session cachée, pas déconnecter le
          // joueur (leçon tablette : ERR_NETWORK ≠ session invalide).
          // L'utilisateur localStorage est conservé — /me sera rejoué au
          // prochain lancement.
          if (err?.response?.status === 401) {
            purgeSession();
            setToken(null);
            setUser(null);
          } else {
            setToken(savedToken);
            setUser(savedUserParsed);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/api/auth/login', { username, password });
    const { token: t, refreshToken: rt, user: u } = res.data;
    localStorage.setItem('dnd-inv-token', t);
    // Garde de déploiement : un API sans refresh tokens (version précédente)
    // ne renvoie pas la clé — on garde la session JWT seule plutôt que de
    // stocker « undefined ».
    if (rt) localStorage.setItem('dnd-inv-refresh', rt);
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const register = useCallback(
    async (username: string, password: string, displayName: string, email: string) => {
      const res = await api.post('/api/auth/register', {
        username,
        password,
        displayName,
        email,
      });
      const { token: t, refreshToken: rt, user: u } = res.data;
      localStorage.setItem('dnd-inv-token', t);
      if (rt) localStorage.setItem('dnd-inv-refresh', rt);
      localStorage.setItem('dnd-inv-user', JSON.stringify(u));
      setToken(t);
      setUser(u);
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const res = await api.get('/api/auth/me');
    const u = res.data.user as User;
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    // Révocation serveur fire-and-forget : le refresh token de CET appareil
    // meurt (en-tête plutôt que corps — la route est publique, sans JWT).
    // Un échec réseau ne doit pas empêcher la déconnexion locale : la ligne
    // restera active jusqu'à expiration (30 j), sans rotation elle est morte
    // de facto côté client.
    const rt = localStorage.getItem('dnd-inv-refresh');
    if (rt) {
      void api.post('/api/auth/logout', {}, { headers: { 'x-refresh-token': rt } }).catch(() => {});
    }
    purgeSession();
    setToken(null);
    setUser(null);
  }, []);

  const adoptSession = useCallback((t: string, u: User, rt?: string) => {
    localStorage.setItem('dnd-inv-token', t);
    if (rt) localStorage.setItem('dnd-inv-refresh', rt);
    else localStorage.removeItem('dnd-inv-refresh');
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, logout, refreshUser, adoptSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
