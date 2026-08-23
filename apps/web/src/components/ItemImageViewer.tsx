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
 *
 * Plan « annotations » : ouvert depuis une ligne ÉDITABLE (editableEntryId),
 * la visionneuse gagne une barre d'outils — dessiner au doigt, poser du
 * texte, annuler, effacer, enregistrer. Les annotations vivent en SESSION en
 * coordonnées normalisées [0..1] (indépendantes du zoom), le composite base
 * + annotations part en JPEG à l'enregistrement : l'exemplaire devient un
 * objet dérivé côté API (voir item-images.ts). Le dashboard MD ouvre sans
 * contexte éditable → lecture seule, pas de barre.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api, { itemImageUrl } from '../api';
import { ConfirmButton } from './ui';

// ---------- Vignette en châssis (panneau déplié) ----------

/**
 * Plateau parchemin pleine largeur : <img> object-contain max-h-40, pastille
 * 🔍, états chargement (hauteur fixe h-40, aucun saut de layout) et échec
 * (Réessayer avec cache-buster). La tape ouvre la visionneuse plein écran.
 * `editableEntryId` (ligne d'inventaire éditable) ouvre la visionneuse en
 * mode annotation ; absent = lecture seule.
 */
export function ItemVignette({
  itemId,
  name,
  editableEntryId,
}: {
  itemId: number;
  name: string;
  editableEntryId?: number;
}) {
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
      {viewerOpen && (
        <ItemImageViewer
          name={name}
          src={src}
          onClose={() => setViewerOpen(false)}
          editableEntryId={editableEntryId}
        />
      )}
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

type Tool = 'navigate' | 'draw' | 'text';

/** Annotations de session — coordonnées normalisées [0..1] sur l'image. */
type StrokeAnnotation = {
  kind: 'stroke';
  points: Array<[number, number]>;
  color: string;
  width: number;
};
type Annotation =
  | StrokeAnnotation
  | { kind: 'text'; id: number; nx: number; ny: number; text: string; color: string };

/** Palette du plan : mêmes valeurs que les tokens @theme d'index.css. */
const STROKE_COLORS = [
  { value: '#7a1f1f', label: 'rouge sang' }, // blood-600
  { value: '#2a1f14', label: 'encre' }, // ink-900
  { value: '#b8975a', label: 'or' }, // gold-500
  { value: '#fdfaf3', label: 'ivoire' }, // parchment-50
];
const STROKE_WIDTHS = [
  { value: 4, label: 'Trait fin' },
  { value: 9, label: 'Trait épais' },
];

/** Taille de texte relative à l'image affichée (≈ 22 caractères par largeur). */
function textFontSize(displayedWidth: number): number {
  return Math.max(10, Math.round(displayedWidth / 22));
}

/** L'élément tapé appartient-il au chrome annotation (barre, palette, saisie) ? */
function isAnnotationUI(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-annotation-ui]');
}

