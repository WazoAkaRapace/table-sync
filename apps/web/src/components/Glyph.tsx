/**
 * Glyphes d'interface — remplaçants SVG des emoji (cohérence cross-plateforme).
 *
 * Design : grille 24×24, stroke `currentColor` 1.8, caps/joins arrondis,
 * remplissage `none` sauf accents pleins explicites. Taille par défaut 1em
 * (alignée au texte) ; `className` et `style` passent à travers.
 *
 * Usage : <Glyph name="combat" className="text-blood" />
 * Tous les glyphes sont décoratifs : `aria-hidden` est posé ici — le libellé
 * texte voisin porte l'information (lecteurs d'écran).
 */
import type { CSSProperties, ReactNode } from 'react';

export type GlyphName =
  | 'combat'
  | 'shield'
  | 'shield-cross'
  | 'concentration'
  | 'spark'
  | 'spark-outline'
  | 'edit'
  | 'draw'
  | 'annotate'
  | 'scroll'
  | 'target'
  | 'masks'
  | 'trash'
  | 'note'
  | 'user'
  | 'dice'
  | 'heart'
  | 'mail'
  | 'warn'
  | 'fire'
  | 'lock'
  | 'search'
  | 'star'
  | 'star-outline'
  | 'moon'
  | 'hide'
  | 'map'
  | 'pin'
  | 'list'
  | 'eye'
  | 'alchemy'
  | 'link'
  | 'box'
  | 'calendar'
  | 'water'
  | 'death'
  | 'paw'
  | 'pack'
  | 'food'
  | 'wolf'
  | 'hand'
  | 'home'
  | 'close'
  | 'check'
  | 'deafened'
  | 'charmed'
  | 'frightened'
  | 'unconscious'
  | 'invisible'
  | 'grappled'
  | 'prone'
  | 'paralyzed'
  | 'petrified'
  | 'question'
  | 'signal'
  | 'mage'
  | 'camera'
  | 'bow'
  | 'camp'
  | 'book'
  | 'key'
  | 'candle'
  | 'smile'
  | 'mount'
  | 'lily'
  | 'feather'
  | 'armor'
  | 'anchor'
  | 'sun'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog';

