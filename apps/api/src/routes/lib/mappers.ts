/**
 * Row → domain mappers shared across route modules: items, characters,
 * inventory entries, spells, features.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Character,
  type CharacterFeature,
  type CharacterSpell,
  type CharacterSummary,
  type CostUnit,
  type InventoryEntry,
  type Item,
  type ItemCategory,
  type Rarity,
  type Spell,
  type SpellSchool,
} from '@table-sync/shared';
import { type FeatureResetType } from '@table-sync/shared/classFeatures';
import { getItemImagesDir } from '../../db/index.ts';
import { type AppLang, pickLocalized } from '../lang.ts';
import { parseJsonArray } from './json.ts';

/**
 * Map a raw DB row to the Item domain type.
 *
 * `summary = true` sert les listes : description à null (+ hasDescription
 * pour que l'UI sache qu'une prose existe et la charge à l'ouverture). La
 * description moyenne fait ~0,5 KB — sur une page de catalogue ou une fiche
 * entière qui re-descend après CHAQUE mutation, c'était le gros du fil.
 */
export function mapItem(row: any, lang: AppLang = 'fr', summary = false): Item {
  const description = pickLocalized(lang, row.description_en, row.description);
  // Projections résumé : la prose n'est PAS sélectionnée (I/O jeté — la fiche
  // re-descend à chaque vague d'invalidation) ; l'existence arrive en drapeau
  // `has_description` (0/1) et pilote le même contrat client (lazyDetails).
  const hasDescription = row.has_description !== undefined ? !!row.has_description : !!description;
  return {
    id: row.id,
    source: row.source,
    partyId: row.party_id,
    createdBy: row.created_by,
    category: row.category as ItemCategory,
    name: pickLocalized(lang, row.name, row.name_fr),
    rarity: row.rarity as Rarity,
    weightKg: row.weight_kg,
    costQty: row.cost_qty,
    costUnit: row.cost_unit as CostUnit | null,
    description: summary ? null : description,
    hasDescription,
    baseWeapon: row.base_weapon ?? null,
    baseArmor: row.base_armor ?? null,
    armorFamily: row.armor_family ?? null,
    magicBonus: row.magic_bonus ?? null,
    damageDice: row.damage_dice,
    damageType: row.damage_type,
    twoHandedDice: row.two_handed_dice ?? null,
    acBase: row.ac_base,
    strMin: row.str_min,
    stealthDisadvantage: !!row.stealth_disadvantage,
    properties: row.properties_json ? JSON.parse(row.properties_json) : [],
    survivalTags: row.survival_tags
      ? typeof row.survival_tags === 'string'
        ? JSON.parse(row.survival_tags)
        : row.survival_tags
      : [],
    aliases: row.aliases
      ? typeof row.aliases === 'string'
        ? JSON.parse(row.aliases)
        : row.aliases
      : [],
    imagePath: row.image_path,
    hasImage: !!row.image_url,
    imageRev: row.image_url ? imageRevision(row.image_url) : null,
    derivedFromItemId: row.derived_from_item_id ?? null,
  };
}

/**
 * Version du fichier illustration : mtime+taille en hex, la MÊME forme que
 * l'ETag servi par GET /items/:id/image. Exposée dans les payloads (Item.
 * imageRev) pour que les clients bâtissent des URL qui changent quand le
 * fichier change — un <img> au src identique ne re-demande jamais l'image,
 * c'est lui (pas le cache HTTP) qui pinne la 2e annotation.
 */
export function imageRevision(imageUrl: string): string | null {
  try {
    const stat = statSync(join(getItemImagesDir(), imageUrl));
    return `${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}`;
  } catch {
    return null; // fichier absent : le client affichera l'état d'échec
  }
}

