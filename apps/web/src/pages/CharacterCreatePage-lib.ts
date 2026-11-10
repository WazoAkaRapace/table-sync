// déplacement pur depuis CharacterCreatePage.tsx (ratchet R1)
import type { AbilityKey, ClassInfo } from '@table-sync/shared';
import { classWeaponProficiencies } from '@table-sync/shared';
import type { TFunction } from 'i18next';
import { abilityShort } from '../i18n/labels';

/** Marker for the « Autre… » free-text escape on every catalog picker. */
export const CUSTOM = '__custom__';

// Titres d'étapes résolus via t() dans le composant (clés du catalogue).
export const STEPS = [
  { numeral: 'I', titleKey: 'create.step.identite' },
  { numeral: 'II', titleKey: 'create.step.classe' },
  { numeral: 'III', titleKey: 'create.step.espece' },
  { numeral: 'IV', titleKey: 'create.step.historique' },
  { numeral: 'V', titleKey: 'create.step.caracteristiques' },
  { numeral: 'VI', titleKey: 'create.step.maitrises' },
] as const;
export const RECAP = STEPS.length; // step index of the signing screen

export const DEFAULT_SCORES: Record<AbilityKey, number> = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/** One-line class teaching: hit die, saves, spellcasting nature. */
export function classSummary(t: TFunction, cls: ClassInfo): string {
  const saves = cls.savingThrows.map((a) => abilityShort(a)).join(' & ');
  const castAbility = abilityShort(cls.spellcastingAbility ?? 'charisma');
  const cast =
    cls.spellcasting === 'none'
      ? t('create.aucune.magie')
      : cls.spellcasting === 'pact'
        ? t('create.magie.de.pacte.abil', { ability: castAbility })
        : cls.spellcasting === 'artificier'
          ? t('create.magie.d.artificier.abil', { ability: castAbility })
          : cls.preparesSpells
            ? t('create.sorts.prepares.abil', { ability: castAbility })
            : t('create.sorts.connus.abil', { ability: castAbility });
  return t('create.class.summary', { hitDie: cls.hitDie, saves, cast });
}

export function weaponSummary(t: TFunction, className: string | null): string {
  const set = classWeaponProficiencies(className);
  if (set.simple && set.martial) return t('create.armes.simples.et.de.guerre');
  if (set.simple) return t('create.armes.simples');
  if (set.specific.length > 0) return t('create.quelques.armes.precises');
  return t('create.aucune.armes.par.defaut');
}
