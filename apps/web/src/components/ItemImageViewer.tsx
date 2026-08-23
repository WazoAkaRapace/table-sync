/**
 * Illustrations d'objets — vignette en châssis (ligne d'inventaire dépliée)
 * et visionneuse plein écran (table de lecture).
 *
 * Plan « objets-illustrations » : la vignette monte son <img> À L'OUVERTURE
 * de la ligne (zéro requête au replié), la visionneuse reçoit la MÊME URL →
 * hit de cache, ouverture instantanée. Portaled obligatoirement : le châssis
 * vit dans une .card au backdrop-blur, qui crée un bloc conteneur cassant
 * position: fixed (le piège documenté des bottom sheets).
 *
 * Contrat overlay maison (repris de Modal) : role="dialog" + aria-modal,
 * Échap ferme, focus rendu au châssis d'origine, scroll verrouillé. Fermer
 * par tape hors image UNIQUEMENT à 1× (pendant un pan/zoom la tape ne ferme
 * jamais). v1 une main : double-tape ↔ 2,5× ancré sur le point tapé + pan
 * borné ; desktop : double-clic, molette zoom continu 1×–5×, glisser = pan.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { itemImageUrl } from '../api';

// ---------- Vignette en châssis (panneau déplié) ----------

/**
 * Plateau parchemin pleine largeur : <img> object-contain max-h-40, pastille
 * 🔍, états chargement (hauteur fixe h-40, aucun saut de layout) et échec
 * (Réessayer avec cache-buster). La tape ouvre la visionneuse plein écran.
 */
export function ItemVignette({ itemId, name }: { itemId: number; name: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bust, setBust] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const src = itemImageUrl(itemId, bust);

  const retry = () => {
    setFailed(false);
    setLoaded(false);
    setBust((n) => n + 1);
  };

  return (
    <div>
      {failed ? (
        // Échec : le plateau reste à hauteur fixe, le panneau reste utilisable.
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-parchment-300 bg-parchment-50 p-1.5 shadow-sm">
          <span className="text-xs text-ink-400">Illustration indisponible</span>
          <button type="button" onClick={retry} className="btn-ghost text-xs">
            ↻ Réessayer
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="block w-full cursor-zoom-in rounded-lg border border-parchment-300 bg-parchment-50 p-1.5 shadow-sm transition-transform active:scale-[0.98]"
          aria-label={`Agrandir l'illustration de ${name}`}
        >
          <span className={`relative flex items-center justify-center ${loaded ? '' : 'h-40'}`}>
            {/* h-40 w-full avant le chargement : l'image garde une vraie boîte
                (loading="lazy" ne charge pas un élément sans boîte) et le
                plateau ne saute pas quand l'octet arrive. */}
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={
                loaded
                  ? 'mx-auto max-h-40 w-full rounded-sm object-contain'
                  : 'h-40 w-full rounded-sm object-contain'
              }
            />
            {!loaded && (
              <span className="absolute animate-pulse text-xs text-ink-400">
                Chargement de l'illustration…
              </span>
            )}
            {loaded && (
              <span
                aria-hidden="true"
                className="absolute right-2.5 top-2.5 rounded-full bg-ink-900/55 px-1.5 py-0.5 text-xs text-parchment-50"
              >
                🔍
              </span>
            )}
          </span>
        </button>
      )}
      <p className="mt-1 text-center text-[11px] text-ink-400">Touche pour agrandir</p>
      {viewerOpen && <ItemImageViewer name={name} src={src} onClose={() => setViewerOpen(false)} />}
    </div>
  );
}

// ---------- Visionneuse plein écran ----------

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

interface View {
  scale: number;
  x: number;
  y: number;
}

const VIEW_1X: View = { scale: 1, x: 0, y: 0 };