export function ItemImageViewer({
  name,
  src,
  onClose,
  editableEntryId,
}: {
  name: string;
  src: string;
  onClose: () => void;
  /** Id de la ligne d'inventaire — présent = outils d'annotation (le MD ouvre en lecture seule). */
  editableEntryId?: number;
}) {
  const editable = editableEntryId != null;
  const [view, setView] = useState<View>(VIEW_1X);
  const [loaded, setLoaded] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [panning, setPanning] = useState(false);

  // ---------- Annotation (session) ----------
  const [tool, setTool] = useState<Tool>('navigate');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [color, setColor] = useState(STROKE_COLORS[0].value);
  const [strokeWidth, setStrokeWidth] = useState(STROKE_WIDTHS[0].value);
  const [pendingText, setPendingText] = useState<{
    nx: number;
    ny: number;
    sx: number;
    sy: number;
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [discardConfirm, setDiscardConfirm] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const pendingTextRef = useRef(pendingText);
  pendingTextRef.current = pendingText;
  // Identifiants stables des notes (clés React sans index d'array).
  const noteIdRef = useRef(0);
  const discardRef = useRef(discardConfirm);
  discardRef.current = discardConfirm;

  const queryClient = useQueryClient();

  // Contained (scale 1) rendered size — computed at load, bounds the pan.
  const containRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Rect de l'image SANS transform (capturé à 1×) — ancre le placement des
  // textes, projetés par la formule translate/scale à chaque rendu.
  const [baseRect, setBaseRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

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

  // ---------- Canvas overlay : rejoue traits + trait en cours ----------

  /** Peint tous les traits, clippés au rect affiché de l'image (zoom compris). */
  const paintStrokes = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const all = activeStrokeRef.current
      ? [...annotationsRef.current, activeStrokeRef.current]
      : annotationsRef.current;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const a of all) {
      if (a.kind !== 'stroke') continue;
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = Math.max(1.5, (a.width * rect.width) / 1000);
      const pts = a.points.map(
        ([nx, ny]) => [rect.left + nx * rect.width, rect.top + ny * rect.height] as const,
      );
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const activeStrokeRef = useRef<StrokeAnnotation | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint piloté par les états qui bougent le rendu (annotations, vue, chargement, ancre 1×) ; paintStrokes se recrée à chaque rendu et lit les refs — l'ajouter relancerait l'effet en boucle.
  useEffect(() => {
    paintStrokes();
  }, [annotations, view, loaded, baseRect, tool]);

  /** Point normalisé [0..1] du pointeur sur l'image affichée (rect zoomé). */
  const normalizePoint = (clientX: number, clientY: number): [number, number] | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
  };

  /** Écran ← image normalisée, via le rect 1× et la transformation courante. */
  const projectToScreen = (nx: number, ny: number): { x: number; y: number } | null => {
    if (!baseRect) return null;
    const ox = baseRect.left + baseRect.width / 2;
    const oy = baseRect.top + baseRect.height / 2;
    return {
      x: ox + (baseRect.left + nx * baseRect.width - ox) * view.scale + view.x,
      y: oy + (baseRect.top + ny * baseRect.height - oy) * view.scale + view.y,
    };
  };

  // Focus + scroll lock + Échap + piège Tab (chrome annotation focusable).
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // Saisie de texte ouverte : Échap l'annule (onKeyDown du champ), pas la vue.
        if (pendingTextRef.current) return;
        if (discardRef.current) {
          setDiscardConfirm(false);
          return;
        }
        requestCloseRef.current();
      } else if (e.key === 'Tab') {
        // Le chrome de la visionneuse est le seul focusable : on y boucle.
        e.preventDefault();
        const focusables = rootRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input',
        );
        if (!focusables || focusables.length === 0) {
          closeBtnRef.current?.focus();
          return;
        }
        const index = Array.prototype.indexOf.call(focusables, document.activeElement);
        const next = e.shiftKey
          ? focusables[(index - 1 + focusables.length) % focusables.length]
          : focusables[(index + 1) % focusables.length];
        next.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = prevOverflow;
      previousFocus.current?.focus();
    };
  }, []);

  /** Fermeture demandée : jamais silencieuse avec des annotations en session. */
  const requestCloseRef = useRef<() => void>(() => {});
  requestCloseRef.current = () => {
    if (annotationsRef.current.length > 0) setDiscardConfirm(true);
    else onCloseRef.current();
  };

  // Desktop : molette = zoom continu (non-passif pour preventDefault).
  // zoomTo vit dans un ref : le listener se bind une fois, sans closure périmée.
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomToRef.current(viewRef.current.scale * factor(e.deltaY), e.clientX, e.clientY);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Rect 1× à recadrer quand on REVIENT au repos (layout stable sinon) ou au
  // redimensionnement de la fenêtre — les textes dépendent de cette ancre.
  useEffect(() => {
    const capture = () => {
      const el = imgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0) setBaseRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    if (loaded && view.scale === 1 && view.x === 0 && view.y === 0) capture();
    window.addEventListener('resize', capture);
    return () => window.removeEventListener('resize', capture);
  }, [loaded, view]);

  // ---------- Enregistrement : composite base + annotations → JPEG ----------

  const save = async () => {
    if (!editableEntryId || saving || annotationsRef.current.length === 0) return;
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    setSaving(true);
    setSaveError('');
    try {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const a of annotationsRef.current) {
        if (a.kind === 'stroke') {
          ctx.strokeStyle = a.color;
          ctx.fillStyle = a.color;
          ctx.lineWidth = Math.max(1, (a.width * W) / 1000);
          if (a.points.length === 1) {
            ctx.beginPath();
            ctx.arc(a.points[0][0] * W, a.points[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.beginPath();
          for (const [nx, ny] of a.points) ctx.lineTo(nx * W, ny * H);
          ctx.stroke();
        } else {
          ctx.font = `italic ${textFontSize(W)}px ui-serif, Georgia, serif`;
          ctx.fillStyle = a.color;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(a.text, a.nx * W, a.ny * H);
        }
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      );
      if (!blob) throw new Error('encode');
      const form = new FormData();
      form.append('image', blob, 'annotation.jpg');
      // L'instance axios force JSON — laisser le navigateur poser la boundary
      // multipart (sinon FST_INVALID_MULTIPART, leçon GmDashboardPage).
      await api.post(`/api/inventory/${editableEntryId}/annotation`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // La suppression d'écho WS saute l'auteur : on invalide soi-même la
      // feuille — la ligne re-render sur le dérivé (même libellé, glyphe intact).
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onCloseRef.current();
    } catch {
      // Jamais de perte silencieuse : les annotations restent en session.
      setSaveError('Enregistrement impossible — réessaie');
    } finally {
      setSaving(false);
    }
  };

  // Pointer bookkeeping (souris + tactile unifiés).
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const zoomed = view.scale > 1.01;
  const toolButton = (t: Tool, label: string, glyph: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={tool === t}
      onClick={() => {
        setTool(t);
        setPendingText(null);
        setDraft('');
      }}
      className={`flex h-11 w-11 items-center justify-center rounded-full text-lg text-parchment-50 transition-colors hover:bg-white/10 ${
        tool === t ? 'bg-white/20' : ''
      }`}
    >
      {glyph}
    </button>
  );

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
        if (isAnnotationUI(e.target)) return;
        if (tool === 'draw' && loaded) {
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            activeStrokeRef.current = { kind: 'stroke', points: [p], color, width: strokeWidth };
            paintStrokes();
          }
          return;
        }
        dragRef.current = { x: e.clientX, y: e.clientY, tx: view.x, ty: view.y };
        movedRef.current = false;
      }}
      onPointerMove={(e) => {
        const active = activeStrokeRef.current;
        if (active) {
          const p = normalizePoint(e.clientX, e.clientY);
          const last = active.points[active.points.length - 1];
          if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) {
            active.points.push(p);
            paintStrokes();
          }
          return;
        }
        if (tool !== 'navigate') return; // dessin/écrire : le pan est coupé
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
        if (activeStrokeRef.current) {
          const stroke = activeStrokeRef.current;
          activeStrokeRef.current = null;
          setAnnotations((list) => [...list, stroke]);
          return;
        }
        const d = dragRef.current;
        dragRef.current = null;
        setPanning(false);
        if (!d) return;
        if (movedRef.current) return; // c'était un pan, pas une tape
        if (tool === 'text' && loaded) {
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            setPendingText({ nx: p[0], ny: p[1], sx: e.clientX, sy: e.clientY });
            setDraft('');
          }
          return;
        }
        if (tool !== 'navigate') return; // pas de fermeture/zoom hors navigateur
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
        if (onBackdrop && !zoomed) requestCloseRef.current();
      }}
      onPointerCancel={() => {
        if (activeStrokeRef.current) {
          const stroke = activeStrokeRef.current;
          activeStrokeRef.current = null;
          setAnnotations((list) => [...list, stroke]);
        }
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
          onClick={() => requestCloseRef.current()}
          aria-label="Fermer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-parchment-50 transition-colors hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* L'image possède l'écran — object-contain, zoom/pan sur l'img seule */}
      <div className="viewer-image-enter flex min-h-0 flex-1 items-center justify-center">
        <img
          ref={imgRef}
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
            const r = img.getBoundingClientRect();
            if (r.width > 0) {
              setBaseRect({ left: r.left, top: r.top, width: r.width, height: r.height });
            }
            setLoaded(true);
          }}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        />
      </div>

      {/* Traits : canvas plein écran, clippé au rect de l'image (le zoom/pan
          déforme le rect — paintStrokes relit getBoundingClientRect à chaque
          repaint, les coordonnées normalisées restent stables). */}
      {editable && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />}

      {/* Textes posés : spans ancrés par projection du rect 1× (suivent pan/zoom). */}
      {editable &&
        baseRect &&
        annotations.map((a) => {
          if (a.kind !== 'text') return null;
          const p = projectToScreen(a.nx, a.ny);
          if (!p) return null;
          const size = textFontSize(baseRect.width * view.scale);
          return (
            <span
              key={`note-${a.id}`}
              className="pointer-events-none absolute font-body italic"
              style={{
                left: p.x,
                top: p.y - size,
                color: a.color,
                fontSize: size,
                textShadow: '0 1px 2px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.35)',
              }}
            >
              {a.text}
            </span>
          );
        })}

      {/* Saisie flottante au point tapé (au-dessus du clavier mobile) */}
      {pendingText && (
        <input
          data-annotation-ui
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Écris ta note"
          aria-label="Texte de la note"
          className="fixed z-10 w-44 rounded-lg border border-gold-400 bg-parchment-50 px-2 py-1.5 text-sm text-ink-900 shadow-xl"
          style={{
            left: Math.min(pendingText.sx, window.innerWidth - 180),
            top: Math.max(pendingText.sy - 44, 56),
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraftNote();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setPendingText(null);
              setDraft('');
            }
          }}
          onBlur={() => commitDraftNote()}
        />
      )}

      {/* Barre d'outils annotation — uniquement depuis une ligne éditable */}
      {editable && loaded && (
        <div data-annotation-ui className="flex flex-col items-center gap-2 px-2 pt-2">
          {discardConfirm && (
            <p
              role="alert"
              className="rounded-full bg-ink-900/85 px-4 py-2 text-sm text-parchment-50 backdrop-blur"
            >
              Annotations non enregistrées —{' '}
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                className="font-semibold text-gold-300 underline"
              >
                quitter quand même
              </button>{' '}
              ou{' '}
              <button
                type="button"
                onClick={() => setDiscardConfirm(false)}
                className="font-semibold text-parchment-50 underline"
              >
                rester
              </button>
            </p>
          )}
          {(tool === 'draw' || tool === 'text') && (
            <div className="flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
              {STROKE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  aria-label={`Couleur ${c.label}`}
                  aria-pressed={color === c.value}
                  onClick={() => setColor(c.value)}
                  className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"
                >
                  <span
                    className={`h-6 w-6 rounded-full border ${
                      color === c.value
                        ? 'border-gold-300 ring-2 ring-gold-300/60'
                        : 'border-white/30'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                </button>
              ))}
              {tool === 'draw' &&
                STROKE_WIDTHS.map((w) => (
                  <button
                    type="button"
                    key={w.value}
                    aria-label={w.label}
                    aria-pressed={strokeWidth === w.value}
                    onClick={() => setStrokeWidth(w.value)}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10 ${
                      strokeWidth === w.value ? 'bg-white/20' : ''
                    }`}
                  >
                    <span
                      className="w-5 rounded-full bg-parchment-50"
                      style={{ height: Math.max(3, w.value) }}
                    />
                  </button>
                ))}
            </div>
          )}
          <div className="flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
            {toolButton('navigate', 'Naviguer', '🖐')}
            {toolButton('draw', 'Dessiner', '✏️')}
            {toolButton('text', 'Écrire', 'T')}
            <button
              type="button"
              aria-label="Annuler la dernière annotation"
              disabled={annotations.length === 0}
              onClick={() => setAnnotations((list) => list.slice(0, -1))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-parchment-50 transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              ↩︎
            </button>
            <ConfirmButton
              onConfirm={() => setAnnotations([])}
              ariaLabel="Effacer les annotations"
              confirmChildren={<span className="text-xs">Effacer ?</span>}
              className="flex h-11 min-w-11 items-center justify-center rounded-full px-1 text-base text-parchment-50 transition-colors hover:bg-white/10"
              armedClassName="bg-red-600"
            >
              🗑
            </ConfirmButton>
            <button
              type="button"
              onClick={save}
              disabled={annotations.length === 0 || saving}
              className="h-11 rounded-full bg-blood-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blood-700 disabled:opacity-40"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {saveError && (
            <p role="alert" className="text-xs text-red-300">
              {saveError}
            </p>
          )}
        </div>
      )}

      {/* Indice gestuel : navigation au repos, aide contextuelle en annotation */}
      <div className="pb-[env(safe-area-inset-bottom)] pt-2 text-center">
        {loaded && tool === 'navigate' && !zoomed && (
          <p className="text-[11px] text-parchment-50/70">Touche deux fois pour zoomer</p>
        )}
        {loaded && tool === 'draw' && (
          <p className="text-[11px] text-parchment-50/70">Trace ton doigt sur l'image</p>
        )}
        {loaded && tool === 'text' && !pendingText && (
          <p className="text-[11px] text-parchment-50/70">Touche l'image pour poser un texte</p>
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

  /** Entrée dans la saisie flottante : fige la note au point tapé. */
  function commitDraftNote(): void {
    const pending = pendingTextRef.current;
    if (!pending) return;
    // Verrou immédiat : le blur qui suit Entrée ne doit pas re-commiter la
    // même note (le ref ne se resynchronise qu'au prochain rendu).
    pendingTextRef.current = null;
    setPendingText(null);
    const text = draft.trim();
    if (text) {
      setAnnotations((list) => [
        ...list,
        { kind: 'text', id: ++noteIdRef.current, nx: pending.nx, ny: pending.ny, text, color },
      ]);
    }
    setDraft('');
    setTool('navigate');
  }
}

/** Facteur de zoom continu par cran de molette (isolé pour le listener unique). */
function factor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}
