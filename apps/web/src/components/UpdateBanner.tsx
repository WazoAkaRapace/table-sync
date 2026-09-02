/**
 * Bandeau de mise à jour PWA — le chaînon manquant du déploiement.
 *
 * Le SW est volontairement push-only (aucun cache offline) : la fraîcheur
 * vient du cache HTTP. Mais un index.html heuristiquement caché laisse
 * l'appareil sur un VIEUX bundle jusqu'au force-refresh — d'où ce contrôle :
 * le build porte sa version (SHA du commit, __APP_VERSION__) et le serveur
 * sert dist/version.json en no-cache ; quand les deux divergent, la version
 * en ligne est plus fraîche que celle qui tourne — on propose le rechargement.
 *
 * Vérifications : au chargement, au retour au premier plan (l'appareil sort
 * de sa poche) et toutes les 30 min. Un ✕ discret écarte UNE version : le
 * bandeau reviendra à la suivante.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function UpdateBanner() {
  const { t } = useTranslation();
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  // Sentinelle '' (jamais une version réelle) : « rien d'écarté ».
  const [dismissed, setDismissed] = useState('');

  const check = useCallback(async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const served = data.version;
      if (!served || served === __APP_VERSION__) {
        setPendingVersion(null);
        return;
      }
      setPendingVersion(served);
    } catch {
      /* hors ligne ou serveur absent — la prochaine vérification repassera */
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (pendingVersion === null || pendingVersion === dismissed) return null;

  return createPortal(
    <div
      className="band-rise fixed top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.5rem)] left-1/2 z-40 w-[min(92vw,26rem)] -translate-x-1/2"
      role="status"
    >
      <div className="flex items-center gap-3 rounded-xl border-2 border-gold-300 bg-parchment-50/95 p-3 shadow-xl backdrop-blur-sm">
        <p className="min-w-0 flex-1 text-sm text-ink-800">
          {t('app.mise.a.jour.dispo')}
          <span className="block font-mono text-[10px] text-ink-400">{pendingVersion}</span>
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary shrink-0 px-4 text-sm"
        >
          {t('app.recharger')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(pendingVersion)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-parchment-200 hover:text-ink-700"
          aria-label={t('cast.fermer')}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}
