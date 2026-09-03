import { useEffect } from 'react';

/**
 * iOS 26, PWA autonome — réancrage du UI fixe après le clavier.
 *
 * Bug système (WebKit 297779, corrigé seulement en partie en iOS 26.1) : dans
 * une web app installée, la fermeture du clavier logiciel peut laisser le
 * viewport désynchronisé — visualViewport.offsetTop reste bloqué, ou la
 * fenêtre ne reprend jamais sa hauteur pleine. Les position:fixed (le dock
 * des onglets) restent alors ancrés à la géométrie fantôme du clavier ouvert
 * et flottent en plein milieu de l'écran. Recharger la page est la seule
 * réparation côté système.
 *
 * Parade : mesurer l'écart entre le bas du viewport VISUEL et le bas que le
 * moteur croit voir, et l'écrire dans --vv-shift sur <html>. Les éléments
 * ancrés au bas portent .vv-anchor (index.css) — un translateY les ramène au
 * bas réellement visible. Hors iOS standalone la variable n'existe pas et la
 * classe reste inerte.
 *
 * Volontairement, le dock ne se soulève PAS au-dessus du clavier ouvert (on
 * n'y tape jamais : mieux vaut fermer le clavier pour naviguer) : tant qu'un
 * éditable a le focus, la compensation retombe à 0. On ne corrige qu'au
 * repos, clavier refermé — y compris le cas où la géométrie reste bloquée à
 * « clavier ouvert » : le delta négatif ramène alors le dock en bas d'écran.
 */
export default function IOSViewportAnchor() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const ios =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    if (!ios || !standalone) return;

    const root = document.documentElement;
    // Hauteur pleine (sans clavier) la plus haute vue à cette orientation :
    // le clavier ne fait que rétrécir le viewport, elle ne peut que croître.
    let baseline = vv.height;
    let applied: number | null = null;
    let settleTimer = 0;
    const laterTimers: number[] = [];

    const apply = (delta: number) => {
      const rounded = Math.round(delta);
      if (rounded === applied) return;
      applied = rounded;
      if (rounded === 0) root.style.removeProperty('--vv-shift');
      else root.style.setProperty('--vv-shift', `${rounded}px`);
    };

    const editing = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLElement &&
        (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      );
    };

    const measure = () => {
      if (Math.abs(vv.scale - 1) > 0.01) {
        // Pincé-zoomé : fixed suit le layout viewport, toute translation
        // serait fausse.
        apply(0);
        return;
      }
      if (vv.height > baseline) baseline = vv.height;
      // Clavier ouvert (un éditable tient le focus) : pas de compensation.
      if (editing()) {
        apply(0);
        return;
      }
      // Bas visible réel − bas cru par le moteur. max(innerHeight, baseline)
      // couvre aussi le cas où innerHeight est resté bloqué à la hauteur
      // clavier : la baseline mémorisée d'avant le clavier dit la vérité.
      apply(vv.offsetTop + vv.height - Math.max(window.innerHeight, baseline));
    };

    // Re-mesure apaisée : jamais pendant le scroll ou les rebonds élastiques
    // (offsetTop y est transitoirement faux) — seulement une fois au repos.
    const schedule = (delay: number) => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(measure, delay);
    };

    const onFocusIn = () => {
      for (const t of laterTimers) window.clearTimeout(t);
      apply(0);
    };
    const onFocusOut = () => {
      // Fermeture du clavier : la géométrie peut se rétablir en plusieurs
      // temps (ou rester bloquée) — re-mesure après coup.
      for (const t of laterTimers) window.clearTimeout(t);
      laterTimers.push(window.setTimeout(measure, 350), window.setTimeout(measure, 900));
    };
    const onOrientation = () => {
      // La baseline de la nouvelle orientation se réapprend à partir de zéro.
      apply(0);
      baseline = 0;
      laterTimers.push(window.setTimeout(measure, 400));
    };

    const onResize = () => schedule(120);
    const onScroll = () => schedule(200);

    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onScroll);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', onOrientation);
    measure();

    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('orientationchange', onOrientation);
      window.clearTimeout(settleTimer);
      for (const t of laterTimers) window.clearTimeout(t);
      root.style.removeProperty('--vv-shift');
    };
  }, []);

  return null;
}
