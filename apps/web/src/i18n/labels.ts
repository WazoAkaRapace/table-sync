// Libellés localisés des maps du moteur partagé. Fonctions simples lisant
// appLang() — les composants qui n'utilisent que ces libellés ne rebasculent
// pas à chaud tant que l'extraction UI complète (lot suivant) ne leur a pas
// ajouté useTranslation() ; après extraction, tout re-rend au changement.
import {
  ABILITY_LABELS_EN,
  ABILITY_LABELS_FR,
  ABILITY_SHORT_EN,
  ABILITY_SHORT_FR,
  type AbilityKey,
  type AppLang,
  CATEGORY_LABELS_EN,
  CATEGORY_LABELS_FR,
  CLASS_NAMES_EN,
  COIN_LABELS_EN,
  COIN_LABELS_FR,
  type CostUnit,
  DND_CONDITIONS_EN,
  DND_CONDITIONS_FR,
  damageTypeLabel,
  ENCUMBRANCE_LABELS_EN,
  ENCUMBRANCE_LABELS_FR,
  type EncumbranceState,
  FEATURE_CATEGORY_LABELS_EN,
  FEATURE_CATEGORY_LABELS_FR,
  type FeatureCategory,
  FIGHTING_STYLE_LABELS_EN,
  FIGHTING_STYLE_LABELS_FR,
  type FightingStyle,
  type ItemCategory,
  LANGUAGES_EN,
  MONSTER_SIZE_LABELS_EN,
  MONSTER_SIZE_LABELS_FR,
  MONSTER_TYPE_LABELS_EN,
  monsterAlignmentEn,
  monsterArmorDescEn,
  monsterConditionEn,
  monsterDamageTraitEn,
  monsterSaveEn,
  monsterSkillEn,
  normalizeMonsterTypeFr,
  RARITY_LABELS_EN,
  RARITY_LABELS_FR,
  type Rarity,
  SPELL_SCHOOL_LABELS_EN,
  SPELL_SCHOOL_LABELS_FR,
  type SpellSchool,
  TOOL_CATEGORY_LABELS_EN,
  TOOL_CATEGORY_LABELS_FR,
  type ToolCategory,
  WEAPON_PROPERTY_LABELS_EN,
  WEAPON_PROPERTY_LABELS_FR,
} from '@table-sync/shared';
import { appLang } from './index';

const en = () => appLang() === 'en';
const lang = (): AppLang => (en() ? 'en' : 'fr');
const both = <T>(fr: T, enTable: T) => (en() ? enTable : fr);

export const abilityLabel = (k: AbilityKey) => both(ABILITY_LABELS_FR, ABILITY_LABELS_EN)[k];
export const abilityShort = (k: AbilityKey) => both(ABILITY_SHORT_FR, ABILITY_SHORT_EN)[k];
export const categoryLabel = (k: ItemCategory) => both(CATEGORY_LABELS_FR, CATEGORY_LABELS_EN)[k];
export const rarityLabel = (k: Rarity) => both(RARITY_LABELS_FR, RARITY_LABELS_EN)[k];
export const coinLabel = (k: CostUnit) => both(COIN_LABELS_FR, COIN_LABELS_EN)[k];
export const encumbranceLabel = (t: EncumbranceState['tier']) =>
  both(ENCUMBRANCE_LABELS_FR, ENCUMBRANCE_LABELS_EN)[t];
export const schoolLabel = (s: SpellSchool) =>
  both(SPELL_SCHOOL_LABELS_FR, SPELL_SCHOOL_LABELS_EN)[s];
export const weaponPropertyLabel = (p: string) =>
  both(WEAPON_PROPERTY_LABELS_FR, WEAPON_PROPERTY_LABELS_EN)[p] ?? p;

/**
 * Type de dégâts : la valeur stockée/renvoyée par le moteur est FR — l'EN
 * mappe le mot (variantes incluses) et laisse passer les valeurs déjà
 * anglaises (analyse du texte EN du bestiaire).
 */
export const damageType = (fr: string | null | undefined) => damageTypeLabel(fr, lang());
export const fightingStyleLabel = (s: FightingStyle) =>
  both(FIGHTING_STYLE_LABELS_FR, FIGHTING_STYLE_LABELS_EN)[s];
export const monsterSizeLabel = (s: string) =>
  both(MONSTER_SIZE_LABELS_FR, MONSTER_SIZE_LABELS_EN)[s] ?? s;
export const featureCategoryLabel = (c: FeatureCategory) =>
  both(FEATURE_CATEGORY_LABELS_FR, FEATURE_CATEGORY_LABELS_EN)[c];
