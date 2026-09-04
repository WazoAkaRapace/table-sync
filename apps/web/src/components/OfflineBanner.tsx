import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Bandeau « hors ligne » : navigator.onLine + événements online/offline.
 * Complète le point vert du SyncIndicator (qui ne voit que le socket WS) :
 * sur une tablette au réseau coupé, le joueur SAIT pourquoi rien ne répond.
 * Discret tant que tout va bien — rien n'est rendu.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] bg-ink-900/95 text-parchment-100 text-center text-sm py-1.5 px-4"
      role="status"
      aria-live="polite"
    >
      ⚡ {t('app.hors.ligne')}
    </div>
  );
}
