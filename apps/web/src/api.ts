import axios from 'axios';
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

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dnd-inv-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Payloads mono-locale : l'API sert la langue demandée, jamais les deux.
  config.headers['Accept-Language'] = appLang();
  return config;
});

// ---------------------------------------------------------------------------
// Session : rafraîchissement transparent + purge centrale
// ---------------------------------------------------------------------------

/**
 * Les trois clés localStorage de la session locale. « dnd-inv-refresh » est
 * un HÉRITAGE de l'ère localStorage (PR #127) : la preuve de refresh vit
 * désormais dans le cookie HttpOnly `ts_refresh` posé par le serveur — la
 * clé n'est plus lue que pour la transition et purgée avec le reste.
 */
const SESSION_KEYS = ['dnd-inv-token', 'dnd-inv-refresh', 'dnd-inv-user'] as const;

/** Purge centrale : la session locale disparaît ENTIERE (JWT + refresh + user). */
export function purgeSession(): void {
  for (const key of SESSION_KEYS) localStorage.removeItem(key);
}

// Single-flight : un seul /api/auth/refresh par onglet à la fois — les 401
// simultanés (boot + requêtes en vol) partagent la même promesse. La
// rotation serveur est intégrale (un jeton consommé ne ressert jamais),
// deux appels concurrents du MÊME jeton déclencheraient le family kill.
let refreshing: Promise<string | null> | null = null;

/**
 * Rafraîchit la session (rotation 30 j glissants) : le cookie HttpOnly
 * `ts_refresh` voyage tout seul sur /api/auth (same-origin — le JS ne sait
 * même pas s'il existe, on laisse le serveur en décider), pose le couple
 * JWT/user dans localStorage et retourne le JWT neuf — ou null si la
 * session est morte (tout est déjà purgé).
 *
 * Transition one-shot : une session de l'ère localStorage garde son jeton
 * en `dnd-inv-refresh` ; il part en en-tête UNE fois, puis la clé
 * disparaît au succès — le cookie devient l'unique preuve.
 */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    const legacy = localStorage.getItem('dnd-inv-refresh');
    try {
      // axios NU (pas cette instance) : l'intercepteur 401 ci-dessous
      // s'enroulerait sur son propre rafraîchissement.
      const res = await axios.post(
        `${API_BASE}/api/auth/refresh`,
        {},
        {
          headers: {
            'Accept-Language': appLang(),
            ...(legacy ? { 'x-refresh-token': legacy } : {}),
          },
          timeout: 15_000,
        },
      );
      localStorage.setItem('dnd-inv-token', res.data.token);
      localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
      if (legacy) localStorage.removeItem('dnd-inv-refresh');
      return res.data.token as string;
    } catch (err: any) {
      // 401 = jeton inconnu/expiré/révoqué (family kill inclus) ; 400 =
      // aucune preuve présentée (ni cookie, ni héritage localStorage) :
      // la session est morte dans les deux cas, on purge. Tout autre échec
      // (réseau coupé, timeout) n'en dit rien — ERR_NETWORK ≠ session
      // invalide (leçon tablette) : le localStorage reste en place, le
      // prochain rafraîchissement repartira de zéro quand le réseau reviendra.
      if (err?.response?.status === 401 || err?.response?.status === 400) purgeSession();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Auto-logout on 401 — sauf si la session peut être prolongée : le JWT (7 j)
// peut expirer en pleine session, on tente le refresh d'abord (transparent
// pour la page appelante : la promesse résolue est celle de la requête
// REJOUÉE avec le jeton neuf). Le garde localStorage = « on croyait avoir
// une session » : les 401 des requêtes parties SANS jeton (mauvais mot de
// passe sur /login) ne déclenchent rien — le cookie HttpOnly, lui, est
// invisible du JS, c'est le serveur qui tranche.
api.interceptors.response.use(
  (res) => res,
  async (err: any) => {
    const status: number | undefined = err?.response?.status;
    const cfg: any = err?.config;
    if (status === 401 && !cfg?._retried && localStorage.getItem('dnd-inv-token')) {
      const token = await refreshSession();
      if (token) {
        cfg._retried = true; // un seul rafraîchissement par requête, jamais de boucle
        cfg.headers.Authorization = `Bearer ${token}`;
        return api(cfg);
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
 * as the /ws socket). Pass `version` = Item.imageRev (file mtime+size, served
 * in every payload) so the URL CHANGES when the image is re-written — a
 * re-render alone never re-requests an <img> whose src didn't change (leçon
 * 2026-08-23 : la 2e annotation passait côté serveur, personne ne la revoyait).
 * Same param doubles as the Réessayer cache-buster (bump counter).
 * The response is ETag + no-cache : le cache sert, chaque URL neuve revalide.
 */
export function itemImageUrl(itemId: number, version?: number | string): string {
  const token = encodeURIComponent(localStorage.getItem('dnd-inv-token') ?? '');
  const suffix = version != null && version !== '' ? `&v=${version}` : '';
  return `${API_BASE}/api/items/${itemId}/image?token=${token}${suffix}`;
}
