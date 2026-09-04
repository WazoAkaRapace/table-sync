/**
 * Barre d'onglets desktop (lg+) de la fiche — MESURÉE : les dix onglets
 * libellés ne tiennent dans AUCUNE mesure (≈1122 px requis, 1112 px
 * disponibles au plafond max-w-6xl) ; sur tablette c'est pire. La rangée ne
 * défile plus : les onglets de queue — la fin de l'ordre jeu d'abord, donc
 * messages, notes, PNJ — se replient derrière « ⋯ Plus », au fur et à mesure
 * que la mesure manque. La pastille de non-lus remonte sur le déclencheur :
 * une correspondance attendue ne se perd jamais dans le repli.
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { UnreadBadge } from '../../useMessagesUnread';

export type CharacterTab =
  | 'inventory'
  | 'survival'
  | 'stats'
  | 'spells'
  | 'skills'
  | 'features'
  | 'description'
  | 'npcs'
  | 'notes'
  | 'messages';

/** Character sheet tabs (shared by the desktop top bar and the mobile bottom dock).
 *  Play-first order: the state tabs a player opens mid-session lead; the bag
 *  and the record tabs follow. */
export const CHARACTER_TABS: {
  key: CharacterTab;
  label: string;
  icon: string;
  primary: boolean;
  short?: string;
}[] = [
  { key: 'survival', label: 'onglet.survie', icon: '🩸', primary: true, short: 'onglet.survie' },
  {
    key: 'stats',
    label: 'onglet.caracteristiques',
    icon: '⚔️',
    primary: true,
    short: 'onglet.caract',
  },
  { key: 'spells', label: 'onglet.sorts', icon: '✨', primary: true, short: 'onglet.sorts' },
  { key: 'skills', label: 'onglet.competences', icon: '🎯', primary: true, short: 'onglet.comp' },
  { key: 'inventory', label: 'onglet.inventaire', icon: '🎒', primary: false },
  { key: 'features', label: 'onglet.traits', icon: '📋', primary: false, short: 'onglet.traits' },
  { key: 'description', label: 'onglet.description', icon: '👤', primary: false },
  { key: 'npcs', label: 'onglet.pnj', icon: '🎭', primary: false },
  { key: 'notes', label: 'onglet.notes', icon: '📝', primary: false },
  { key: 'messages', label: 'onglet.messages', icon: '✉️', primary: false },
];

const TAB_GAP = 4; // gap-1 entre les pilules
const ROW_PADDING = 8; // p-1 de chaque côté du couloir

