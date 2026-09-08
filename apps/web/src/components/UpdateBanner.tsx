/**
 * Bandeau de mise à jour PWA — le chaînon manquant du déploiement.
 *
 * Le build porte sa version (SHA du commit, __APP_VERSION__) et le serveur
 * sert dist/version.json en no-cache : quand les deux divergent, une version
 * plus fraîche est en ligne. Plutôt que d'offrir un rechargement à froid, le
 * bandeau DÉCLENCHE le travail : registration.update() fait installer le
 * nouveau service worker, qui précache la coquille en tâche de fond. Le
 * bandeau ne paraît qu'une fois ce précache annoncé fini (message
 * « precache-done » du SW, ou sonde « precache-status » si l'installation
 * datait d'une visite précédente) — « Recharger » retombe alors dans un
 * cache tiède : échange instantané, même sur la radio lente de la table.
 *
 * Filets de sécurité : sans service worker, ou si le précache traîne
 * au-delà du délai de secours (radio noire, quota), le bandeau paraît
 * quand même — le rechargement HTTP fonctionne toujours.
 *
 * Vérifications de dérive : au chargement, au retour au premier plan
 * (l'appareil sort de sa poche) et toutes les 30 min. Un ✕ discret écarte
 * UNE version : le bandeau reviendra à la suivante.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Secours : sans « precache-done » d'ici là, on montre le bandeau —
 *  recharger sans cache tiède vaut mieux qu'attendre indéfiniment. */
const WARMUP_TIMEOUT_MS = 120_000;
/** Sonde « precache-status » au contrôleur tant que le broadcast n'est pas
 *  arrivé (l'installation a pu être consommée lors d'une visite précédente). */
const STATUS_POLL_MS = 5_000;

/** Délai au-delà duquel navigator.serviceWorker.ready est abandonné : le
 *  secours prend le relais, le rechargement HTTP reste possible. */
const READY_TIMEOUT_MS = 10_000;

type PrecacheMessage = { type?: string; version?: string; failed?: number };

export default function UpdateBanner() {
  const { t } = useTranslation();
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  // Le précache de pendingVersion est annoncé fini (ou délai de secours écoulé).
  const [ready, setReady] = useState(false);
  // Sentinelle '' (jamais une version réelle) : « rien d'écarté ».
  const [dismissed, setDismissed] = useState('');
  // Miroir pour l'écouteur de messages (évite la closure périmée).
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = pendingVersion;

  const check = useCallback(async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const served = data.version;
      if (!served || served === __APP_VERSION__) {
        setPendingVersion(null);
        setReady(false);
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

  // Warm-up : à la dérive de version, faire installer + précacher la
  // nouvelle coquille PENDANT que l'utilisateur joue ; écouter « precache-done ».
  useEffect(() => {
    if (!pendingVersion || ready) return;
    let cancelled = false;

    const fallback = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, WARMUP_TIMEOUT_MS);

    const sw = navigator.serviceWorker;
    if (!sw) {
      setReady(true);
      return () => window.clearTimeout(fallback);
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as PrecacheMessage | null;
      if (data?.type === 'precache-done' && data.version === pendingRef.current) {
        setReady(true);
      }
    };
    sw.addEventListener('message', onMessage);

    void (async () => {
      // sw.ready : l'enregistrement (boot de main.tsx) peut encore être en
      // vol — on l'attend un peu, sinon le secours montre le bandeau.
      const reg = await Promise.race([
        sw.ready.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
      ]);
      if (cancelled) return;
      if (!reg) {
        setReady(true);
        return;
      }
      // Onglet vivant : le navigateur ne revérifie sw.js qu'aux navigations —
      // c'est ce coup de pouce qui lance l'installation du nouveau SW.
      try {
        await reg.update();
      } catch {
        /* hors ligne : le délai de secours prendra le relais */
      }
    })();

    const ask = () => sw.controller?.postMessage({ type: 'precache-status' });
    ask();
    const poll = window.setInterval(ask, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      window.clearInterval(poll);
      sw.removeEventListener('message', onMessage);
    };
  }, [pendingVersion, ready]);

  if (!pendingVersion || !ready || pendingVersion === dismissed) return null;

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
