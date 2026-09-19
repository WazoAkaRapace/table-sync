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
 * texte, en régler l'épaisseur / la taille au glisseur continu, poser des
 * tampons (mobiles, recadrables en direct), annuler, effacer, enregistrer.
 * Les annotations vivent en SESSION en
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
import { STAMPS, type StampKey, stampUrl } from './stamps';
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

type Tool = 'navigate' | 'draw' | 'text' | 'stamp';

/** Annotations de session — coordonnées normalisées [0..1] sur l'image. */
type StrokeAnnotation = {
  kind: 'stroke';
  points: Array<[number, number]>;
  color: string;
  width: number;
};
type StampAnnotation = {
  kind: 'stamp';
  id: number;
  /** Centre du tampon (normalisé) — le rendu et le composite dessinent centré. */
  nx: number;
  ny: number;
  key: StampKey;
  /** Largeur du tampon en fraction de la largeur de l'image (carré). */
  size: number;
};
type Annotation =
  | StrokeAnnotation
  | StampAnnotation
  | {
      kind: 'text';
      id: number;
      nx: number;
      ny: number;
      text: string;
      color: string;
      /** Cran de taille dans TEXT_SIZES — chaque note garde le sien. */
      size: number;
    };

/** Palette du plan : mêmes valeurs que les tokens @theme d'index.css. */
const STROKE_COLORS = [
  { value: '#7a1f1f', i18n: 'image.couleur.rouge.sang' }, // blood-600
  { value: '#2a1f14', i18n: 'image.couleur.encre' }, // ink-900
  { value: '#b8975a', i18n: 'image.couleur.or' }, // gold-500
  { value: '#fdfaf3', i18n: 'image.couleur.ivoire' }, // parchment-50
];
const STROKE_WIDTHS = [
  { value: 4, i18n: 'image.trait.fin' },
  { value: 9, i18n: 'image.trait.moyen' },
  { value: 16, i18n: 'image.trait.epais' },
];
/** Bornes du glisseur de taille de note : fraction de la largeur affichée.
    Petit = 4× plus petit que l'ancien cran « ÷32 » ; grand = l'ancien ÷14.
    Le glisseur est continu (step « any ») — la fraction exacte choisie
    voyage avec la note jusqu'au composite. */
const TEXT_SIZE_MIN = 1 / 128;
const TEXT_SIZE_MAX = 1 / 14;
const DEFAULT_TEXT_SIZE = 1 / 22; // l'ancien cran moyen
/** Tailles de tampon : côté en fraction de la largeur de l'image — mêmes
    bornes que le glisseur (2 % = 4× l'ancien petit de 8 % ; max 20 % inchangé). */
const STAMP_SIZE_MIN = 0.02;
const STAMP_SIZE_MAX = 0.2;
const DEFAULT_STAMP_SIZE = 0.13; // l'ancien cran moyen

/** Taille de texte relative à l'image affichée — `size` est la fraction
    choisie au glisseur ; proportionnelle pure, sans plancher : l'aperçu et
    le composite rendent exactement la même chose à n'importe quelle échelle. */
