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
import { useTranslation } from 'react-i18next';
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
  imageRev,
  editableEntryId,
}: {
  itemId: number;
  name: string;
  /** Version du fichier (Item.imageRev) — l'URL change quand l'image change. */
  imageRev?: string | null;
  editableEntryId?: number;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bust, setBust] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Réessayer (bust) prime sur la version servie : c'est un contournement
  // de cache, pas un contenu connu.
  const src = itemImageUrl(itemId, bust > 0 ? bust : (imageRev ?? undefined));

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
          <span className="text-xs text-ink-400">{t('image.illustration.indisponible')}</span>
          <button type="button" onClick={retry} className="btn-ghost text-xs">
            {t('image.reessayer')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="block w-full cursor-zoom-in rounded-lg border border-parchment-300 bg-parchment-50 p-1.5 shadow-sm transition-transform active:scale-[0.98]"
          aria-label={t('image.agrandir.l.illustration.de.name', { name: name })}
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
                {t('image.chargement.de.l.illustration')}
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
      <p className="mt-1 text-center text-[11px] text-ink-400">{t('image.touche.pour.agrandir')}</p>
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
  { value: '#7a1f1f', i18n: 'image.couleur.rouge.sang' }, // blood-600
  { value: '#2a1f14', i18n: 'image.couleur.encre' }, // ink-900
  { value: '#b8975a', i18n: 'image.couleur.or' }, // gold-500
  { value: '#fdfaf3', i18n: 'image.couleur.ivoire' }, // parchment-50
];
const STROKE_WIDTHS = [
  { value: 4, i18n: 'image.trait.fin' },
  { value: 9, i18n: 'image.trait.epais' },
];

/** Taille de texte relative à l'image affichée (≈ 22 caractères par largeur). */
function textFontSize(displayedWidth: number): number {
  return Math.max(10, Math.round(displayedWidth / 22));
}

/**
 * Fond de lisibilité derrière une note : l'ivoire et l'or se perdent sur une
 * carte claire, l'encre et le sang sur une zone sombre. On mesure la
 * luminance du texte — clair → scrim encre translucide, foncé → parchemin
 * translucide. Utilisé PARTOUT (span de session ET composite enregistré)
 * pour que l'aperçu ressemble à l'enregistré.
 */