/** Map a raw DB row to CharacterSummary. */
export function mapCharacterSummary(row: any): CharacterSummary {
  return {
    id: row.id,
    partyId: row.party_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? row.display_name ?? '',
    name: row.name,
    strength: row.strength,
    capacityMultiplier: row.capacity_multiplier ?? 1,
    exhaustion: row.exhaustion ?? 0,
    conditions: row.conditions
      ? typeof row.conditions === 'string'
        ? JSON.parse(row.conditions)
        : row.conditions
      : [],
    foodDays: row.food_days ?? 0,
    waterDays: row.water_days ?? 0,
    maxHp: row.max_hp ?? 1,
    currentHp: row.current_hp ?? 1,
    tempHp: row.temp_hp ?? 0,
    // Character sheet
    level: row.level ?? 1,
    dexterity: row.dexterity ?? 10,
    constitution: row.constitution ?? 10,
    intelligence: row.intelligence ?? 10,
    wisdom: row.wisdom ?? 10,
    charisma: row.charisma ?? 10,
    characterClass: row.character_class ?? null,
    race: row.race ?? null,
    background: row.background ?? null,
    speed: row.speed ?? 9,
    skillProficiencies: parseJsonArray(row.skill_proficiencies, []),
    skillExpertise: parseJsonArray(row.skill_expertise, []),
    toolProficiencies: parseJsonArray(row.tool_proficiencies, []),
    toolExpertise: parseJsonArray(row.tool_expertise, []),
    languages: parseJsonArray(row.languages, []),
    savingThrowProficiencies: parseJsonArray(row.saving_throw_proficiencies, []),
    weaponProficiencies: row.weapon_proficiencies
      ? parseJsonArray(row.weapon_proficiencies, [])
      : null,
    armorProficiencies: row.armor_proficiencies
      ? parseJsonArray(row.armor_proficiencies, [])
      : null,
    fightingStyle: row.fighting_style ?? null,
    spellSlotsUsed: parseJsonArray(row.spell_slots_used, [0, 0, 0, 0, 0, 0, 0, 0, 0]),
    // Description / personality
    alignment: row.alignment ?? null,
    sex: row.sex ?? null,
    height: row.height ?? null,
    weight: row.weight ?? null,
    age: row.age ?? null,
    skin: row.skin ?? null,
    eyes: row.eyes ?? null,
    hair: row.hair ?? null,
    portraitUrl: row.portrait_url ?? null,
    // (champs prose : volontairement absents du résumé — voir mapCharacter)
    armorClassOverride: row.armor_class_override ?? null,
    deathSaveSuccesses: row.death_save_successes ?? 0,
    deathSaveFailures: row.death_save_failures ?? 0,
    inspiration: !!row.inspiration,
    concentrating: !!row.concentrating,
    raging: !!row.raging,
    hidden: !!row.hidden,
    wildShapeSlug: row.wild_shape_slug ?? null,
    wildShapeHp: row.wild_shape_hp ?? null,
    wildShapeMaxHp: row.wild_shape_max_hp ?? null,
    wildShapeUses: row.wild_shape_uses ?? 2,
    hitDiceUsed: row.hit_dice_used ?? 0,
    wildShapeSeen: parseJsonArray(row.wild_shape_seen_json, []),
    druidCircle: row.druid_circle ?? null,
    divineDomain: row.divine_domain ?? null,
    landCircle: row.land_circle ?? null,
    sacredOath: row.sacred_oath ?? null,
    subclass: row.subclass ?? null,
    // Multiclassage : lignes de classe (source de vérité) + pool de pacte
    classes: (row._classes ?? []).map((c: any) => ({
      classKey: c.class_key,
      level: c.level,
      subclassKey: c.subclass_key ?? null,
      hitDiceUsed: c.hit_dice_used ?? 0,
      fightingStyle: c.fighting_style ?? null,
    })),
    pactSlotsUsed: parseJsonArray(row.pact_slots_used, [0, 0, 0, 0, 0, 0, 0, 0, 0]),
    unarmoredDefense: row.unarmored_defense ?? null,
  };
}

/** Map a raw DB row to a full Character (with coin purse). */
export function mapCharacter(row: any): Character {
  return {
    ...mapCharacterSummary(row),
    // Prose : les fiches COMPLÈTES seules — l'onglet Description est le seul
    // lecteur, les rosters (parties.ts, listes) ne paient plus les multi-KB.
    personalityTraits: row.personality_traits ?? null,
    ideals: row.ideals ?? null,
    bonds: row.bonds ?? null,
    flaws: row.flaws ?? null,
    appearance: row.appearance ?? null,
    backstory: row.backstory ?? null,
    alliesOrganizations: row.allies_organizations ?? null,
    notes: row.notes,
    copper: row.copper,
    silver: row.silver,
    electrum: row.electrum,
    gold: row.gold,
    platinum: row.platinum,
    createdAt: row.created_at,
  };
}

/** Map a raw inventory row (with joined item using i_ aliases) to InventoryEntry. */
export function mapInventoryEntry(row: any, lang: AppLang = 'fr'): InventoryEntry {
  // Detect whether row uses aliased columns (i_id) or raw (id)
  const usesAliases = row.i_id !== undefined;
  const itemRow = usesAliases
    ? {
        id: row.i_id,
        source: row.i_source,
        party_id: row.i_party_id,
        category: row.i_category,
        srd_index: row.i_srd_index,
        name: row.i_name,
        name_fr: row.i_name_fr,
        rarity: row.i_rarity,
        weight_kg: row.i_weight_kg,
        cost_qty: row.i_cost_qty,
        cost_unit: row.i_cost_unit,
        has_description: row.i_has_description,
        damage_dice: row.i_damage_dice,
        damage_type: row.i_damage_type,
        two_handed_dice: row.i_two_handed_dice ?? null,
        ac_base: row.i_ac_base,
        str_min: row.i_str_min,
        stealth_disadvantage: row.i_stealth_disadvantage,
        properties_json: row.i_properties_json,
        survival_tags: row.i_survival_tags,
        base_weapon: row.i_base_weapon,
        base_armor: row.i_base_armor,
        armor_family: row.i_armor_family,
        magic_bonus: row.i_magic_bonus,
        image_path: row.i_image_path,
        image_url: row.i_image_url,
        derived_from_item_id: row.i_derived_from_item_id,
      }
    : row;

  // Objets embarqués TOUJOURS en résumé (sans prose) — la fiche entière
  // re-descend après chaque mutation, la description se charge à l'ouverture.
  return {
    id: row.id,
    characterId: row.character_id,
    itemId: row.item_id,
    item: mapItem(itemRow, lang, true),
    quantity: row.quantity,
    equipped: !!row.equipped,
    notes: row.notes,
    storageLocationId: row.storage_location_id ?? null,
    addedAt: row.added_at,
  };
}

