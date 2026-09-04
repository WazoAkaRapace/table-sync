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

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('dnd-inv-token');
      localStorage.removeItem('dnd-inv-user');
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
