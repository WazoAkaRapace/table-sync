import type { User } from '@table-sync/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { purgeSession, restoreSession, setAccessToken } from './api';
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
   * l'API renvoie {token, user} comme login — le refresh token, lui, arrive
   * en cookie HttpOnly posé par le serveur). Publique ici pour que la page
   * de reset branche le contexte sans dupliquer les clés localStorage.
   */
  adoptSession: (token: string, user: User) => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot : PLUS AUCUN jeton sur disque à lire — la session survit aux
  // rechargements par les DEUX cookies HttpOnly du serveur. Le cache user
  // (objet non-secret) dit seulement « on croyait avoir une session » : on
  // échange le cookie ts_access contre un JWT mémoire (sans rotation), on
  // ne rafraîchit par ts_refresh que si l'échange échoue, puis /me valide
  // l'ensemble.
  useEffect(() => {
    const savedUser = localStorage.getItem('dnd-inv-user');
    if (!savedUser) {
      setLoading(false);
      return;
    }
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
    setUser(savedUserParsed);
    restoreSession()
      .then((restored) => {
        // null SANS purge = réseau coupé (ERR_NETWORK ≠ session invalide,
        // leçon tablette) : on garde l'UI dégradée sur le user caché —
        // requêtes et WS reprendront au retour du réseau. null AVEC purge =
        // session morte : l'intercepteur 401 a déjà redirigé vers /login.
        if (!restored) {
          if (!localStorage.getItem('dnd-inv-user')) {
            setToken(null);
            setUser(null);
          }
          return;
        }
        setToken(restored);
        // Session valide : /me rafraîchit le user (profil modifié ailleurs).
        return api
          .get('/api/auth/me')
          .then((res) => {
            setUser(res.data.user);
            localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
            // Visite guidée : convergence serveur ↔ cache AVANT que loading
            // passe à false — aucune page (donc aucun déclencheur de visite)
            // ne peut se monter avec un état périmé.
            syncTutorialWithServer(res.data.user);
          })
          .catch((err: any) => {
            if (err?.response?.status === 401) {
              purgeSession();
              setToken(null);
              setUser(null);
            }
          });
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/api/auth/login', { username, password });
    const { token: t, user: u } = res.data;
    // Le JWT ne vit qu'en mémoire (WS/images) ; les cookies HttpOnly posés
    // par le serveur portent la session. AUCUNE écriture localStorage de
    // jeton — les résidus de l'ère précédente partent ici.
    setAccessToken(t);
    localStorage.setItem('dnd-inv-user', JSON.stringify(u));
    localStorage.removeItem('dnd-inv-token');
    localStorage.removeItem('dnd-inv-refresh');
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
      const { token: t, user: u } = res.data;
      setAccessToken(t);
      localStorage.setItem('dnd-inv-user', JSON.stringify(u));
      localStorage.removeItem('dnd-inv-token');
      localStorage.removeItem('dnd-inv-refresh');
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
    // meurt, le navigateur porte la preuve en cookie `ts_refresh` (posé tout
    // seul sur /api/auth) et le serveur efface les deux cookies. Un échec
    // réseau ne doit pas empêcher la déconnexion locale : la ligne restera
    // active jusqu'à expiration (30 j), sans rotation elle est morte de
    // facto côté client.
    void api.post('/api/auth/logout', {}).catch(() => {});
    purgeSession();
    setToken(null);
    setUser(null);
  }, []);

  const adoptSession = useCallback((t: string, u: User) => {
    // Même contrat que login (reset de mot de passe = auto-login) : le JWT
    // en mémoire, les cookies posés par le serveur, et rien sur disque.
    setAccessToken(t);
    localStorage.removeItem('dnd-inv-token');
    localStorage.removeItem('dnd-inv-refresh');
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