export function ItemImageViewer({
  name,
  src,
  onClose,
}: {
  name: string;
  src: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(VIEW_1X);
  const [loaded, setLoaded] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [panning, setPanning] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Contained (scale 1) rendered size — computed at load, bounds the pan.
  const containRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const clampPan = (v: View): View => {
    const { w, h } = containRef.current;
    const maxX = Math.max(0, (w * v.scale - window.innerWidth) / 2);
    const maxY = Math.max(0, (h * v.scale - window.innerHeight) / 2);
    return {
      scale: v.scale,
      x: Math.min(maxX, Math.max(-maxX, v.x)),
      y: Math.min(maxY, Math.max(-maxY, v.y)),
    };
  };

  /** Zoom vers `target`, ancré sur le point tapé (coordonnées viewport). */
  const zoomTo = (target: number, px: number, py: number) => {
    const scale = Math.min(MAX_ZOOM, Math.max(1, target));
    setView((v) => {
      if (scale === 1) return VIEW_1X;
      const k = scale / v.scale;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      // Le point de l'image sous le doigt au départ reste sous le doigt.
      return clampPan({
        scale,
        x: px - cx - (px - cx - v.x) * k,
        y: py - cy - (py - cy - v.y) * k,
      });
    });
    setAnnounce(scale === 1 ? 'Taille d’écran' : `Zoom ${Math.round(scale * 100)} %`);
  };

  // Focus + scroll lock + Échap + piège Tab minimal (✕ seul focusable).
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        e.preventDefault(); // ✕ est le seul élément focusable hors image
        closeBtnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = prevOverflow;
      previousFocus.current?.focus();
    };
  }, []);

  // Desktop : molette = zoom continu (non-passif pour preventDefault).
  // zoomTo vit dans un ref : le listener se bind une fois, sans closure périmée.
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomToRef.current(viewRef.current.scale * factor, e.clientX, e.clientY);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Pointer bookkeeping (souris + tactile unifiés).
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const zoomed = view.scale > 1.01;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Illustration — ${name}`}
      className={`viewer-enter fixed inset-0 z-50 flex h-dvh touch-none select-none flex-col bg-black/85 ${
        zoomed ? (panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
      }`}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, tx: view.x, ty: view.y };
        movedRef.current = false;
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d || !zoomed) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!movedRef.current && Math.hypot(dx, dy) > 6) {
          movedRef.current = true;
          setPanning(true);
        }
        if (!movedRef.current) return;
        setView((v) => clampPan({ scale: v.scale, x: d.tx + dx, y: d.ty + dy }));
      }}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        setPanning(false);
        if (!d) return;
        if (movedRef.current) return; // c'était un pan, pas une tape
        const onBackdrop = e.target === e.currentTarget;
        const now = performance.now();
        const last = lastTapRef.current;
        lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
        const isDouble = !!(
          last &&
          now - last.t <= 300 &&
          Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40
        );
        if (isDouble && !onBackdrop) {
          lastTapRef.current = null;
          zoomTo(zoomed ? 1 : DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
          return;
        }
        // Fermeture par tape hors image — uniquement au repos 1×.
        if (onBackdrop && !zoomed) onCloseRef.current();
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setPanning(false);
      }}
    >
      {/* Chrome flottant : le nom et ✕ posent SUR l'image, pas de bandeau */}
      <div className="flex items-start justify-between gap-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pl-4 pr-2">
        <span className="min-w-0 truncate font-display text-sm text-parchment-50">{name}</span>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Fermer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-parchment-50 transition-colors hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* L'image possède l'écran — object-contain, zoom/pan sur l'img seule */}
      <div className="viewer-image-enter flex min-h-0 flex-1 items-center justify-center">
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            const ratio = img.naturalWidth / img.naturalHeight;
            let w = window.innerWidth;
            let h = w / ratio;
            if (h > window.innerHeight) {
              h = window.innerHeight;
              w = h * ratio;
            }
            containRef.current = { w, h };
            setLoaded(true);
          }}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        />
      </div>

      {/* Indice gestuel au repos 1× seulement, masqué dès le premier zoom */}
      <div className="pb-[env(safe-area-inset-bottom)] pt-2 text-center">
        {loaded && !zoomed && (
          <p className="text-[11px] text-parchment-50/70">Touche deux fois pour zoomer</p>
        )}
      </div>
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-pulse text-sm text-parchment-50/70">Chargement…</span>
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>,
    document.body,
  );
}
