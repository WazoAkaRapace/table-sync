import axios from 'axios';
import { useEffect, useState } from 'react';
import { appLang } from './i18n';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
  // Une requête ne doit jamais tourner à l'infini : sur une radio black-holeée,
  // le défaut axios (0 = attendre) laissait des spinners et des lignes
  // « busy » bloquées jusqu'au timeout TCP de l'OS (des minutes). Les appels
  // légitimement longs (uploads multipart, refresh externes) passent un
  // timeout par requête plus généreux.
  timeout: 15_000,
});

// Attach JWT token to every request. Le JWT ne vit qu'en MÉMOIRE module :
// la preuve persistante est le cookie HttpOnly `ts_access` que le navigateur
// pose tout seul (same-origin) — sans jeton mémoire, pas d'en-tête, la
// requête s'authentifie par cookie.
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Payloads mono-locale : l'API sert la langue demandée, jamais les deux.
  config.headers['Accept-Language'] = appLang();
  return config;
});

// ---------------------------------------------------------------------------
// Session : JWT mémoire + cookies serveur, rafraîchissement transparent
// ---------------------------------------------------------------------------

/**
 * Le JWT d'accès courant — MÉMOIRE SEULE, jamais sur disque (la bascule
 * « plus aucun matériau d'auth en localStorage »). Les cookies HttpOnly
 * posés par le serveur (ts_access sur /api, ts_refresh sur /api/auth)
 * portent la session au rechargement ; ce jeton mémoire n'est que le
 * souvenir de la dernière réponse login/refresh/token de CET onglet.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Les résidus localStorage de l'ère pré-cookie (« dnd-inv-token »,
 * « dnd-inv-refresh » — PR #127) ne sont plus lus : purge one-shot au
 * premier login/refresh de la nouvelle génération. « dnd-inv-user » (objet
 * non-secret, cache d'UI) reste le seul voisin toléré.
 */
const LEGACY_TOKEN_KEYS = ['dnd-inv-token', 'dnd-inv-refresh'] as const;

function purgeLegacyTokenKeys(): void {
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
}

/**
 * Purge centrale : la session locale disparaît ENTIERE (cache user + résidus
 * de jetons) et la mémoire du JWT est remise à zéro.
 */
export function purgeSession(): void {
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('dnd-inv-user');
  accessToken = null;
}

// Single-flight : un seul échange à la fois par onglet — les 401 simultanés
// (boot + requêtes en vol) partagent la même promesse. La rotation serveur
// est intégrale (un refresh token consommé ne ressert jamais), deux appels
// concurrents du MÊME jeton déclencheraient le family kill.
let exchanging: Promise<string | null> | null = null;

/**
 * Échange le cookie `ts_access` contre un JWT lisible : GET /api/auth/token
 * (authentifiée par le cookie — le header mémoire part aussi quand il
 * existe, le serveur préfère l'un puis l'autre). C'est le chemin des
 * consommateurs qui ont BESOIN du jeton en clair (WS, URLs d'images) et du
 * boot : PAS de rotation du refresh token ici, le cookie 24 h suffit —
 * rafraîchir à chaque reconnexion ferait tourner le refresh token pour
 * rien et ouvrirait la course multi-onglets. Si le cookie a expiré, le 401
 * remonte à l'intercepteur ci-dessous qui rafraîchit PUIS REJOUE l'appel.
 * `force` outrepasse le court-circuit mémoire (la WS veut un jeton NEUF
 * quand le sien touche à son expiration, pas le même périmé).
 */
export function fetchAccessToken(force = false): Promise<string | null> {
  if (accessToken && !force) return Promise.resolve(accessToken);
  exchanging ??= api
    .get('/api/auth/token')
    .then((res) => {
      const token = res.data?.token as string | undefined;
      if (token) accessToken = token;
      return token ?? null;
    })
    .catch(() => null)
    .finally(() => {
      exchanging = null;
    });
  return exchanging;
}

// Single-flight du refresh (rotation 30 j glissants) — même raison d'être.
let refreshing: Promise<string | null> | null = null;

/**
 * Verdict du DERNIER refreshSession() : « définitif » = le serveur de
 * refresh a répondu 401 (preuve vue et refusée — session morte pour de
 * bon). Toute autre issue (succès, 400 sans preuve, réseau coupé) laisse
 * la session en vie. L'intercepteur 401 consulte ce drapeau pour décider
 * s'il purge + redirige : une requête qui échoue pour une raison
 * transitoire ne doit JAMAIS détruire une session encore valide.
 */
let lastRefreshDefinitive = false;

function refreshSessionWasDefinitive(): boolean {
  return lastRefreshDefinitive;
}