/**
 * Map a raw spells row to the Spell domain type.
 * Handles snake_case → camelCase and JSON parsing of
 * components / classes_json / damage_json / dc_json.
 */
/**
 * `summary = true` sert les listes de sorts (catalogue, sorts connus) :
 * description/higherLevel à null — la feuille d'incantation (SpellDetailSheet)
 * et l'aperçu détaillé chargent GET /spells/:id à l'ouverture.
 */
/**
 * Le sort évolue-t-il aux niveaux supérieurs ? (#171) — drapeau structuré
 * posé dans TOUS les régimes (résumé compris, où la prose est absente) :
 * prose higher_level (FR ou EN — la FR peut manquer, ex. Héroïsme) OU
 * tables damage_at_slot_level / heal_at_slot_level du damage_json. Les listes
 * résumées doivent sélectionner higher_level (COLONNE courte, pas la prose
 * description) pour le calculer sans lazy-loader GET /spells/:id.
 */
function spellScalesAtHigherLevel(row: any): boolean {
  if (row.higher_level && String(row.higher_level).trim()) return true;
  if (row.higher_level_fr && String(row.higher_level_fr).trim()) return true;
  if (row.damage_json) {
    try {
      const d = JSON.parse(row.damage_json) as any;
      return !!(d?.damage_at_slot_level || d?.heal_at_slot_level);
    } catch {
      // damage_json invalide : la prose seule tranche
    }
  }
  return false;
}

export function mapSpell(row: any, lang: AppLang = 'fr', summary = false): Spell {
  return {
    id: row.id,
    srdIndex: row.srd_index,
    name: pickLocalized(lang, row.name, row.name_fr),
    level: row.level,
    school: row.school as SpellSchool,
    castingTime: row.casting_time ?? null,
    rangeText: row.range_text ?? null,
    components: parseJsonArray(row.components, []),
    material: row.material ?? null,
    duration: row.duration ?? null,
    concentration: !!row.concentration,
    ritual: !!row.ritual,
    description: summary ? null : pickLocalized(lang, row.description, row.description_fr),
    higherLevel: summary ? null : pickLocalized(lang, row.higher_level, row.higher_level_fr),
    // Drapeau structuré #171 : présent dans le résumé (la prose, elle, absente)
    scalesAtHigherLevel: spellScalesAtHigherLevel(row),
    attackType: row.attack_type ?? null,
    // damage_json / dc_json are kept as raw JSON strings per the Spell type
    damageJson: row.damage_json ?? null,
    dcJson: row.dc_json ?? null,
    classes: parseJsonArray(row.classes_json, []),
  };
}

/**
 * Map a joined character_spells + spells row to CharacterSpell.
 * Expects spell columns to be prefixed with `s_` to avoid collisions
 * with the link table's own columns (id, prepared, sort_order, ...).
 */
export function mapCharacterSpell(row: any, lang: AppLang = 'fr'): CharacterSpell {
  const spellRow = {
    id: row.s_id,
    srd_index: row.s_srd_index,
    name: row.s_name,
    name_fr: row.s_name_fr,
    level: row.s_level,
    school: row.s_school,
    casting_time: row.s_casting_time,
    range_text: row.s_range_text,
    components: row.s_components,
    material: row.s_material,
    duration: row.s_duration,
    concentration: row.s_concentration,
    ritual: row.s_ritual,
    // Prose absente de la projection (mode résumé — voir LINK_WITH_SPELL) :
    // description/higher_level restent null, le client les charge à l'ouverture.
    // EXCEPTION #171 : higher_level × 2 (COLONNES courtes) servent à calculer
    // le drapeau scalesAtHigherLevel — la prose SERVIE reste null.
    higher_level: row.s_higher_level,
    higher_level_fr: row.s_higher_level_fr,
    attack_type: row.s_attack_type,
    damage_json: row.s_damage_json,
    dc_json: row.s_dc_json,
    classes_json: row.s_classes_json,
  };
  return {
    id: row.id,
    characterId: row.character_id,
    spell: mapSpell(spellRow, lang, true),
    prepared: !!row.prepared,
    classSource: row.class_source ?? null,
    source: row.source ?? null,
    sortOrder: row.sort_order ?? 0,
    addedAt: row.added_at,
  };
}

/**
 * Map a raw character_features row to CharacterFeature.
 * Handles snake_case → camelCase for the free-form trait columns.
 */
export function mapFeature(row: any): CharacterFeature {
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    category: row.category,
    description: row.description,
    catalogId: row.catalog_id ?? null,
    resetType: (row.reset_type as FeatureResetType | null) ?? null,
    counterMax: row.counter_max ?? null,
    counterCurrent: row.counter_current ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}
