import type { Character, ConcentrationCheck, InventoryEntry } from '@table-sync/shared';

/** Réponse de POST /consume et /refill : les entrées mutées (contrat du PATCH
 *  quantité — `{ entry }` ou `{ removedId }`), le reste même-tag pour le toast,
 *  et les compteurs de privation touchés. Le client applique au cache
 *  react-query sans re-télécharger la fiche. */
export interface SurvivalConsumeResult {
  type: 'food' | 'water' | 'ammo' | 'refill';
  name?: string;
  remaining?: number;
  changes?: { entry?: InventoryEntry; removedId?: number }[];
  foodDays?: number;
  waterDays?: number;
  refilled?: number;
}

// Paliers unifiés (2026-09) : 0 vide · 1–2 jaune · 3–4 orange · 5 rouge vif ·
// 6 rouge sombre — la cartographie du tableau MD, la divergence d'avant disparaît.
export function exhaustionTierFill(level: number): string {
  if (level <= 0) return '';
  if (level <= 2) return 'bg-yellow-500';
  if (level <= 4) return 'bg-orange-500';
  if (level <= 5) return 'bg-red-500';
  return 'bg-red-700';
}

export function exhaustionTierText(level: number): string {
  if (level <= 0) return 'text-ink-400';
  if (level <= 2) return 'text-yellow-700';
  if (level <= 4) return 'text-orange-700';
  if (level <= 5) return 'text-red-700';
  return 'text-red-700';
}

export interface SurvivalPanelProps {
  character: Character;
  charId: number;
  entries: InventoryEntry[];
  /** Only the sheet owner or GM can use the survival actions. */
  canEdit: boolean;
  markLocalMutation: () => void;
  onSaved: () => Promise<void>;
  /** Applique une réponse de geste de survie au cache react-query (entrant,
   *  compteurs de privation) — 1 RTT au lieu du re-téléchargement complet. */
  onApplied?: (result: SurvivalConsumeResult) => void;
  onError: (msg: string) => void;
  onNotice?: (msg: string) => void;
  /** Damage-while-concentrating checks bubble to the page-level popup. */
  onConcentrationCheck: (check: ConcentrationCheck) => void;
}
