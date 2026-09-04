/**
 * Helpers shared across route modules: membership checks, item/character shaping.
 */

import { randomInt } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Character,
  type CharacterClassEntry,
  type CharacterFeature,
  type CharacterSpell,
  type CharacterSummary,
  type CostUnit,
  findClass,
  type InventoryEntry,
  type Item,
  type ItemCategory,
  type Rarity,
  type Spell,
  type SpellSchool,
} from '@table-sync/shared';
import { CLASS_SUBCLASSES, type FeatureResetType } from '@table-sync/shared/classFeatures';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb, getItemImagesDir } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  characterClasses,
  characters,
  combatants,
  encounters,
  partyMembers,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { type AppLang, pickLocalized } from './lang.ts';
import { apiMsg } from './messages.ts';

/** Parse a JSON column that's guaranteed to be an array; never throws. */
function parseJsonArray(raw: any, fallback: any[] = []): any[] {
  if (!raw) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Get the authenticated user id from the JWT-decoded payload. */
export function getUserId(req: FastifyRequest): number | null {
  const sub = (req as any).user?.sub;
  return typeof sub === 'number' ? sub : null;
}

/** Reject if not authenticated. Returns userId or sends 401 and returns null. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): number | null {
  const id = getUserId(req);
  if (id === null) {
    reply.code(401).send({ error: apiMsg(req, 'unauthorized') });
    return null;
  }
  return id;
}

/** Is this user a member (gm or player) of this party? */
export function isPartyMember(partyId: number, userId: number): boolean {
  const row = getDrizzle()
    .select({ one: sql`1` })
    .from(partyMembers)
    .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, userId)))
    .get();
  return !!row;
}

/** Is this user the GM of this party? */
export function isPartyGM(partyId: number, userId: number): boolean {
  const row = getDrizzle()
    .select({ one: sql`1` })
    .from(partyMembers)
    .where(
      and(
        eq(partyMembers.partyId, partyId),
        eq(partyMembers.userId, userId),
        eq(partyMembers.role, 'gm'),
      ),
    )
    .get();
  return !!row;
}

/** Can this user mutate the character's inventory (sheet owner or party GM)? */
export function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

/**
 * Can this user SEE this character? Hidden (secret prep) characters are
 * visible to their owner and the GM only — other party members get 404s.
 */
export function characterVisibleTo(char: any, userId: number): boolean {
  return !char.hidden || char.owner_id === userId || isPartyGM(char.party_id, userId);
}

/** Generate a 6-char invite code (uppercase, unambiguous chars, crypto-random). */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[randomInt(chars.length)];
  return out;
}

// ---------- Multiclassage (SRD 5.1) : lignes de classe ----------

/**
 * Load the character_classes rows for a batch of characters (position order).
 * Map key = character_id → raw rows; mapCharacterSummary reads `row._classes`.
 */
export function loadCharacterClasses(characterIds: number[]): Map<number, any[]> {
  const map = new Map<number, any[]>();
  if (characterIds.length === 0) return map;
  const rows = getDrizzle()
    .select(cols(characterClasses))
    .from(characterClasses)
    .where(inArray(characterClasses.characterId, characterIds))
    .orderBy(characterClasses.position, characterClasses.id)
    .all() as any[];
  for (const row of rows) {
    const list = map.get(row.character_id) ?? [];
    list.push(row);
    map.set(row.character_id, list);
  }
  return map;
}

/** Attach `row._classes` (raw character_classes rows) in place, for the mappers. */
export function attachCharacterClasses(rows: any[]): void {
  const map = loadCharacterClasses(rows.map((r) => r.id));
  for (const row of rows) row._classes = map.get(row.id) ?? [];
}

/**
 * Validate a `classes[]` payload (structural only — prereq violations are the
 * UI's job, per the app's helper-not-automation philosophy). Checks: known
 * class keys, unique keys, per-class level 1-20, total ≤ 20, subclass ∈
 * catalog and past its RAW acquisition level.
 */
export function validateClassEntries(
  raw: unknown,
): { ok: true; entries: CharacterClassEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: apiMsg(req, 'classes doit être un tableau non vide') };
  }
  const seen = new Set<string>();
  let total = 0;
  const entries: CharacterClassEntry[] = [];
  for (const item of raw) {
    const info = findClass(item?.classKey ?? '');
    if (!info) return { ok: false, error: `classe inconnue : ${item?.classKey}` };
    if (seen.has(info.name)) {
      return { ok: false, error: `classe en double : ${info.name}` };
    }
    seen.add(info.name);
    const level = item?.level;
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      return { ok: false, error: `niveau invalide pour ${info.name} (1-20)` };
    }
    total += level;
    let subclassKey: string | null = item?.subclassKey ?? null;
    if (subclassKey !== null) {
      const defs = CLASS_SUBCLASSES[info.name] ?? [];
      const def = defs.find((s) => s.key === subclassKey);
      if (!def)
        return { ok: false, error: `sous-classe inconnue pour ${info.name} : ${subclassKey}` };
      if (def.level > level) {
        return {
          ok: false,
          error: `${def.label} nécessite ${info.name} niveau ${def.level} (actuel ${level})`,
        };
      }
      if (typeof subclassKey !== 'string') subclassKey = null;
    }
    entries.push({
      classKey: info.name,
      level,
      subclassKey,
      hitDiceUsed: Number.isInteger(item?.hitDiceUsed) ? Math.max(0, item.hitDiceUsed) : 0,
      fightingStyle: item?.fightingStyle ?? null,
    });
  }
  if (total > 20) return { ok: false, error: `niveau total > 20 (${total})` };
  return { ok: true, entries };
}