export const toolCategoryLabel = (c: ToolCategory) =>
  both(TOOL_CATEGORY_LABELS_FR, TOOL_CATEGORY_LABELS_EN)[c];

/** Conditions : la valeur stockée est FR — index parallèle pour l'EN. */
export function conditionLabel(frValue: string): string {
  if (!en()) return frValue;
  const i = (DND_CONDITIONS_FR as readonly string[]).indexOf(frValue);
  return i >= 0 ? (DND_CONDITIONS_EN[i] ?? frValue) : frValue;
}

/**
 * Clé i18n de l'indice de règle d'un état (picker de l'onglet Survie) :
 * le catalogue FR indexe par nom FR, le catalogue EN par nom EN.
 */
export function conditionHintKey(frValue: string): string {
  if (!en()) return `survie.etats.indices.${frValue}`;
  const i = (DND_CONDITIONS_FR as readonly string[]).indexOf(frValue);
  return `survie.etats.indices.${i >= 0 ? DND_CONDITIONS_EN[i] : frValue}`;
}

/** Classes : les noms FR servent de clés logique (findClass) — affichage EN. */
export function classNameLabel(frName: string): string {
  return en() ? (CLASS_NAMES_EN[frName] ?? frName) : frName;
}

/** Langues : valeurs stockées FR — mapping d'affichage. */
export function languageLabel(frValue: string): string {
  return en() ? (LANGUAGES_EN[frValue.toLowerCase()] ?? frValue) : frValue;
}

/** Type de monstre : prose 5e-drs — nettoyée puis mappée en EN. */
export function monsterTypeLabel(type: string): string {
  if (!en()) return type;
  const base = normalizeMonsterTypeFr(type);
  return MONSTER_TYPE_LABELS_EN[base] ?? base;
}

// ---------- Bestiaire : vocabulaire moteur (valeurs stockées FR) ----------

export const monsterAlignment = (fr: string) => (en() ? monsterAlignmentEn(fr) : fr);
export const monsterCondition = (fr: string) => (en() ? monsterConditionEn(fr) : fr);
export const monsterDamageTrait = (fr: string) => (en() ? monsterDamageTraitEn(fr) : fr);
export const monsterSkill = (name: string) => (en() ? monsterSkillEn(name) : name);
export const monsterSave = (fr: string) => (en() ? monsterSaveEn(fr) : fr);
export const monsterArmorDesc = (fr: string) => (en() ? monsterArmorDescEn(fr) : fr);

// Catalogues SRD (classes, espèces, historiques) — clés FR, affichage EN.
import {
  type CatalogEntryEn,
  DND_BACKGROUNDS_EN,
  DND_CLASSES_EN,
  DND_RACES_EN,
} from '@table-sync/shared';

const enEntry = (table: Record<string, CatalogEntryEn>, frName: string): CatalogEntryEn | null =>
  en() ? (table[frName] ?? null) : null;

export const classInfo = (frName: string): CatalogEntryEn =>
  enEntry(DND_CLASSES_EN, frName) ?? { name: frName };
export const raceInfo = (frName: string): CatalogEntryEn =>
  enEntry(DND_RACES_EN, frName) ?? { name: frName };
export const backgroundInfo = (frName: string): CatalogEntryEn =>
  enEntry(DND_BACKGROUNDS_EN, frName) ?? { name: frName };

import { DND_SKILLS_EN, DND_TOOLS_EN, MUNDANE_WEAPONS } from '@table-sync/shared';

export const skillLabel = (key: string): string => (en() ? DND_SKILLS_EN[key] : undefined) ?? key;
export const skillInfoLabel = (skill: { key: string; label: string }): string =>
  (en() ? DND_SKILLS_EN[skill.key] : undefined) ?? skill.label;
export const toolInfoLabel = (tool: { key: string; label: string }): string =>
  (en() ? DND_TOOLS_EN[tool.key] : undefined) ?? tool.label;

/** Armes communes : le moteur stocke les noms EN — affiche le nom FR stocké. */
export function mundaneWeaponLabel(nameEn: string): string {
  if (!en()) return MUNDANE_WEAPONS.find((m) => m.nameEn === nameEn)?.nameFr ?? nameEn;
  return nameEn;
}

/** Bases d'armure SRD (résolution d'armure magique) : FR stocké — EN miroir. */
export const mundaneArmorLabel = (base: { nameFr: string; nameEn: string }): string =>
  en() ? base.nameEn : base.nameFr;
