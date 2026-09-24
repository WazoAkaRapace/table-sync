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
   * l'API renvoie {token, user} comme login — le refresh token, lui, arrive
   * en cookie HttpOnly posé par le serveur). Publique ici pour que la page
   * de reset branche le contexte sans dupliquer les clés localStorage.
   */
  adoptSession: (token: string, user: User) => void;
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
    const { token: t, user: u } = res.data;
    // Le refresh token ne vit plus ici : le serveur le pose en cookie
    // HttpOnly `ts_refresh` (champ JSON conservé pour les vieux bundles —
    // un éventuel héritage localStorage part à la purge).
    localStorage.setItem('dnd-inv-token', t);
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
      const { token: t, user: u } = res.data;
      localStorage.setItem('dnd-inv-token', t);
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
    // meurt. Le navigateur porte la preuve en cookie `ts_refresh` (posé
    // tout seul sur /api/auth) ; l'en-tête ne couvre que l'héritage
    // localStorage d'un bundle pré-cookie — clé absente = POST nu, le
    // serveur révoque le cookie et l'efface. Un échec réseau ne doit pas
    // empêcher la déconnexion locale : la ligne restera active jusqu'à
    // expiration (30 j), sans rotation elle est morte de facto côté client.
    const legacy = localStorage.getItem('dnd-inv-refresh');
    void api
      .post('/api/auth/logout', {}, legacy ? { headers: { 'x-refresh-token': legacy } } : {})
      .catch(() => {});
    purgeSession();
    setToken(null);
    setUser(null);
  }, []);

  const adoptSession = useCallback((t: string, u: User) => {
    localStorage.setItem('dnd-inv-token', t);
    // Plus de refresh token stocké (cookie serveur) : un héritage localStorage
    // d'une session précédente n'a plus lieu d'être.
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