export function SheetTabBar({
  activeTab,
  onSelect,
  messagesUnread,
}: {
  activeTab: CharacterTab;
  onSelect: (tab: CharacterTab) => void;
  messagesUnread: number;
}) {
  const { t, i18n } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(CHARACTER_TABS.length);
  const [menuOpen, setMenuOpen] = useState(false);

  // Une seule recette de pilule, partagée par la rangée et la bande de mesure :
  // ce qui est mesuré est exactement ce qui s'affiche.
  const pill = (active: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
      active ? 'bg-blood-600 text-white shadow-sm' : 'text-ink-900 hover:bg-parchment-200'
    }`;

  const unreadBadge = () =>
    messagesUnread > 0 ? (
      <UnreadBadge
        count={messagesUnread}
        label={t('msgs.non.lus', { n: messagesUnread })}
        className="border-parchment-200"
      />
    ) : null;

  const measure = useCallback(() => {
    const row = rowRef.current;
    const strip = stripRef.current;
    if (!row || !strip) return;
    const capacity = row.clientWidth - ROW_PADDING;
    if (capacity <= 0) return; // caché sous lg : l'ResizeObserver reprend à l'entrée
    const probes = Array.from(strip.children) as HTMLElement[];
    if (probes.length !== CHARACTER_TABS.length + 1) return;
    // Largeurs fractionnaires (getBoundingClientRect) : offsetWidth arrondit,
    // ~0,5 px d'erreur par pilule suffisent à faire déborder la rangée.
    const widths = probes.slice(0, -1).map((el) => el.getBoundingClientRect().width);
    const triggerW = probes[probes.length - 1].getBoundingClientRect().width + TAB_GAP;
    let used = -TAB_GAP;
    let n = 0;
    for (; n < widths.length; n++) {
      // le déclencheur ne pèse que s'il reste des onglets à replier
      const trailing = n < widths.length - 1 ? triggerW : 0;
      if (used + TAB_GAP + widths[n] + trailing > capacity) break;
      used += TAB_GAP + widths[n];
    }
    setVisibleCount(Math.max(1, n));
  }, []);

  // Mesure avant peinture : la rangée ne déborde jamais, même un frame.
  // Les libellés (langue) et la pastille changent la largeur des sondes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: langue et pastille re-rendent les sondes avec de nouvelles largeurs — re-mesure synchrone avant paint, l'ResizeObserver seul arriverait un frame trop tard
  useLayoutEffect(() => {
    measure();
  }, [measure, i18n.language, messagesUnread]);

  // Largeur du couloir ou des libellés → re-mesure (la bande invisible change
  // de taille quand son contenu change). Le resize de fenêtre en doublon :
  // certains webviews embarqués suspendent la livraison des ResizeObserver.
  useEffect(() => {
    const row = rowRef.current;
    const strip = stripRef.current;
    if (!row || !strip) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    observer.observe(strip);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const visible = CHARACTER_TABS.slice(0, visibleCount);
  const hidden = CHARACTER_TABS.slice(visibleCount);
  const activeIsHidden = hidden.some((tab) => tab.key === activeTab);
  const messagesHidden = hidden.some((tab) => tab.key === 'messages');

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Clic dehors referme ; à l'ouverture le focus tombe sur l'onglet actif
  // du menu, sinon le premier.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    const items = menuRef.current
      ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[data-menuitem]'))
      : [];
    (items.find((el) => el.getAttribute('aria-current') === 'true') ?? items[0])?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu(false); // le focus sort du menu, qui se referme proprement
      return;
    }
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    )
      return;
    const items = menuRef.current
      ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[data-menuitem]'))
      : [];
    if (items.length === 0) return;
    event.preventDefault();
    const current =
      document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      className="sheet-rise -mx-4 px-4 sm:mx-0 sm:px-0 hidden lg:block"
      style={{ animationDelay: '60ms' }}
      data-tuto="tabbar"
    >
      <div
        ref={rowRef}
        className="relative flex items-center gap-1 bg-parchment-100 rounded-xl p-1"
      >
        {visible.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              type="button"
              key={tab.key}
              onClick={() => onSelect(tab.key)}
              className={pill(active)}
              aria-pressed={active}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{t(tab.label)}</span>
              {tab.key === 'messages' && unreadBadge()}
            </button>
          );
        })}
        {hidden.length > 0 && (
          <div className="relative flex items-center">
            <button
              type="button"
              ref={triggerRef}
              onClick={() => setMenuOpen((open) => !open)}
              className={pill(activeIsHidden)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-pressed={activeIsHidden}
              aria-label={t('onglet.plus.aria')}
            >
              <span key={menuOpen ? 'x' : 'dots'} className="icon-swap" aria-hidden="true">
                {menuOpen ? '✕' : '⋯'}
              </span>
              <span>{t('onglet.plus')}</span>
              {messagesHidden && unreadBadge()}
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label={t('onglet.plus.aria')}
                onKeyDown={onMenuKeyDown}
                className="sheet-tab-swap card absolute right-0 top-full z-30 mt-2 w-max min-w-52 p-1"
              >
                {hidden.map((tab) => {
                  const active = tab.key === activeTab;
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      data-menuitem
                      key={tab.key}
                      onClick={() => {
                        onSelect(tab.key);
                        closeMenu(true);
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors ${
                        active ? 'bg-blood-600 text-white' : 'text-ink-900 hover:bg-parchment-100'
                      }`}
                    >
                      <span aria-hidden="true">{tab.icon}</span>
                      <span>{t(tab.label)}</span>
                      {tab.key === 'messages' && messagesUnread > 0 && (
                        <UnreadBadge
                          count={messagesUnread}
                          label={t('msgs.non.lus', { n: messagesUnread })}
                          className="ml-auto"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Bande de mesure — hors flux, invisible : la largeur naturelle de
            chaque pilule (et du déclencheur) décide qui reste en rangée. Les
            sondes sont des <button> : la règle globale `button { text-base }`
            d'index.css (hors couches) écrase text-sm sur les boutons réels —
            mesurer des <span> sous-estimerait chaque onglet de ~10 %. Le
            fourreau 0×0 clippe : la bande déborde toujours un peu à droite,
            sans jamais étendre la zone défilante de la page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden"
        >
          <div ref={stripRef} className="invisible flex w-max gap-1">
            {CHARACTER_TABS.map((tab) => (
              <button
                type="button"
                tabIndex={-1}
                key={tab.key}
                className={`${pill(false)} shrink-0`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{t(tab.label)}</span>
                {tab.key === 'messages' && unreadBadge()}
              </button>
            ))}
            <button type="button" tabIndex={-1} className={`${pill(false)} shrink-0`}>
              <span aria-hidden="true">⋯</span>
              <span>{t('onglet.plus')}</span>
              {unreadBadge()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