/**
 * Rafraîchit la session (rotation 30 j glissants) : le cookie HttpOnly
 * `ts_refresh` voyage tout seul sur /api/auth (same-origin — le JS ne sait
 * même pas s'il existe, on laisse le serveur en décider), la réponse pose
 * le JWT en mémoire + l'user en cache et retourne le jeton neuf — ou null
 * si la session est morte (tout est déjà purgé).
 */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    lastRefreshDefinitive = false;
    try {
      // axios NU (pas cette instance) : l'intercepteur 401 ci-dessous
      // s'enroulerait sur son propre rafraîchissement.
      const res = await axios.post(
        `${API_BASE}/api/auth/refresh`,
        {},
        { headers: { 'Accept-Language': appLang() }, timeout: 15_000 },
      );
      accessToken = res.data.token as string;
      localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
      purgeLegacyTokenKeys();
      return accessToken;
    } catch (err: any) {
      // LE point critique — trois cas, pas deux :
      //  • 401 = le serveur a VU notre preuve et l'a refusée (révoquée,
      //    expirée, family kill) : session morte, purge.
      //  • 400 = aucune preuve présentée (pas de cookie ts_refresh). En
      //    théorie « session morte »… sauf que ce cas frappe aussi des
      //    contextes légitimes SANS refresh cookie (suite de test avec
      //    ts_access seul, navigateur qui a perdu le cookie de subrange).
      //    Détruire la session là-dessus est un faux positif : on garde la
      //    session, l'utilisateur repassera par login à la vraie expiration
      //    du JWT (24 h) — le 401 finira par arriver avec sa preuve.
      //  • réseau/timeout : n'en dit rien (leçon tablette) — rien à faire.
      if (err?.response?.status === 401) {
        lastRefreshDefinitive = true;
        purgeSession();
      }
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Restaure la session au boot : d'abord l'échange à sens unique (cookie →
 * JWT mémoire, sans rotation), et seulement s'il échoue le refresh par
 * ts_refresh. Retourne le JWT mémoire, ou null (session morte OU réseau
 * coupé — l'appelant distingue en relisant le cache user, purgé seulement
 * dans le premier cas).
 */
export async function restoreSession(): Promise<string | null> {
  return (await fetchAccessToken()) ?? refreshSession();
}

// Auto-logout on 401 — sauf si la session peut être prolongée : le JWT (24 h)
// peut expirer en pleine session, on tente le refresh d'abord (transparent
// pour la page appelante : la promesse résolue est celle de la requête
// REJOUÉE avec le jeton neuf). Le garde « on croyait avoir une session » =
// un jeton en mémoire OU un user en cache : les 401 des requêtes parties
// sans session (mauvais mot de passe sur /login) ne déclenchent rien — le
// cookie HttpOnly, lui, est invisible du JS, c'est le serveur qui tranche.
api.interceptors.response.use(
  (res) => res,
  async (err: any) => {
    const status: number | undefined = err?.response?.status;
    const cfg: any = err?.config;
    const believedSession = accessToken !== null || !!localStorage.getItem('dnd-inv-user');
    if (status === 401 && !cfg?._retried && believedSession) {
      try {
        const token = await refreshSession();
        if (token) {
          cfg._retried = true; // un seul rafraîchissement par requête, jamais de boucle
          cfg.headers.Authorization = `Bearer ${token}`;
          return api(cfg);
        }
      } catch {
        /* refreshSession n'échoue jamais lui-même (catch interne) — ceinture
           et bretelles si un futur refactor casse ce contrat. */
      }
      // Refresh REFUSÉ (401 réel du serveur de refresh) : la session est
      // morte, purge + login. Refresh INDETERMINÉ (réseau) ou SANS preuve
      // (400) : NE PAS détruire la session — on rejette la requête telle
      // quelle ; l'app vit son état dégradé habituel (retry réseau, ou
      // re-login quand un 401 authentifié finira par arriver).
      if (!refreshSessionWasDefinitive()) {
        return Promise.reject(err);
      }
    }
    if (status === 401) {
      purgeSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export default api;

/** Same base as the axios instance — used for direct URLs (<img src>). */
export const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Authenticated URL of an item illustration. An <img> tag cannot send the
 * Authorization header, so the JWT rides in the query string (same contract
 * as the /ws socket). Le JWT vient de la MÉMOIRE (ou de `token`, résolu par
 * useAccessJwt) — jamais de localStorage. Pass `version` = Item.imageRev
 * (file mtime+size, served in every payload) so the URL CHANGES when the
 * image is re-written — a re-render alone never re-requests an <img> whose
 * src didn't change (leçon 2026-08-23 : la 2e annotation passait côté
 * serveur, personne ne la revoyait).
 * Same param doubles as the Réessayer cache-buster (bump counter).
 * The response is ETag + no-cache : le cache sert, chaque URL neuve revalide.
 */
export function itemImageUrl(
  itemId: number,
  version?: number | string,
  token?: string | null,
): string {
  const jwt = encodeURIComponent(token ?? accessToken ?? '');
  const suffix = version != null && version !== '' ? `&v=${version}` : '';
  return `${API_BASE}/api/items/${itemId}/image?token=${jwt}${suffix}`;
}

/**
 * Résout le JWT mémoire pour le rendu courant — et s'il est absent (boot
 * offline, mémoire perdue), déclenche l'échange GET /api/auth/token puis
 * re-rend le composant quand le jeton arrive. Les consommateurs d'URLs
 * authentifiées (<img> d'illustrations) le passent à itemImageUrl : jeton
 * null = URL sans preuve (échec propre + Réessayer), jamais un await dans
 * le rendu.
 */
export function useAccessJwt(): string | null {
  const [jwt, setJwt] = useState<string | null>(accessToken);
  useEffect(() => {
    if (accessToken) {
      setJwt(accessToken);
      return;
    }
    let alive = true;
    void fetchAccessToken().then((token) => {
      if (alive && token) setJwt(token);
    });
    return () => {
      alive = false;
    };
    // Résolution one-shot au montage : fetchAccessToken est single-flight
    // module et l'écriture mémoire ne versionne aucun état externe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return jwt;
}