function textFontSize(displayedWidth: number, size: number = DEFAULT_TEXT_SIZE): number {
  return Math.round(displayedWidth * size);
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

/**
 * Ancre de DESSIN d'une note (son coin haut-gauche) : le texte coule vers la
 * droite et le bas, donc une ancre posée sur le bord droit/bas — ou un peu
 * au-delà (tape dans la marge noire, glissé calé au bord) — engloutirait la
 * note tout entière du composite. On ramène l'ancre à un demi-glyphe DANS
 * l'image : la note s'écrit tronquée au bord, jamais disparue. Utilisée À
 * L'IDENTIQUE par l'aperçu de session et le composite enregistré — l'aperçu
 * reste fidèle à l'enregistré. `aspect` = largeur / hauteur de l'image
 * (identique en rect affiché et en pixels naturels : object-contain).
 */
function noteDrawAnchor(
  nx: number,
  ny: number,
  size: number,
  aspect: number,
): { nx: number; ny: number } {
  // size est une fraction de la LARGEUR ; en fraction de HAUTEUR, un glyphe
  // vaut size × aspect.
  return {
    nx: Math.min(nx, 1 - size * 0.5),
    ny: Math.min(ny, 1 - size * aspect * 0.5),
  };
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

/** Id du tampon visé (img draggable), sinon null. */
function stampIdFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-stamp-id]');
  return el ? Number(el.getAttribute('data-stamp-id')) : null;
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
  // Défaut au cran moyen : l'annotation doit se lire de l'autre bout de la table.
  const [strokeWidth, setStrokeWidth] = useState(STROKE_WIDTHS[1].value);
  const [textSize, setTextSize] = useState(DEFAULT_TEXT_SIZE);
  const [stampKey, setStampKey] = useState<StampKey>(STAMPS[0].key);
  const [stampSize, setStampSize] = useState(DEFAULT_STAMP_SIZE);
  // Tampon sélectionné (tape) : la pilule des tailles le recadre sur place.
  const [selectedStampId, setSelectedStampId] = useState<number | null>(null);
  // Note sélectionnée (tape) : même recadrage en direct que les tampons.
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
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

  useEffect(() => {
    paintStrokes();
  }, [annotations, view, loaded, tool]);
  // Note de dépendances (ex-suppression Biome) : repaint piloté par les états qui bougent le rendu (annotations, vue, chargement, outil) ; paintStrokes se recrée à chaque rendu et lit les refs — l'ajouter relancerait l'effet en boucle.

  /** Point normalisé [0..1] du pointeur sur l'image affichée (rect zoomé). */
  const normalizePoint = (clientX: number, clientY: number): [number, number] | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
  };

  /**
   * Rect AFFICHÉ de l'image, relu au moment de l'appel — l'ancre unique de
   * tout le placement (traits sur le canvas, conteneur clippant, projection
   * des notes et tampons). Le rect VIVENT inclut déjà pan/zoom : une note à
   * (nx, ny) se projette à left + nx × width, sans répliquer la formule de
   * transform. Relire à chaque rendu (et jamais « une fois pour toutes »)
   * est le contrat : une ancre capturée pendant l'animation d'entrée — ou
   * entre deux changements de vue — projetait tout le chrome d'annotation
   * avec quelques pour-cent de décalage (leçon CI : traits et notes
   * vieillissaient différemment du rect réel).
   */
  const liveImageRect = (): DOMRect | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect : null;
  };

  /** Écran ← image normalisée, via le rect affiché relu à l'appel. */
  const projectToScreen = (nx: number, ny: number): { x: number; y: number } | null => {
    const rect = liveImageRect();
    if (!rect) return null;
    return { x: rect.left + nx * rect.width, y: rect.top + ny * rect.height };
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
      // Tampons : décodage AVANT le tracé — un SVG demandé au vol qui ne serait
      // pas prêt se dessinerait à vide (bande manquante, leçon du fixture PNG).
      const stampImages = new Map<string, HTMLImageElement>();
      for (const a of annotationsRef.current) {
        if (a.kind === 'stamp' && !stampImages.has(a.key)) {
          const stampImg = new Image();
          stampImg.src = stampUrl(a.key);
          stampImages.set(a.key, stampImg);
        }
      }
      await Promise.all(
        [...stampImages.values()].map(
          (stampImg) =>
            new Promise<void>((resolve) => {
              if (stampImg.complete) resolve();
              else {
                stampImg.onload = () => resolve();
                stampImg.onerror = () => resolve();
              }
            }),
        ),
      );
      // La pile de --font-body (celle que les spans d'aperçu rendent
      // réellement) : les métriques du composite doivent être celles de
      // l'aperçu — une autre police changerait la largeur du texte, donc la
      // boîte, la troncature au bord et la position de chaque glyphe.
      const bodyFamily =
        getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim() ||
        'ui-serif, Georgia, serif';
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
        } else if (a.kind === 'stamp') {
          const stampImg = stampImages.get(a.key);
          if (stampImg) {
            const s = a.size * W;
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 2;
            ctx.drawImage(stampImg, a.nx * W - s / 2, a.ny * H - s / 2, s, s);
            ctx.restore();
          }
        } else {
          const fontPx = textFontSize(W, a.size);
          ctx.font = `italic ${fontPx}px ${bodyFamily}`;
          // Ancre HAUT-GAUCHE à (nx, ny) — la même sémantique que l'aperçu
          // (span ancré top-left, fond DEPUIS l'ancre, texte décalé des
          // mêmes paddings) : la note enregistrée tombe pile où la note de
          // session s'affichait, à tout zoom. Borne noteDrawAnchor : posée
          // un peu hors cadre, la note s'écrit tronquée au bord.
          ctx.textBaseline = 'top';
          const anchor = noteDrawAnchor(a.nx, a.ny, a.size, W / H);
          const tx = anchor.nx * W;
          const ty = anchor.ny * H;
          const m = ctx.measureText(a.text);
          // Boîte du span d'aperçu, à l'identique : padding 0.3em/0.05em,
          // hauteur lineHeight 1 + 2 × padY, rayon 0.25em, ombre portée
          // (approximée — canvas ne porte qu'une ombre, l'aperçu deux).
          const padX = fontPx * 0.3;
          const padY = fontPx * 0.05;
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 2;
          ctx.shadowOffsetY = 1;
          ctx.fillStyle = noteBackdrop(a.color);
          ctx.beginPath();
          const rc = ctx as CanvasRenderingContext2D & {
            roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
          };
          if (typeof rc.roundRect === 'function') {
            rc.roundRect(tx, ty, m.width + padX * 2, fontPx + padY * 2, fontPx * 0.25);
          } else {
            ctx.rect(tx, ty, m.width + padX * 2, fontPx + padY * 2);
          }
          ctx.fill();
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, tx + padX, ty + padY);
          ctx.restore();
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
  // Tampon attrapé : même ancrage que la note, mais la remontée sans vrai
  // mouvement compte comme une tape → sélection (le glissé reste un déplacement).
  const dragStampRef = useRef<{
    id: number;
    pointerNx: number;
    pointerNy: number;
    stampNx: number;
    stampNy: number;
  } | null>(null);
  // Glissé-défilement de la galerie de tampons : le touch-none de la racine
  // désactive le pan natif, la pilule gère le sien à la main.
  const galleryDragRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
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
        setSelectedStampId(null);
        setSelectedNoteId(null);
      }}
      className={`flex h-11 w-11 items-center justify-center rounded-full text-lg text-parchment-50 transition-colors hover:bg-white/10 ${
        tool === toolId ? 'bg-white/20' : ''
      }`}
    >
      {glyph}
    </button>
  );

  // Taille effective du glisseur tampon : celle du tampon sélectionné (le
  // recadrage suit le glissement en direct), sinon la taille du prochain posé.
  const selectedStamp =
    selectedStampId == null
      ? undefined
      : annotations.find(
          (x): x is Extract<Annotation, { kind: 'stamp' }> =>
            x.kind === 'stamp' && x.id === selectedStampId,
        );
  const stampSizeValue = selectedStamp?.size ?? stampSize;

  const applyStampSize = (value: number) => {
    setStampSize(value);
    if (selectedStampId != null) {
      setAnnotations((list) =>
        list.map((x) =>
          x.kind === 'stamp' && x.id === selectedStampId ? { ...x, size: value } : x,
        ),
      );
    }
  };

  // Même contrat pour les notes : le glisseur recadre la note sélectionnée en
  // direct, sinon il règle la prochaine pose.
  const selectedNote =
    selectedNoteId == null
      ? undefined
      : annotations.find(
          (x): x is Extract<Annotation, { kind: 'text' }> =>
            x.kind === 'text' && x.id === selectedNoteId,
        );
  const textSizeValue = selectedNote?.size ?? textSize;

  const applyTextSize = (value: number) => {
    setTextSize(value);
    if (selectedNoteId != null) {
      setAnnotations((list) =>
        list.map((x) => (x.kind === 'text' && x.id === selectedNoteId ? { ...x, size: value } : x)),
      );
    }
  };

  // Rect affiché de l'image, relu À CHAQUE RENDU : origine du conteneur
  // clippant, base des projections et des tailles — jamais d'ancre périmée
  // (une capture figée vieillissait avec l'animation d'entrée et le zoom).
  const renderRect = editable ? liveImageRect() : null;

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
            : tool === 'stamp'
              ? 'cursor-copy'
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
          dragStampRef.current = null;
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
            // Comme les tampons : la remontée SANS mouvement compte comme une
            // tape → sélection ; un vrai glissé reste un déplacement.
            movedRef.current = false;
          }
          return;
        }
        // Tampon attrapé : même glissé ancré que les notes, mais la remontée
        // SANS mouvement compte comme une tape → sélection (recadrage).
        const stampId = stampIdFromTarget(e.target);
        if (stampId != null) {
          const stamp = annotationsRef.current.find(
            (x): x is Extract<Annotation, { kind: 'stamp' }> =>
              x.kind === 'stamp' && x.id === stampId,
          );
          const p = normalizePoint(e.clientX, e.clientY);
          if (stamp && p) {
            dragStampRef.current = {
              id: stampId,
              pointerNx: p[0],
              pointerNy: p[1],
              stampNx: stamp.nx,
              stampNy: stamp.ny,
            };
            movedRef.current = false;
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
        // rect, le composite gardera exactement la pose affichée. Le geste ne
        // devient un déplacement qu'après un vrai mouvement : sinon la remontée
        // sera une tape de sélection (même contrat que les tampons).
        const dragNote = dragNoteRef.current;
        if (dragNote != null) {
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            const dx = p[0] - dragNote.pointerNx;
            const dy = p[1] - dragNote.pointerNy;
            if (!movedRef.current && Math.hypot(dx, dy) > 0.01) movedRef.current = true;
            if (movedRef.current) {
              const nx = Math.min(1, Math.max(0, dragNote.noteNx + dx));
              const ny = Math.min(1, Math.max(0, dragNote.noteNy + dy));
              setAnnotations((list) =>
                list.map((x) => (x.kind === 'text' && x.id === dragNote.id ? { ...x, nx, ny } : x)),
              );
            }
          }
          return;
        }
        // Tampon en déplacement : même ancrage que la note, mais le geste ne
        // devient un déplacement qu'après un vrai mouvement — sinon la remontée
        // sera une tape de sélection. Le centre reste dans l'image (marge =
        // demi-tampon) : l'aperçu et le composite montrent la même pose.
        const dragStamp = dragStampRef.current;
        if (dragStamp != null) {
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            const dx = p[0] - dragStamp.pointerNx;
            const dy = p[1] - dragStamp.pointerNy;
            if (!movedRef.current && Math.hypot(dx, dy) > 0.01) movedRef.current = true;
            if (movedRef.current) {
              const stamp = annotationsRef.current.find(
                (x): x is Extract<Annotation, { kind: 'stamp' }> =>
                  x.kind === 'stamp' && x.id === dragStamp.id,
              );
              const half = stamp ? stamp.size / 2 : 0;
              const nx = Math.min(1 - half, Math.max(half, dragStamp.stampNx + dx));
              const ny = Math.min(1 - half, Math.max(half, dragStamp.stampNy + dy));
              setAnnotations((list) =>
                list.map((x) =>
                  x.kind === 'stamp' && x.id === dragStamp.id ? { ...x, nx, ny } : x,
                ),
              );
            }
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
        if (tool !== 'navigate') {
          // Tampons : mesurer le glissé — on ne pose PAS un tampon quand la
          // remontée termine un geste de déplacement raté (le pan est coupé).
          if (tool === 'stamp' && dragRef.current && !movedRef.current) {
            const d = dragRef.current;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) movedRef.current = true;
          }
          return; // dessin/écrire/tampons : le pan est coupé
        }
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
        const dragNote = dragNoteRef.current;
        dragNoteRef.current = null;
        const dragStamp = dragStampRef.current;
        dragStampRef.current = null;
        if (dragNote != null) {
          // Tape (sans vrai glissé) sur une note, en mode écriture : bascule
          // de la sélection — le glisseur recadre la note en direct. Hors
          // mode écriture, le geste est simplement consommé.
          if (!movedRef.current && toolRef.current === 'text') {
            setSelectedNoteId((cur) => (cur === dragNote.id ? null : dragNote.id));
          }
          return; // attrapée : jamais une pose, un zoom ni une fermeture
        }
        if (dragStamp != null) {
          // Tape (sans vrai glissé) sur un tampon, en mode tampons : bascule
          // de la sélection — la pilule des tailles le recadre sur place.
          // Hors mode tampons, le geste est simplement consommé.
          if (!movedRef.current && toolRef.current === 'stamp') {
            setSelectedStampId((cur) => (cur === dragStamp.id ? null : dragStamp.id));
          }
          return; // attrapé : jamais une pose, un zoom ni une fermeture
        }
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
                size: textSize,
              },
            ]);
          }
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            // Le ref est mis à jour immédiatement : les événements souris de
            // compat de CETTE tape arrivent juste après (voir onMouseDown).
            // Tape bornée à l'image (même contrat que le glissé) : une tape
            // dans la marge noire pose la note AU BORD, et noteDrawAnchor
            // l'écrit tronquée au lieu de la laisser disparaître.
            pendingTextRef.current = {
              nx: Math.min(1, Math.max(0, p[0])),
              ny: Math.min(1, Math.max(0, p[1])),
              sx: e.clientX,
              sy: e.clientY,
            };
            setPendingText(pendingTextRef.current);
            setDraft('');
          }
          return;
        }
        if (tool === 'stamp' && loaded) {
          // Pose : le tampon courant se centre sur le point tapé, taille
          // courante — et le mode reste actif (on en pose plusieurs de suite).
          if (e.target !== imgRef.current) return; // pose sur l'image uniquement
          if (movedRef.current) return; // c'était un glissé raté, pas une tape
          const p = normalizePoint(e.clientX, e.clientY);
          if (p) {
            const half = stampSize / 2;
            setAnnotations((list) => [
              ...list,
              {
                kind: 'stamp',
                id: ++noteIdRef.current,
                nx: Math.min(1 - half, Math.max(half, p[0])),
                ny: Math.min(1 - half, Math.max(half, p[1])),
                key: stampKey,
                size: stampSize,
              },
            ]);
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
        dragStampRef.current = null;
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

      {/* Tampons posés : imgs ancrés sur le rect affiché relu à chaque rendu
          (suivent pan/zoom et l'animation d'entrée sans ancre périmée). */}
      {editable &&
        renderRect &&
        annotations.map((a) => {
          if (a.kind !== 'stamp') return null;
          const p = projectToScreen(a.nx, a.ny);
          if (!p) return null;
          const s = a.size * renderRect.width;
          const selected = selectedStampId === a.id;
          return (
            <img
              key={`stamp-${a.id}`}
              data-stamp-id={a.id}
              data-selected={selected || undefined}
              src={stampUrl(a.key)}
              alt=""
              draggable={false}
              className={`pointer-events-auto absolute touch-none ${
                selected ? 'rounded-lg ring-2 ring-gold-300' : 'cursor-move'
              }`}
              style={{
                left: p.x - s / 2,
                top: p.y - s / 2,
                width: s,
                height: s,
                // Même traitement d'ombre que les notes (textShadow) : le
                // tampon se détache des cartes chargées ; le composite
                // applique la même ombre pour que l'aperçu reste fidèle.
                filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5))',
              }}
            />
          );
        })}

      {/* Notes posées : clippées au rect affiché de l'image — même idiome que
          les traits sur le canvas. L'ancre passe par noteDrawAnchor (la même
          borne que le composite) : une note posée sur le bord, ou un peu hors
          cadre, s'affiche tronquée à l'aperçu — ce qui tombera dans le JPEG. */}
      {editable && renderRect && (
        <div
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: renderRect.left,
            top: renderRect.top,
            width: renderRect.width,
            height: renderRect.height,
          }}
        >
          {annotations.map((a) => {
            if (a.kind !== 'text') return null;
            const anchor = noteDrawAnchor(a.nx, a.ny, a.size, renderRect.width / renderRect.height);
            const p = projectToScreen(anchor.nx, anchor.ny);
            if (!p) return null;
            const size = textFontSize(renderRect.width, a.size);
            const selected = selectedNoteId === a.id;
            return (
              <span
                key={`note-${a.id}`}
                data-note-id={a.id}
                data-selected={selected || undefined}
                className={`pointer-events-auto absolute touch-none font-body italic ${
                  selected ? 'rounded-lg ring-2 ring-gold-300' : 'cursor-move'
                }`}
                style={{
                  // Ancre = coin HAUT-GAUCHE au point projeté, à tout zoom :
                  // `top: p.y - size` faisait flotter la note une hauteur de
                  // texte AU-DESSUS du point tapé — elle « glissait » pendant
                  // le dézoom (taille ∝ zoom) et ne se posait qu'à 1×.
                  // Coordonnées relatives au conteneur clippant.
                  left: p.x - renderRect.left,
                  top: p.y - renderRect.top,
                  // Une seule ligne, coupée au bord par le conteneur : le
                  // composite ne replie jamais (fillText trace une ligne),
                  // l'aperçu ne doit pas replier davantage.
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
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
        </div>
      )}

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
          {tool === 'stamp' && (
            <>
              {/* Galerie des tampons : défilante (8 boutons de 44px ne tiennent
                  pas dans 320px), chaque SVG garde sa teinte conçue. Le
                  touch-none de la racine tue le défilement natif → glissé
                  géré à la main (les pointer events arrivent toujours), et un
                  glissé avale le clic qui suit pour ne pas sélectionner. */}
              <div
                className="pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-1 overflow-x-auto rounded-full bg-ink-900/70 p-1.5 backdrop-blur [scrollbar-width:none]"
                onPointerDown={(e) => {
                  galleryDragRef.current = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startScroll: e.currentTarget.scrollLeft,
                    moved: false,
                  };
                }}
                onPointerMove={(e) => {
                  const g = galleryDragRef.current;
                  if (!g || g.pointerId !== e.pointerId || e.buttons === 0) return;
                  const dx = e.clientX - g.startX;
                  if (!g.moved && Math.abs(dx) > 5) g.moved = true;
                  if (g.moved) e.currentTarget.scrollLeft = g.startScroll - dx;
                }}
                onPointerUp={() => {
                  // Le ref survit à la remontée : le clic (qui part APRÈS) est
                  // avale dans onClickCapture si le geste a défilé.
                }}
                onPointerCancel={() => {
                  galleryDragRef.current = null;
                }}
                onClickCapture={(e) => {
                  if (galleryDragRef.current?.moved) {
                    e.preventDefault();
                    e.stopPropagation();
                    galleryDragRef.current.moved = false;
                  }
                }}
              >
                {STAMPS.map((s) => (
                  <button
                    type="button"
                    key={s.key}
                    aria-label={t(s.i18n)}
                    aria-pressed={stampKey === s.key}
                    onClick={() => setStampKey(s.key)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 ${
                      stampKey === s.key ? 'bg-white/20' : ''
                    }`}
                  >
                    <img src={stampUrl(s.key)} alt="" draggable={false} className="h-7 w-7" />
                  </button>
                ))}
              </div>
              {/* Taille : glisseur continu — recadre le tampon sélectionné en
                  direct pendant le glissement, sinon règle le prochain posé.
                  Bornes en ‰ de la largeur ; carrés en guise de mini/maxi. */}
              <div className="pointer-events-auto flex h-11 w-60 items-center gap-3 rounded-full bg-ink-900/70 px-4 backdrop-blur">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px] bg-parchment-50/70"
                />
                <input
                  type="range"
                  min={STAMP_SIZE_MIN}
                  max={STAMP_SIZE_MAX}
                  step="any"
                  value={stampSizeValue}
                  onChange={(e) => applyStampSize(Number(e.target.value))}
                  aria-label={t('image.taille.tampon')}
                  aria-valuetext={`${Math.round(stampSizeValue * 100)} %`}
                  className="h-11 flex-1 accent-gold-300"
                />
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-[3px] bg-parchment-50"
                />
              </div>
            </>
          )}
          {(tool === 'draw' || tool === 'text') && (
            <>
              {/* Épaisseur du pinceau : 3 crans discrets, mêmes 44px états
                  pressés que le reste de la barre. */}
              {tool === 'draw' && (
                <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
                  {STROKE_WIDTHS.map((w) => (
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
              {/* Taille du texte : glisseur continu — recadre la note
                  sélectionnée en direct pendant le glissement, sinon règle la
                  prochaine pose. T en guise de mini/maxi, or sur la piste pour
                  rester dans le monde. */}
              {tool === 'text' && (
                <div className="pointer-events-auto flex h-11 w-60 items-center gap-3 rounded-full bg-ink-900/70 px-4 backdrop-blur">
                  <span
                    aria-hidden="true"
                    className="font-display text-[11px] leading-none text-parchment-50/70"
                  >
                    T
                  </span>
                  <input
                    type="range"
                    min={TEXT_SIZE_MIN}
                    max={TEXT_SIZE_MAX}
                    step="any"
                    value={textSizeValue}
                    onChange={(e) => applyTextSize(Number(e.target.value))}
                    aria-label={t('image.taille.texte')}
                    aria-valuetext={`${Math.round(textSizeValue * 100)} %`}
                    className="h-11 flex-1 accent-gold-300"
                  />
                  <span
                    aria-hidden="true"
                    className="font-display text-xl leading-none text-parchment-50"
                  >
                    T
                  </span>
                </div>
              )}
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
              </div>
            </>
          )}
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-900/70 p-1.5 backdrop-blur">
            {toolButton('navigate', t('image.outil.naviguer'), '🖐')}
            {toolButton('draw', t('image.outil.dessiner'), '✏️')}
            {toolButton('text', t('image.outil.ecrire'), 'T')}
            {toolButton('stamp', t('image.outil.tampons'), '📍')}
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
        {loaded && tool === 'stamp' && (
          <p className="text-[11px] text-parchment-50/70">
            {t('image.touche.la.carte.pour.poser.un.tampon')}
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
        {
          kind: 'text',
          id: ++noteIdRef.current,
          nx: pending.nx,
          ny: pending.ny,
          text,
          color,
          size: textSize,
        },
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
