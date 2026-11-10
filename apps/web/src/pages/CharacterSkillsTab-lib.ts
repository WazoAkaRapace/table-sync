// déplacement pur depuis CharacterSkillsTab.tsx (ratchet R1)
import type { AbilityKey, Character } from '@table-sync/shared';
import type { TFunction } from 'i18next';
import {
  abilityModifier,
  formatModifier,
  TOOL_CATEGORY_LABELS_FR,
  type ToolCategory,
} from '@table-sync/shared';
import { abilityShort } from '../i18n/labels';

/** Get the ability score value for a given ability key from the character. */
export function abilityScore(character: Character, key: AbilityKey): number {
  return (character[key as keyof Character] as number) ?? 10;
}

/** Read proficiency for a saving throw. */
export function saveProficiency(character: Character, ability: AbilityKey): boolean {
  return (character.savingThrowProficiencies ?? []).includes(ability);
}

/** One term of a skill modifier breakdown ("DEX +4", "maîtrise +3"…). */
export interface BreakdownSegment {
  text: string;
  className: string;
}

/** Decompose a skill modifier into its colored rule terms (teaches the math). */
export function skillBreakdownSegments(
  t: TFunction,
  character: Character,
  ability: AbilityKey,
  prof: number,
  profBonus: number,
): BreakdownSegment[] {
  const mod = abilityModifier(abilityScore(character, ability));
  const segments: BreakdownSegment[] = [
    { text: `${abilityShort(ability)} ${formatModifier(mod)}`, className: 'text-ink-600' },
  ];
  if (prof === 2) {
    segments.push({
      text: t('skills.maitrise.x2', { mod: formatModifier(profBonus * 2) }),
      className: 'text-gold-700',
    });
  } else if (prof === 1) {
    segments.push({
      text: t('skills.maitrise', { mod: formatModifier(profBonus) }),
      className: 'text-blood-500',
    });
  } else {
    segments.push({ text: t('skills.sans.maitrise'), className: 'text-ink-400' });
  }
  return segments;
}

export const TOOL_CATEGORIES = Object.keys(TOOL_CATEGORY_LABELS_FR) as ToolCategory[];