/**
 * Replace a character's class lines in one transaction and re-sync the
 * denormalized flat columns (character_class/level/subclass columns/
 * fighting_style/hit_dice_used = sum). Position 0 = starting class.
 */
export function replaceCharacterClasses(characterId: number, entries: CharacterClassEntry[]): void {
  const db = getDb();
  const drizzle = getDrizzle();
  db.transaction(() => {
    drizzle.delete(characterClasses).where(eq(characterClasses.characterId, characterId)).run();
    for (const [position, entry] of entries.entries()) {
      drizzle
        .insert(characterClasses)
        .values({
          characterId,
          classKey: entry.classKey,
          level: entry.level,
          subclassKey: entry.subclassKey ?? null,
          hitDiceUsed: entry.hitDiceUsed ?? 0,
          fightingStyle: entry.fightingStyle ?? null,
          position,
        })
        .run();
    }
    const first = entries[0];
    const hitDiceTotal = entries.reduce((sum, e) => sum + (e.hitDiceUsed ?? 0), 0);
    const style = entries.find((e) => e.fightingStyle)?.fightingStyle ?? null;
    // The starting class's subclass lands in its dedicated column (Clerc/
    // Druide/Paladin) or the generic one — property-keyed spread replaces
    // the old interpolated `${col}` column picker.
    const subclassSet =
      first.classKey === 'Clerc'
        ? { divineDomain: first.subclassKey ?? null }
        : first.classKey === 'Druide'
          ? { druidCircle: first.subclassKey ?? null }
          : first.classKey === 'Paladin'
            ? { sacredOath: first.subclassKey ?? null }
            : { subclass: first.subclassKey ?? null };
    drizzle
      .update(characters)
      .set({
        characterClass: first.classKey,
        level: entries.reduce((sum, e) => sum + e.level, 0),
        ...subclassSet,
        fightingStyle: style,
        hitDiceUsed: hitDiceTotal,
      })
      .where(eq(characters.id, characterId))
      .run();
  })();
}

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
    hasDescription: !!description,
    baseWeapon: row.base_weapon ?? null,
    baseArmor: row.base_armor ?? null,
    armorFamily: row.armor_family ?? null,
    magicBonus: row.magic_bonus ?? null,
    damageDice: row.damage_dice,
    damageType: row.damage_type,
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
        description: row.i_description,
        damage_dice: row.i_damage_dice,
        damage_type: row.i_damage_type,
        ac_base: row.i_ac_base,
        str_min: row.i_str_min,
        stealth_disadvantage: row.i_stealth_disadvantage,
        properties_json: row.i_properties_json,
        survival_tags: row.i_survival_tags,
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
    description: row.s_description,
    description_fr: row.s_description_fr,
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

// ---------- Condition sync between character sheet and combat tracker ----------

/** Parse a characters.conditions column (string[] of French names). */
function parseCharConditions(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse a combatants.conditions column ({name, duration}[]). */
function parseCombatantConditions(raw: any): Array<{ name: string; duration: number | null }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as any;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Sheet → tracker: apply condition name changes (added/removed) to a
 * character's combatants in non-ended encounters. Sheet-added conditions
 * carry no duration (until removed); tracker-only conditions with durations
 * are preserved. Emits combat:change.
 */
export function mirrorConditionsToCombatants(
  partyId: number,
  charId: number,
  added: string[],
  removed: string[],
  actorUserId: number,
): void {
  if (added.length === 0 && removed.length === 0) return;
  const drizzle = getDrizzle();
  const rows = drizzle
    .select({ id: combatants.id, conditions: combatants.conditions })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(
      and(
        eq(combatants.characterId, charId),
        eq(combatants.type, 'player'),
        ne(encounters.status, 'ended'),
      ),
    )
    .all() as any[];
  let changed = false;
  for (const row of rows) {
    let conds = parseCombatantConditions(row.conditions);
    conds = conds.filter((c) => !removed.includes(c.name));
    for (const name of added) {
      if (!conds.some((c) => c.name === name)) conds.push({ name, duration: null });
    }
    const next = JSON.stringify(conds);
    if (next !== row.conditions) {
      drizzle.update(combatants).set({ conditions: next }).where(eq(combatants.id, row.id)).run();
      changed = true;
    }
  }
  if (changed) {
    bus.emitChange({ type: 'combat:change', partyId, action: 'condition', actorUserId });
  }
}

/**
 * Tracker → sheet: apply condition name changes to the character sheet
 * (plain name list, no durations). Emits character:change.
 */
export function mirrorConditionsToCharacter(
  partyId: number,
  characterId: number,
  added: string[],
  removed: string[],
  actorUserId: number,
): void {
  if (added.length === 0 && removed.length === 0) return;
  const drizzle = getDrizzle();
  const ch = drizzle
    .select({ conditions: characters.conditions })
    .from(characters)
    .where(eq(characters.id, characterId))
    .get() as any;
  if (!ch) return;
  let list = parseCharConditions(ch.conditions);
  list = list.filter((n) => !removed.includes(n));
  for (const name of added) {
    if (!list.includes(name)) list.push(name);
  }
  const next = JSON.stringify(list);
  if (next !== ch.conditions) {
    drizzle
      .update(characters)
      .set({ conditions: next })
      .where(eq(characters.id, characterId))
      .run();
    bus.emitChange({
      type: 'character:change',
      partyId,
      characterId,
      action: 'condition',
      actorUserId,
    });
  }
}
