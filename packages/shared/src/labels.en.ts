// Miroirs anglais des maps de libellés `*_FR` de index.ts — mêmes clés exactement.
// L'API localise ses payloads par requête (voir docs/i18n-english-plan.md) ; ces
// tables servent aux libellés calculés côté client/web et au moteur partagé.
import type {
  AbilityKey,
  CostUnit,
  EncumbranceState,
  FeatureCategory,
  FightingStyle,
  ItemCategory,
  Rarity,
  SpellSchool,
  ToolCategory,
} from './index.ts';

export const ABILITY_LABELS_EN: Record<AbilityKey, string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

export const ABILITY_SHORT_EN: Record<AbilityKey, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

/** Ordre identique à DND_CONDITIONS_FR (les valeurs FR sont stockées en base). */
export const DND_CONDITIONS_EN = [
  'Blinded',
  'Deafened',
  'Charmed',
  'Frightened',
  'Poisoned',
  'On fire',
  'Restrained',
  'Stunned',
  'Unconscious',
  'Invisible',
  'Grappled',
  'Prone',
  'Paralyzed',
  'Petrified',
  'Possessed',
  'Incapacitated',
];

export const SPELL_SCHOOL_LABELS_EN: Record<SpellSchool, string> = {
  abjuration: 'Abjuration',
  conjuration: 'Conjuration',
  divination: 'Divination',
  enchantment: 'Enchantment',
  evocation: 'Evocation',
  illusion: 'Illusion',
  necromancy: 'Necromancy',
  transmutation: 'Transmutation',
};

export const DAMAGE_TYPE_LABELS_EN: Record<string, string> = {
  Bludgeoning: 'bludgeoning',
  Piercing: 'piercing',
  Slashing: 'slashing',
};

export const MONSTER_SIZE_LABELS_EN: Record<string, string> = {
  TP: 'Tiny',
  T: 'Tiny',
  P: 'Small',
  M: 'Medium',
  G: 'Large',
  TG: 'Huge',
  Gig: 'Gargantuan',
  C: 'Colossal',
};

export const RARITY_LABELS_EN: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very rare',
  legendary: 'Legendary',
  artifact: 'Artifact',
  none: '—',
};

export const COIN_LABELS_EN: Record<CostUnit, string> = {
  cp: 'cp',
  sp: 'sp',
  ep: 'ep',
  gp: 'gp',
  pp: 'pp',
};

export const ENCUMBRANCE_LABELS_EN: Record<EncumbranceState['tier'], string> = {
  unencumbered: 'Unencumbered',
  encumbered: 'Encumbered',
  heavilyEncumbered: 'Heavily encumbered',
  overburdened: 'Overburdened',
};

export const FIGHTING_STYLE_LABELS_EN: Record<FightingStyle, string> = {
  archery: 'Archery (+2 ranged attacks)',
  defense: 'Defense (+1 AC)',
  dueling: 'Dueling (+2 one-handed weapon damage)',
  'great-weapon': 'Great Weapon Fighting (reroll 1s and 2s)',
  protection: 'Protection (reaction to impose disadvantage)',
  'two-weapon': 'Two-Weapon Fighting (+AC mod to off-hand damage)',
};

export const WEAPON_PROPERTY_LABELS_EN: Record<string, string> = {
  light: 'Light',
  finesse: 'Finesse',
  thrown: 'Thrown',
  'two-handed': 'Two-handed',
  versatile: 'Versatile',
  ammunition: 'Ammunition',
  loading: 'Loading',
  heavy: 'Heavy',
  reach: 'Reach',
  special: 'Special',
};

export const CATEGORY_LABELS_EN: Record<ItemCategory, string> = {
  weapon: 'Weapon',
  armor: 'Armor',
  gear: 'Gear',
  tool: 'Tool',
  mount: 'Mount',
  ammunition: 'Ammunition',
  magic: 'Magic',
  custom: 'Custom',
};

export const TOOL_CATEGORY_LABELS_EN: Record<ToolCategory, string> = {
  artisan: "Artisan's tools",
  kit: 'Kits',
  jeu: 'Games',
  instrument: 'Instruments',
  autre: 'Other',
};

export const FEATURE_CATEGORY_LABELS_EN: Record<FeatureCategory, string> = {
  class: 'Class',
  racial: 'Race',
  background: 'Background',
  feat: 'Feat',
  custom: 'Custom',
};

/** Sélectionne la table de libellés pour la langue demandée ('fr' par défaut). */
export function labelTable<T>(frTable: T, enTable: T, lang: string): T {
  return lang === 'en' ? enTable : frTable;
}

/** Langues SRD : les valeurs stockées sont FR (DND_LANGUAGES) — affichage EN. */
export const LANGUAGES_EN: Record<string, string> = {
  commun: 'Common',
  elfique: 'Elvish',
  elfe: 'Elvish',
  nain: 'Dwarvish',
  'nain (profond)': 'Deep Dwarvish',
  orc: 'Orc',
  géant: 'Giant',
  gnome: 'Gnomish',
  gobelin: 'Goblin',
  halfelin: 'Halfling',
  draconique: 'Draconic',
  primordial: 'Primordial',
  infernal: 'Infernal',
  céleste: 'Celestial',
  sylvestre: 'Sylvan',
  profond: 'Deep Speech',
  abyssal: 'Abyssal',
  'commun des profondeurs': 'Undercommon',
  'argot des voleurs': "Thieves' cant",
  druidique: 'Druidic',
};

/** Types de monstres : base FR (prose 5e-drs nettoyée) → EN. */
export const MONSTER_TYPE_LABELS_EN: Record<string, string> = {
  Humanoïde: 'Humanoid',
  Bête: 'Beast',
  Fiélon: 'Fiend',
  Démon: 'Fiend',
  'Mort-vivant': 'Undead',
  'Mort•vivant': 'Undead', // OCR 5e-drs (puce au lieu du tiret)
  Vase: 'Ooze',
  Plante: 'Plant',
  Géant: 'Giant',
  Monstruosité: 'Monstrosity',
  'Créature monstrueuse': 'Monstrosity',
  Aberration: 'Aberration',
  Céleste: 'Celestial',
  Élémentaire: 'Elemental',
  Fée: 'Fey',
  Dragon: 'Dragon',
  Artificiel: 'Construct',
  'Créature artificielle': 'Construct',
  Nuée: 'Swarm',
  'Nuée de bêtes': 'Swarm of beasts',
};

/**
 * Dépouille la prose OCR du type (« Dragon (chromatique) de taille Gig,
 * chaotique mauvais » → « Dragon ») — l'affichage EN mappe ensuite la base.
 * Retourne le texte intact si rien ne correspond (valeurs exotiques).
 */
export function normalizeMonsterTypeFr(type: string): string {
  let t = type.split('(')[0];
  t = t.replace(/de (Très )?(Grande|Petite) taille/g, '').replace(/de taille \S+/g, '');
  // Code de taille resté collé en fin (« Nuée de bêtes TP ») — puce OCR → tiret
  t = t.replace(/\s*\b(TP|TG|Gig)\b\s*$/, '').replace(/•/g, '-');
  t = t.split(',')[0].replace(/\s+/g, ' ').trim();
  return t || type;
}