const PATHS: Record<GlyphName, ReactNode> = {
  combat: (
    <g>
      <path d="M4 20 18 6M14 4l6 6M6 14l-2 6 6-2M4 20h.01" />
      <path d="m17 7 2-2M19 9l2-2" strokeWidth={1.3} />
    </g>
  ),
  shield: <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6z" />,
  'shield-cross': (
    <g>
      <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6z" />
      <path d="M12 8v8M8.5 11.5h7" strokeWidth={1.5} />
    </g>
  ),
  concentration: (
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3a9 9 0 0 1 9 9M12 21a9 9 0 0 1-9-9M21 12a9 9 0 0 1-9 9" strokeWidth={1.3} />
    </g>
  ),
  spark: (
    <g>
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />
      <path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" strokeWidth={1.3} />
    </g>
  ),
  'spark-outline': <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
  edit: (
    <g>
      <path d="M4 20h16" />
      <path d="M13.5 4.5l4 4L8 18H4v-4z" />
    </g>
  ),
  draw: (
    <g>
      <path d="M14.5 4.5l5 5L9 20H4v-5z" />
      <path d="m12.5 6.5 5 5" strokeWidth={1.3} />
    </g>
  ),
  annotate: (
    <g>
      <path d="M13.5 4.5l4 4L8 18H4v-4z" />
      <path d="M8 20h12" strokeWidth={1.3} />
      <path d="m14 7 3 3" strokeWidth={1.3} />
    </g>
  ),
  scroll: (
    <g>
      <path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4.5" strokeWidth={1.3} />
    </g>
  ),
  target: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" strokeWidth={1.3} />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </g>
  ),
  masks: (
    <g>
      <path d="M4 5c2.5 1 5.5 1 8 0v7a4 4 0 0 1-8 0z" />
      <path d="M12 9c2.5-1 5.5-1 8 0v5a4 4 0 0 1-8 0z" strokeWidth={1.3} />
    </g>
  ),
  trash: (
    <g>
      <path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" />
      <path d="M11 11v5M13 11v5" strokeWidth={1.3} />
    </g>
  ),
  note: (
    <g>
      <path d="M5 4h14v11l-5 5H5z" />
      <path d="M14 20v-5h5" strokeWidth={1.3} />
      <path d="M8.5 8.5h7M8.5 12h5" strokeWidth={1.3} />
    </g>
  ),
  user: (
    <g>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c1-4 3.5-6 7-6s6 2 7 6" />
    </g>
  ),
  dice: (
    <g>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" />
    </g>
  ),
  heart: <path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20z" />,
  mail: (
    <g>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" strokeWidth={1.3} />
    </g>
  ),
  warn: (
    <g>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4M12 16.5v.01" strokeWidth={1.5} />
    </g>
  ),
  fire: (
    <path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 .3C15 9 18 10 18 14a6 6 0 0 1-12 0c0-5 4-7 6-11z" />
  ),
  lock: (
    <g>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </g>
  ),
  search: (
    <g>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </g>
  ),
  star: <path d="M12 3l2.5 6 6.5.5-5 4 1.8 6-5.8-3.6L6.2 19.5 8 13.5 3 9.5l6.5-.5z" />,
  'star-outline': (
    <g>
      <path
        d="M12 4l2 5 5 .4-3.8 3.2 1.2 4.9-4.4-2.7-4.4 2.7 1.2-4.9L5 9.4l5-.4z"
        strokeWidth={1.3}
      />
    </g>
  ),
  moon: <path d="M19 14.5A8 8 0 0 1 9.5 5 8 8 0 1 0 19 14.5z" />,
  hide: (
    <g>
      <path d="M4 4l16 16" strokeWidth={1.5} />
      <path
        d="M9 5.5A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.4-2.6 3.6M6.5 6.8C4.4 8.1 3 9.9 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.5-.8"
        strokeWidth={1.3}
      />
      <path d="M9.5 9.5a3.5 3.5 0 0 0 5 5" strokeWidth={1.3} />
    </g>
  ),
  map: (
    <g>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" strokeWidth={1.3} />
    </g>
  ),
  pin: (
    <g>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2" strokeWidth={1.3} />
    </g>
  ),
  list: (
    <g>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="5" cy="6" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="18" r="1" fill="currentColor" />
    </g>
  ),
  eye: (
    <g>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </g>
  ),
  alchemy: (
    <g>
      <path d="M9.5 3h5M11 3v5.5L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L13 8.5V3" />
      <path d="M8 15h8" strokeWidth={1.3} />
    </g>
  ),
  link: (
    <g>
      <path d="M10 14a4 4 0 0 0 6 .5l2.5-2.5a4 4 0 0 0-5.7-5.7L11.5 7.5" />
      <path d="M14 10a4 4 0 0 0-6-.5L5.5 12a4 4 0 0 0 5.7 5.7l1.3-1.2" />
    </g>
  ),
  box: (
    <g>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" strokeWidth={1.3} />
    </g>
  ),
  calendar: (
    <g>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" strokeWidth={1.3} />
    </g>
  ),
  water: <path d="M12 4c2.5 4 5.5 6.5 5.5 10a5.5 5.5 0 0 1-11 0c0-3.5 3-6 5.5-10z" />,
  death: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <circle cx="9" cy="10.5" r="1.6" strokeWidth={1.3} />
      <circle cx="15" cy="10.5" r="1.6" strokeWidth={1.3} />
      <path d="M8.5 16.5c1-1.2 6-1.2 7 0M9.5 14.5h.01M14.5 14.5h.01" strokeWidth={1.3} />
    </g>
  ),
  paw: (
    <g>
      <circle cx="7" cy="8" r="1.8" strokeWidth={1.3} />
      <circle cx="12" cy="6.5" r="1.8" strokeWidth={1.3} />
      <circle cx="17" cy="8" r="1.8" strokeWidth={1.3} />
      <path d="M12 11c3 0 5.5 2.2 5.5 5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3c0-2.8 2.5-5 5.5-5z" />
    </g>
  ),
  pack: (
    <g>
      <path d="M6 8a6 6 0 0 1 12 0v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2M9 15h6" strokeWidth={1.3} />
    </g>
  ),
  food: (
    <g>
      <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3M9.5 3v5" strokeWidth={1.3} />
      <path d="M9.5 10v11" />
      <path d="M16.5 3c-1.8 1.5-2 4-2 6h4.5c0-2-1-4.5-2.5-6zM16.5 9v12" strokeWidth={1.3} />
    </g>
  ),
  wolf: (
    <g>
      <path d="M4 4l3 4h10l3-4v9a8 6 0 0 1-16 0z" strokeWidth={1.3} />
      <circle cx="9" cy="10.5" r="0.7" fill="currentColor" />
      <circle cx="15" cy="10.5" r="0.7" fill="currentColor" />
      <path d="M12 13.5v2" strokeWidth={1.3} />
    </g>
  ),
  hand: (
    <g>
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V12M8 11l-2.5-2a1.4 1.4 0 0 0-2 2L8 16.5a6 6 0 0 0 5.5 3.5c3.5 0 5.5-2.5 5.5-6V9" />
    </g>
  ),
  home: (
    <g>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" strokeWidth={1.3} />
    </g>
  ),
  close: (
    <g>
      <path d="M6 6l12 12M18 6L6 18" />
    </g>
  ),
  check: <path d="m5 13 4.5 4.5L19 7" />,
  deafened: (
    <g>
      <path d="M17 9.5a5 5 0 0 0-9.5-2A4.5 4.5 0 0 0 9 14c.8 1 1.2 1.8 1.2 3" strokeWidth={1.5} />
      <path d="M5 4l14 16" />
    </g>
  ),
  charmed: (
    <g>
      <path
        d="M12 20S5 15.5 5 10.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.5 12 20 12 20z"
        strokeWidth={1.5}
      />
      <path d="M4 4l1.5 1.5M20 4l-1.5 1.5M12 2v1.5" strokeWidth={1.3} />
    </g>
  ),
  frightened: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 9.5h2.5M13.5 9.5H16" strokeWidth={1.5} />
      <ellipse cx="12" cy="15.5" rx="2.2" ry="2.8" strokeWidth={1.3} />
    </g>
  ),
  unconscious: (
    <g>
      <path d="M7 10h3M14 10h3" strokeWidth={1.3} />
      <path d="M9 15.5c1.5-1.2 4.5-1.2 6 0" strokeWidth={1.3} />
      <path d="M17 4h3l-3 3h3" strokeWidth={1.3} />
      <path d="M4 5h2.5l-2.5 2.5h2.5" strokeWidth={1.3} />
    </g>
  ),
  invisible: (
    <g strokeDasharray="2.5 2.5" strokeWidth={1.3}>
      <path d="M6 21V12a6 6 0 0 1 12 0v9" />
      <circle cx="12" cy="6.5" r="2.5" />
    </g>
  ),
  grappled: (
    <g>
      <path d="M8 4v6a4 4 0 0 0 8 0V4" />
      <path d="M8 20v-6a4 4 0 0 1 8 0v6" />
      <path d="M6 12h12" strokeWidth={1.3} />
    </g>
  ),
  prone: (
    <g>
      <path d="M12 4v9M8 9l4 4 4-4" />
      <path d="M5 19h14" strokeWidth={1.5} />
    </g>
  ),
  paralyzed: (
    <g>
      <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" strokeWidth={1.3} />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  petrified: (
    <g>
      <path d="M6 21v-6c-1.5-2-2-4-1.5-6.5L6 4l4 1.5L12 4l2 1.5L18 4l1.5 4.5c.5 2.5 0 4.5-1.5 6.5v6" />
      <path d="M8 16l2-2M16 16l-2-2" strokeWidth={1.3} />
    </g>
  ),
  question: (
    <g>
      <path d="M8.5 9a3.5 3.5 0 1 1 5.5 3c-1.3 1-2 1.8-2 3.5" />
      <path d="M12 19.5v.01" strokeWidth={2} />
    </g>
  ),
  signal: (
    <g>
      <path d="M4 20v-4M9.3 20v-8M14.6 20v-12M20 20V6" strokeWidth={2} />
    </g>
  ),
  mage: (
    <g>
      <circle cx="12" cy="9" r="3" />
      <path d="M7 9a5 5 0 0 1 10 0M4.5 20c1.2-4 3.8-6 7.5-6s6.3 2 7.5 6" strokeWidth={1.3} />
    </g>
  ),
  camera: (
    <g>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7l1-2.5h4L15 7" strokeWidth={1.3} />
      <circle cx="12" cy="13.5" r="3.5" />
    </g>
  ),
  bow: (
    <g>
      <path d="M5 3c8 3 8 15 0 18" strokeWidth={1.5} />
      <path d="M5 3v18" strokeWidth={1.3} />
      <path d="M5 12h13M18 12l-3-2M18 12l-3 2" strokeWidth={1.3} />
    </g>
  ),
  camp: (
    <g>
      <path d="M12 4 3 20h18z" />
      <path d="M12 12l-3.5 8M12 12l3.5 8" strokeWidth={1.3} />
    </g>
  ),
  book: (
    <g>
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
      <path d="M5 17a2 2 0 0 1 2-2h11" strokeWidth={1.3} />
    </g>
  ),
  key: (
    <g>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M10.5 10.5 20 20M16 20v-3.5M20 20v-3.5" strokeWidth={1.3} />
    </g>
  ),
  candle: (
    <g>
      <rect x="9" y="10" width="6" height="11" rx="1" />
      <path d="M12 10V7" strokeWidth={1.3} />
      <path d="M12 3c1.5 1.6 1.5 3 0 4-1.5-1-1.5-2.4 0-4z" strokeWidth={1.3} />
    </g>
  ),
  smile: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 14c1.5 2 5.5 2 7 0" strokeWidth={1.3} />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2} />
    </g>
  ),
  mount: (
    <g>
      <path
        d="M5 21v-4c0-5 2.5-8 6-9l1-4 3.5 2.5c3 .5 4.5 2.5 4.5 6l-2.5 1c-.5 3-1.5 5-3 7.5"
        strokeWidth={1.3}
      />
      <path d="M16 10.5h.01" strokeWidth={2} />
    </g>
  ),
  lily: (
    <g>
      <path d="M12 3c-1.8 2.5-1.8 5.5 0 8 1.8-2.5 1.8-5.5 0-8z" strokeWidth={1.3} />
      <path d="M6 8c-.5 4 2 6.5 6 6.5S18.5 12 18 8" strokeWidth={1.3} />
      <path d="M12 14.5v5M9.5 19.5h5" strokeWidth={1.3} />
    </g>
  ),
  feather: (
    <g>
      <path d="M19 4c-7 1-11 5-13 13l-2 3" strokeWidth={1.3} />
      <path d="M19 4c1 7-3 11-9 12" strokeWidth={1.3} />
      <path d="M9 9.5l3.5 1M6.5 13.5l3.5 1" strokeWidth={1.3} />
    </g>
  ),
  armor: (
    <g>
      <path d="M6 4l4 2 2-1 2 1 4-2v7l-3 9H9l-3-9z" strokeWidth={1.3} />
      <path d="M10 6l2 3 2-3" strokeWidth={1.3} />
    </g>
  ),
  anchor: (
    <g>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v13M7 11h10" strokeWidth={1.3} />
      <path d="M4 14a8 8 0 0 0 16 0" strokeWidth={1.3} />
    </g>
  ),
  sun: (
    <g>
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
        strokeWidth={1.3}
      />
    </g>
  ),
  rain: (
    <g>
      <path
        d="M7 15a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.7 1.3A3.5 3.5 0 0 1 17 15z"
        strokeWidth={1.3}
      />
      <path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5" strokeWidth={1.3} />
    </g>
  ),
  storm: (
    <g>
      <path
        d="M7 13a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.7 1.3A3.5 3.5 0 0 1 17 13z"
        strokeWidth={1.3}
      />
      <path d="M12.5 12.5 10 17h4l-2.5 4.5" strokeWidth={1.3} />
    </g>
  ),
  snow: (
    <g>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" strokeWidth={1.3} />
      <path d="M12 6l-2-1.5M12 6l2-1.5M12 18l-2 1.5M12 18l2 1.5" strokeWidth={1.3} />
    </g>
  ),
  fog: (
    <g>
      <path
        d="M7 12a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.7 1.3A3.5 3.5 0 0 1 17 12z"
        strokeWidth={1.3}
      />
      <path d="M5 16h14M7 19.5h10" strokeWidth={1.3} />
    </g>
  ),
};

export function Glyph({
  name,
  className,
  style,
}: {
  name: GlyphName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"

      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `inline-glyph ${className}` : 'inline-glyph'}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
