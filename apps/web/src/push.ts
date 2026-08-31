/**
 * Notifications Web Push côté navigateur : enregistrement du service worker
 * et cycle d'abonnement de CE navigateur (l'abonnement est par appareil —
 * chaque tablette/navigateur s'abonne séparément depuis Mon compte).
 * Le service worker (`public/sw.js`) est push-only, sans cache offline.
 */
import api from './api';

export type PushErrorCode = 'permission' | 'unsupported';

export class PushError extends Error {
  code: PushErrorCode;
  constructor(code: PushErrorCode, message?: string) {
    super(message || code);
    this.code = code;
  }
}

/** SW + PushManager + Notification — faux sur l'onglet Safari iOS (le push
 *  n'y existe que via la PWA installée à l'écran d'accueil, iOS ≥ 16.4). */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Le push exige un contexte sécurisé : HTTPS, ou localhost en dev. */
export function pushSecureContext(): boolean {
  return typeof window === 'undefined' || window.isSecureContext;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported() || !pushSecureContext()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[push] enregistrement du service worker impossible', err);
    return null;
  }
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getPushRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Clé publique VAPID (base64url) → buffer pour pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  // new Uint8Array(n) (pas Uint8Array.from) : le buffer est un ArrayBuffer
  // net, exigé par le type BufferSource de pushManager.subscribe.
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Abonne ce navigateur : permission → pushManager → POST /api/push/subscribe. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('permission', permission);
  const reg = (await getPushRegistration()) ?? (await registerServiceWorker());
  if (!reg) throw new PushError('unsupported');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.post('/api/push/subscribe', sub.toJSON());
}

/** Désabonne ce navigateur : ligne serveur d'abord, pushManager ensuite. */
export async function disablePush(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
