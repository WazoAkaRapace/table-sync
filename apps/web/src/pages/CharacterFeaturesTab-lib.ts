// déplacement pur depuis CharacterFeaturesTab.tsx (ratchet R1)
import { useEffect, useState } from 'react';
import { appLang } from '../i18n';

// TEMPLATE_VARIABLES (partagé) reste la source des syntaxes ; la description
// affichée passe par i18next — FR = copies verbatim du catalogue partagé.
export const TEMPLATE_VAR_KEYS: Record<string, string> = {
  '{{name}}': 'traits.var.name',
  '{{level}}': 'traits.var.level',
  '{{class}}': 'traits.var.class',
  '{{race}}': 'traits.var.race',
  '{{prof}}': 'traits.var.prof',
  '{{save_dc}}': 'traits.var.save.dc',
  '{{spell_attack}}': 'traits.var.spell.attack',
  '{{str_mod}}': 'traits.var.str.mod',
  '{{dex_mod}}': 'traits.var.dex.mod',
  '{{con_mod}}': 'traits.var.con.mod',
  '{{int_mod}}': 'traits.var.int.mod',
  '{{wis_mod}}': 'traits.var.wis.mod',
  '{{cha_mod}}': 'traits.var.cha.mod',
  '{{save:dex}}': 'traits.var.save.dex',
  '{{save:con}}': 'traits.var.save.con',
  '{{skill:perception}}': 'traits.var.skill.perception',
  '{{skill:athletics}}': 'traits.var.skill.athletics',
  '{{passive_perception}}': 'traits.var.passive.perception',
  '{{initiative}}': 'traits.var.initiative',
  '{{speed}}': 'traits.var.speed',
  '{{max_hp}}': 'traits.var.max.hp',
};

// Affichage EN : le catalogue SRD a sa table anglaise (~150 KB), chargée
// dynamiquement UNIQUEMENT quand l'interface est en anglais — la fiche est
// française par offre, les joueurs FR ne paient pas le catalogue EN sur le
// fil. Le temps du chargement, l'affiche retombe sur le texte FR stocké.
// Les manifestations occultes (~10 KB) suivent le même régime.
export let EN_FEATURES: Record<string, { name: string; description: string }> | null = null;
export function useEnFeatureNames(): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (appLang() !== 'en' || EN_FEATURES) return;
    let alive = true;
    Promise.all([
      import('@table-sync/shared/classFeatures.en'),
      import('@table-sync/shared/warlockInvocations.en'),
    ]).then(([features, invocations]) => {
      EN_FEATURES = {
        ...features.CLASS_FEATURES_EN,
        ...invocations.WARLOCK_INVOCATIONS_EN,
      };
      if (alive) force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);
}
export function featName(f: { title: string; catalogId?: string | null }): string {
  return (appLang() === 'en' && f.catalogId ? EN_FEATURES?.[f.catalogId]?.name : null) ?? f.title;
}
export function featDesc(f: {
  description: string | null;
  catalogId?: string | null;
}): string | null {
  return (
    (appLang() === 'en' && f.catalogId ? EN_FEATURES?.[f.catalogId]?.description : null) ??
    f.description
  );
}
export function defName(d: { id: string; name: string }): string {
  return (appLang() === 'en' ? EN_FEATURES?.[d.id]?.name : null) ?? d.name;
}
export function defDesc(d: { id: string; description: string }): string {
  return (appLang() === 'en' ? EN_FEATURES?.[d.id]?.description : null) ?? d.description;
}