function noteBackdrop(color: string): string {
  const lin = (hex: string) => {
    const c = Number.parseInt(hex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * lin(color.slice(1, 3)) +
    0.7152 * lin(color.slice(3, 5)) +
    0.0722 * lin(color.slice(5, 7));
  // Seuil 0,18 : l'or (≈0,33) part sur scrim sombre, le sang (≈0,05) sur parchemin.
  return lum >= 0.18 ? 'rgba(42,31,20,0.55)' : 'rgba(253,250,243,0.82)';
}

/** L'élément tapé appartient-il au chrome annotation (barre, palette, saisie) ? */
function isAnnotationUI(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-annotation-ui]');
}

/** Id de la note posée visée (span draggable), sinon null. */
function noteIdFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-note-id]');
  return el ? Number(el.getAttribute('data-note-id')) : null;
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
  const { t } = useTranslation();
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
  const imageAreaRef = useRef<HTMLDivElement>(null);
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
    setAnnounce(
      scale === 1 ? t('image.taille.d.ecran') : t('image.zoom.pct', { n: Math.round(scale * 100) }),
    );
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
  // En mode dessin/écrire, le zoom est FIGÉ au niveau courant : on dessine sur
  // une zone stable, l'échelle ne glisse pas sous le doigt.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (toolRef.current !== 'navigate') return; // zoom figé en édition
      zoomToRef.current(viewRef.current.scale * factor(e.deltaY), e.clientX, e.clientY);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Rect 1× à recadrer quand on REVIENT au repos (layout stable sinon) ou au
  // redimensionnement de la fenêtre — les textes dépendent de cette ancre.
  // + à la fin de l'animation d'entrée (scale 0.96→1) : une capture prise
  // PENDANT l'animation épinglerait un rect ~4 % trop petit, et les notes
  // s'afficheraient décalées par rapport au composite enregistré.
  useEffect(() => {
    const capture = () => {
      const el = imgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0) setBaseRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    if (loaded && view.scale === 1 && view.x === 0 && view.y === 0) capture();
    window.addEventListener('resize', capture);
    const area = imageAreaRef.current;
    area?.addEventListener('animationend', capture, { once: true });
    return () => {
      window.removeEventListener('resize', capture);
      area?.removeEventListener('animationend', capture);
    };
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
          const fontPx = textFontSize(W);
          ctx.font = `italic ${fontPx}px ui-serif, Georgia, serif`;
          ctx.textBaseline = 'alphabetic';
          const tx = a.nx * W;
          const ty = a.ny * H;
          // Petit fond translucide ARRONDI (voir noteBackdrop) : la note reste
          // lisible sur n'importe quelle image — l'aperçu de session matche.
          const m = ctx.measureText(a.text);
          const padX = fontPx * 0.3;
          const padY = fontPx * 0.12;
          const bx = tx - padX;
          const by = ty - m.actualBoundingBoxAscent - padY;
          const bw = m.width + padX * 2;
          const bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + padY * 2;
          ctx.fillStyle = noteBackdrop(a.color);
          ctx.beginPath();
          const rc = ctx as CanvasRenderingContext2D & {
            roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
          };
          if (typeof rc.roundRect === 'function') rc.roundRect(bx, by, bw, bh, fontPx * 0.2);
          else ctx.rect(bx, by, bw, bh);
          ctx.fill();
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, tx, ty);
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
        // Upload sur liaison lente : hors du timeout axios par défaut (15 s).
        timeout: 120_000,
      });
      // La suppression d'écho WS saute l'auteur : on invalide soi-même la
      // feuille — la ligne re-render sur le dérivé (même libellé, glyphe intact).
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onCloseRef.current();
    } catch {
      // Jamais de perte silencieuse : les annotations restent en session.
      setSaveError(t('image.enregistrement.impossible'));
    } finally {
      setSaving(false);
    }
  };

  // Pointer bookkeeping (souris + tactile unifiés).
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  // Note posée en cours de déplacement : on mémorise l'ÉCART entre le pointeur
  // et l'ancre de la note au départ — la note suit le DELTA du pointeur sans
  // sauter sous le doigt (l'ancre n'est pas le milieu de la note).
  const dragNoteRef = useRef<{
    id: number;
    pointerNx: number;
    pointerNy: number;
    noteNx: number;
    noteNy: number;
  } | null>(null);

  // ---------- Pince à deux doigts (zoom + pan natifs) ----------
  // Pointeurs suivis (hors chrome d'annotation) + ancrage du geste capturé au
  // départ (et réancré si un doigt surnuméraire part). Le `touch-none` de la
  // racine garantit que ces pointeurs arrivent SANS intervention du navigateur.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    startMid: { x: number; y: number };
    startX: number;
    startY: number;
  } | null>(null);

  /** (Ré)ancre la pince sur les deux premiers doigts suivis, vue courante. */
  const anchorPinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    pinchRef.current = {
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startScale: viewRef.current.scale,
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startX: viewRef.current.x,
      startY: viewRef.current.y,
    };
  };

  /**
   * Applique la pince : zoom continu (écart des doigts) + pan (glissé du
   * milieu), ancré sur le milieu ACTUEL — même formule que zoomTo (le point
   * de l'image sous le milieu y reste), composée avec le déplacement du
   * milieu depuis le départ du geste.
   */
  const applyPinch = () => {
    const pinch = pinchRef.current;
    if (!pinch) return;
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = Math.min(MAX_ZOOM, Math.max(1, pinch.startScale * (dist / pinch.startDist)));
    const k = scale / pinch.startScale;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const bx = pinch.startX + (mid.x - pinch.startMid.x);
    const by = pinch.startY + (mid.y - pinch.startMid.y);
    setView(
      clampPan({
        scale,
        x: mid.x - cx - (mid.x - cx - bx) * k,
        y: mid.y - cy - (mid.y - cy - by) * k,
      }),
    );
  };

  const zoomed = view.scale > 1.01;
  const toolButton = (toolId: Tool, label: string, glyph: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={tool === toolId}
      onClick={() => {
        setTool(toolId);
        setPendingText(null);
        setDraft('');
      }}
      className={`flex h-11 w-11 items-center justify-center rounded-full text-lg text-parchment-50 transition-colors hover:bg-white/10 ${
        tool === toolId ? 'bg-white/20' : ''
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
      aria-label={t('image.illustration.name', { name: name })}
      className={`viewer-enter fixed inset-0 z-50 flex h-dvh touch-none select-none flex-col bg-black/85 ${
        tool === 'draw'
          ? 'cursor-crosshair'
          : tool === 'text'
            ? 'cursor-text'
            : zoomed
              ? panning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-zoom-in'
      }`}
      onPointerDown={(e) => {
        if (isAnnotationUI(e.target)) return;
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointersRef.current.size >= 2) {
          // Deux doigts : pince, quel que soit l'outil (un doigt dessine,
          // deux naviguent — gestes d'annotation standard). Un trait en
          // cours est figé tel quel ; le pan simple est coupé ; la remontée
          // ne devra jamais compter pour une tape.
          const stroke = activeStrokeRef.current;
          if (stroke) {
            activeStrokeRef.current = null;
            setAnnotations((list) => [...list, stroke]);
          }
          dragRef.current = null;
          dragNoteRef.current = null;
          setPanning(false);
          movedRef.current = true;
          anchorPinch();
          return;
        }
        // Note posée visée : déplacement à la main (avant enregistrement),
        // depuis n'importe quel outil — la note suit le pointeur SANS sauter :
        // on part de l'écart pointeur↔ancre au moment de l'attrape.
        const noteId = noteIdFromTarget(e.target);
        if (noteId != null) {
          const note = annotationsRef.current.find(
            (x): x is Extract<Annotation, { kind: 'text' }> => x.kind === 'text' && x.id === noteId,
          );
          const p = normalizePoint(e.clientX, e.clientY);
          if (note && p) {
            dragNoteRef.current = {
              id: noteId,
              pointerNx: p[0],
              pointerNy: p[1],
              noteNx: note.nx,
              noteNy: note.ny,
            };
            movedRef.current = true; // la remontée ne compte jamais pour une tape
          }
          return;
        }
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
        if (pointersRef.current.has(e.pointerId)) {
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        if (pinchRef.current) {
          applyPinch();
          return;
        }
        // Note en déplacement : delta normalisé du pointeur appliqué à l'ancre
        // de départ (borné à l'image) — insensible au zoom comme à l'échelle du
        // rect, le composite gardera exactement la pose affichée.
        const dragNote = dragNoteRef.current;
        if (dragNote != null) {
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            const nx = Math.min(1, Math.max(0, dragNote.noteNx + (p[0] - dragNote.pointerNx)));
            const ny = Math.min(1, Math.max(0, dragNote.noteNy + (p[1] - dragNote.pointerNy)));
            setAnnotations((list) =>
              list.map((x) => (x.kind === 'text' && x.id === dragNote.id ? { ...x, nx, ny } : x)),
            );
          }
          return;
        }
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
        pointersRef.current.delete(e.pointerId);
        dragNoteRef.current = null;
        if (pinchRef.current) {
          if (pointersRef.current.size >= 2) {
            anchorPinch(); // un doigt surnuméraire parti : réancrer sur les restants
            return;
          }
          pinchRef.current = null;
          setAnnounce(
            viewRef.current.scale <= 1.01
              ? t('image.taille.d.ecran')
              : t('image.zoom.pct', { n: Math.round(viewRef.current.scale * 100) }),
          );
          // Un doigt reste : il devient un pan (en navigation) depuis l'état
          // courant — jamais une tape, le geste est déjà consommé.
          if (
            pointersRef.current.size === 1 &&
            toolRef.current === 'navigate' &&
            viewRef.current.scale > 1.01
          ) {
            const [p] = [...pointersRef.current.values()];
            dragRef.current = { x: p.x, y: p.y, tx: viewRef.current.x, ty: viewRef.current.y };
            movedRef.current = true;
          }
          return;
        }
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
          // Relocalisation : figer d'abord une note à moitié tapée (même
          // ajout que commitDraftNote, sans quitter le mode texte).
          if (pendingTextRef.current && draft.trim()) {
            const pending = pendingTextRef.current;
            const text = draft.trim();
            setAnnotations((list) => [
              ...list,
              {
                kind: 'text',
                id: ++noteIdRef.current,
                nx: pending.nx,
                ny: pending.ny,
                text,
                color,
              },
            ]);
          }
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            // Le ref est mis à jour immédiatement : les événements souris de
            // compat de CETTE tape arrivent juste après (voir onMouseDown).
            pendingTextRef.current = { nx: p[0], ny: p[1], sx: e.clientX, sy: e.clientY };
            setPendingText(pendingTextRef.current);
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
      onPointerCancel={(e) => {
        pointersRef.current.delete(e.pointerId);
        dragNoteRef.current = null;
        if (pinchRef.current) {
          if (pointersRef.current.size >= 2) anchorPinch();
          else pinchRef.current = null;
          return;
        }
        if (activeStrokeRef.current) {
          const stroke = activeStrokeRef.current;
          activeStrokeRef.current = null;
          setAnnotations((list) => [...list, stroke]);
        }
        dragRef.current = null;
        setPanning(false);
      }}
      onMouseDown={(e) => {
        // Piège mobile : les événements souris de COMPATIBILITÉ d'une tape
        // arrivent APRÈS son pointerup — donc APRÈS l'ouverture du champ de
        // note. Ce mousedown parasite vole le focus (blur → note vide → champ
        // refermé aussitôt). Annuler son action par défaut (le déplacement de
        // focus) tant qu'une saisie est ouverte ; le chrome d'annotation et
        // le reste de l'interaction passent par les pointer events.
        if (pendingTextRef.current && !isAnnotationUI(e.target)) e.preventDefault();
      }}
    >
      {/* Chrome flottant : le nom et ✕ posent SUR l'image, pas de bandeau.
          pointer-events-none sur le bandeau, auto sur ✕ — les tapes passent
          au travers vers l'image (la zone ne vole aucun pixel d'interaction). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pl-4 pr-2">
        <span className="min-w-0 truncate font-display text-sm text-parchment-50">{name}</span>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={() => requestCloseRef.current()}
          aria-label={t('image.fermer')}
          className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-parchment-50 transition-colors hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* L'image possède l'écran — object-contain sur TOUT l'écran, zoom/pan
          sur l'img seule. Le conteneur est absolute inset-0 : l'apparition de
          la barre d'outils ne redimensionne PLUS la zone image (leçon
          2026-08-23 : en flux, la barre décalait l'image, l'ancre 1× des
          textes partait au mauvais endroit et le saut visuel cassait le zoom
          de travail). */}
      <div
        ref={imageAreaRef}
        className="viewer-image-enter absolute inset-0 flex items-center justify-center"
      >
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
              data-note-id={a.id}
              className="pointer-events-auto absolute cursor-move touch-none font-body italic"
              style={{
                left: p.x,
                top: p.y - size,
                color: a.color,
                fontSize: size,
                backgroundColor: noteBackdrop(a.color),
                borderRadius: '0.25em',
                padding: '0.05em 0.3em',
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
          placeholder={t('image.ecris.ta.note')}
          aria-label={t('image.texte.de.la.note')}
          className="fixed z-10 w-44 select-text rounded-lg border border-gold-400 bg-parchment-50 px-2 py-1.5 text-sm text-ink-900 shadow-xl"
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

      {/* Barre d'outils annotation — uniquement depuis une ligne éditable.
          Flottante basse (absolute), au-dessus de la ligne d'indice : elle ne
          prend PLUS de place en flux — l'image ne bouge pas quand elle
          apparaît. */}
      {editable && loaded && (
        <div
          data-annotation-ui
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {discardConfirm && (
            <p
              role="alert"
              className="pointer-events-auto rounded-full bg-ink-900/85 px-4 py-2 text-sm text-parchment-50 backdrop-blur"
            >
              {t('image.annotations.non.enregistrees')}{' '}
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                className="font-semibold text-gold-300 underline"
              >
                {t('image.quitter.quand.meme')}
              </button>{' '}
              {t('image.ou')}{' '}
              <button
                type="button"
                onClick={() => setDiscardConfirm(false)}
                className="font-semibold text-parchment-50 underline"
              >
                {t('image.rester')}
              </button>
            </p>
          )}
          {(tool === 'draw' || tool === 'text') && (
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
              {STROKE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  aria-label={t('image.couleur.c.label', { c_label: t(c.i18n) })}
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
                    aria-label={t(w.i18n)}
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
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
            {toolButton('navigate', t('image.outil.naviguer'), '🖐')}
            {toolButton('draw', t('image.outil.dessiner'), '✏️')}
            {toolButton('text', t('image.outil.ecrire'), 'T')}
            <button
              type="button"
              aria-label={t('image.annuler.la.derniere.annotation')}
              disabled={annotations.length === 0}
              onClick={() => setAnnotations((list) => list.slice(0, -1))}
              className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-parchment-50 transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              ↩︎
            </button>
            <ConfirmButton
              onConfirm={() => setAnnotations([])}
              ariaLabel={t('image.effacer.les.annotations')}
              confirmChildren={<span className="text-xs">{t('image.effacer.confirm')}</span>}
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
              {saving ? t('image.enregistrement') : t('image.enregistrer')}
            </button>
          </div>
          {saveError && (
            <p role="alert" className="text-xs text-red-300">
              {saveError}
            </p>
          )}
        </div>
      )}

      {/* Indice gestuel : flottant bas, sous la barre quand elle existe —
          jamais en flux (l'image ne doit pas être repoussée). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1 z-0 pb-[env(safe-area-inset-bottom)] pt-2 text-center">
        {loaded && tool === 'navigate' && !zoomed && (
          <p className="text-[11px] text-parchment-50/70">
            {t('image.touche.deux.fois.pour.zoomer')}
          </p>
        )}
        {loaded && tool === 'draw' && (
          <p className="text-[11px] text-parchment-50/70">
            {t('image.trace.ton.doigt.sur.l.image')}
          </p>
        )}
        {loaded && tool === 'text' && !pendingText && (
          <p className="text-[11px] text-parchment-50/70">
            {t('image.touche.l.image.pour.poser.un')}
          </p>
        )}
      </div>
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-pulse text-sm text-parchment-50/70">
            {t('image.chargement')}
          </span>
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
