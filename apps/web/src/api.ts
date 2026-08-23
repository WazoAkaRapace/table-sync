import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dnd-inv-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
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
 * as the /ws socket). Pass `bust > 0` on the Réessayer path to skip the
 * browser cache after a failed load. The response is immutable-cached, so
 * the inventory vignette and the fullscreen viewer share ONE fetch.
 */
export function itemImageUrl(itemId: number, bust = 0): string {
  const token = encodeURIComponent(localStorage.getItem('dnd-inv-token') ?? '');
  const sep = bust > 0 ? `&r=${bust}` : '';
  return `${API_BASE}/api/items/${itemId}/image?token=${token}${sep}`;
}
