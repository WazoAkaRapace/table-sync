// déplacement pur depuis CharacterSpellsTab.tsx (ratchet R1)
import type { Character, Spell } from '@table-sync/shared';

export interface Props {
  character: Character;
  charId: number;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
  /** Toast orange (règle) — échec non bloquant du POST d'effet de sort. */
  onWarn: (msg: string) => void;
  /** Signal « un effet de sort vient d'être posé » — réveille le bandeau
   *  d'état (état local, anti-écho WS : sans ce signal sa CA reste périmée). */
  onEffectsChanged?: () => void;
  /** CA effective actuelle SANS les effets de sort (override manuel inclus) —
   *  base de l'annonce « CA X → Y » (le bandeau la possède déjà, la page la
   *  recalcule pour l'onglet). */
  currentEffectiveAc?: number;
}

export type DomainSpell = Spell & { domainLevel: number; sourceClass?: string };

export const PAGE_SIZE = 30;

// School identity: a drawn ink-dot on rows (scan level) + matching label tint
// in the expanded detail. Same hues as before, deepened for the parchment ground.
export const SCHOOL_DOT: Record<string, string> = {
  abjuration: 'bg-blue-600',
  conjuration: 'bg-amber-500',
  divination: 'bg-purple-600',
  enchantment: 'bg-pink-600',
  evocation: 'bg-red-600',
  illusion: 'bg-gray-500',
  necromancy: 'bg-green-700',
  transmutation: 'bg-orange-600',
};

export const SCHOOL_TEXT: Record<string, string> = {
  abjuration: 'text-blue-700',
  conjuration: 'text-amber-700',
  divination: 'text-purple-700',
  enchantment: 'text-pink-700',
  evocation: 'text-red-700',
  illusion: 'text-gray-600',
  necromancy: 'text-green-700',
  transmutation: 'text-orange-700',
};
