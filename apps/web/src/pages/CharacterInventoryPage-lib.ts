// déplacement pur depuis CharacterInventoryPage.tsx (ratchet R1)
import type { InventoryEntry, ItemCategory } from '@table-sync/shared';
import { lazy } from 'react';
import { TUTORIAL_SCRIPTS } from '../tutorial/scripts';

export const CATALOG_PAGE_SIZE = 30;

// Visite guidée : joyride (~75 KB avec floating-ui) n'a pas sa place dans le
// chunk de la fiche pour les joueurs qui ont tout vu — chargement paresseux,
// gardé par une lecture locale des mêmes clés que TutorialHost. Le calcul
// refait à chaque montage de la page : « Réinitialiser le tutoriel » (Mon
// compte) efface les clés, le prochain montage de fiche les relit.
export const TutorialHost = lazy(() =>
  import('../tutorial/TutorialHost').then((m) => ({ default: m.TutorialHost })),
);
export function tutorialPending(): boolean {
  try {
    if (!localStorage.getItem('dnd-inv-tour-seen')) return true;
    const raw = localStorage.getItem('dnd-inv-tour-tabs');
    let done: string[] = [];
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) done = parsed.filter((x): x is string => typeof x === 'string');
    }
    // Seuls les scripts PAR ONGLET s'enregistrent dans dnd-inv-tour-tabs
    // (TutorialHost : `if (ended !== 'shell') markTutorialTabDone(ended)`) —
    // la chaîne d'accueil 'shell' ne doit donc pas compter comme dû.
    const owedTabs = Object.keys(TUTORIAL_SCRIPTS).filter((k) => k !== 'shell');
    return owedTabs.some((tab) => !done.includes(tab));
  } catch {
    return true; // localStorage bloqué : on monte, TutorialHost gère sa dégradation
  }
}

// ---------- Category grouping ----------

export interface CategoryGroupData {
  category: ItemCategory;
  entries: InventoryEntry[];
}

export function groupByCategory(entries: InventoryEntry[]): CategoryGroupData[] {
  const map = new Map<ItemCategory, InventoryEntry[]>();
  for (const e of entries) {
    const cat = e.item.category;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(e);
  }
  // Sort groups: equipped items float within their category
  const result: CategoryGroupData[] = [];
  for (const [category, items] of map) {
    items.sort((a, b) => {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      const na = a.item.name.toLowerCase();
      const nb = b.item.name.toLowerCase();
      return na.localeCompare(nb);
    });
    result.push({ category, entries: items });
  }
  // Sort categories in display order
  const order: ItemCategory[] = [
    'weapon',
    'armor',
    'ammunition',
    'gear',
    'tool',
    'mount',
    'magic',
    'custom',
  ];
  result.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return result;
}
