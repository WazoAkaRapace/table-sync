/**
 * Drizzle schema — source of truth for FUTURE schema changes.
 *
 * It mirrors the legacy-complete state (schema.sql + every COLUMN_MIGRATIONS
 * entry). Those legacy files are FROZEN: they still run on boot to create the
 * baseline, but never grow again. From now on:
 *
 *   1. edit this file
 *   2. npm run db:generate   (drizzle-kit generate → apps/api/drizzle/00NN_*.sql)
 *   3. commit schema.ts + the generated migration file
 *
 * Server boot applies pending migrations automatically (db/drizzle.ts).
 * The `drizzle/0000_*.sql` baseline is intentionally a no-op: the legacy
 * migrate() already creates the full schema on every DB, so 0000 only pins
 * the snapshot the diff chain starts from.
 *
 * Known unrepresentable details (kept correct by the frozen legacy path):
 * - `users.username` has `COLLATE NOCASE` (Drizzle has no column-collation API).
 *   If a future migration ever rebuilds the users table, re-add it by hand in SQL.
 * - JSON-in-TEXT columns are declared plain `text()`; switch individual columns
 *   to `text({ mode: 'json' })` only when their query sites migrate to Drizzle.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique('users_username_unique'),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  // Stocké normalisé (trim + minuscules) côté API ; les comptes existants
  // restent sans email (nullable). Unique sans COLLATE NOCASE : la
  // normalisation applicative suffit, pas de rebuild de table.
  email: text('email').unique('users_email_unique'),
  // NULL = adresse non vérifiée. Renseigné par le clic sur le lien de
  // vérification (ou par un reset de mot de passe réussi : le clic sur le
  // lien e-mail prouve la maîtrise de la boîte).
  emailVerifiedAt: text('email_verified_at'),
  // Changement en attente : l'adresse vérifiée reste active jusqu'à ce que
  // la nouvelle prouve la boîte via son propre lien (unique, NULL multiples ok).
  pendingEmail: text('pending_email').unique('users_pending_email_unique'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const parties = sqliteTable(
  'parties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    gmUserId: integer('gm_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteCode: text('invite_code').notNull().unique('parties_invite_code_unique'),
    encumbranceMode: text('encumbrance_mode').notNull().default('variant'),
    // Players may create custom items themselves (GM keeps the kill switch).
    playersCreateItems: integer('players_create_items').notNull().default(1),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (_t) => [
    check(
      'parties_encumbrance_mode_check',
      sql`encumbrance_mode IN ('variant','standard','slots')`,
    ),
  ],
);

export const partyMembers = sqliteTable(
  'party_members',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('player'),
    joinedAt: text('joined_at').notNull().default(sql`(datetime('now'))`),
    // Per-member "last opened" — drives the register's ordering (most
    // recently opened party first). NULL = never opened (falls back to
    // the party's created_at when sorting).
    lastOpenedAt: text('last_opened_at'),
  },
  (t) => [
    primaryKey({ columns: [t.partyId, t.userId] }),
    check('party_members_role_check', sql`role IN ('gm','player')`),
  ],
);

/** GM bans: the door is locked against the invite code for these users. */
export const partyBans = sqliteTable(
  'party_bans',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedAt: text('banned_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    primaryKey({ columns: [t.partyId, t.userId] }),
    index('idx_party_bans_user').on(t.userId),
  ],
);

export const characters = sqliteTable(
  'characters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    strength: integer('strength').notNull().default(10),
    capacityMultiplier: real('capacity_multiplier').notNull().default(1.0),
    exhaustion: integer('exhaustion').notNull().default(0),
    conditions: text('conditions').notNull().default('[]'),
    foodDays: integer('food_days').notNull().default(0),
    waterDays: integer('water_days').notNull().default(0),
    maxHp: integer('max_hp').notNull().default(1),
    currentHp: integer('current_hp').notNull().default(1),
    tempHp: integer('temp_hp').notNull().default(0),
    // --- Character sheet: ability scores, class/race/level, skills, spells ---
    level: integer('level').notNull().default(1),
    dexterity: integer('dexterity').notNull().default(10),
    constitution: integer('constitution').notNull().default(10),
    intelligence: integer('intelligence').notNull().default(10),
    wisdom: integer('wisdom').notNull().default(10),
    charisma: integer('charisma').notNull().default(10),
    characterClass: text('character_class'),
    race: text('race'),
    background: text('background'),
    speed: real('speed').notNull().default(9), // meters (9 m = 30 ft)
    skillProficiencies: text('skill_proficiencies').notNull().default('[]'),
    skillExpertise: text('skill_expertise').notNull().default('[]'),
    toolProficiencies: text('tool_proficiencies').notNull().default('[]'),
    toolExpertise: text('tool_expertise').notNull().default('[]'),
    languages: text('languages').notNull().default('[]'),
    savingThrowProficiencies: text('saving_throw_proficiencies').notNull().default('[]'),
    spellSlotsUsed: text('spell_slots_used').notNull().default('[0,0,0,0,0,0,0,0,0]'),
    // --- Description / personality ---
    alignment: text('alignment'),
    sex: text('sex'),
    height: text('height'),
    weight: text('weight'),
    age: text('age'),
    skin: text('skin'),
    eyes: text('eyes'),
    hair: text('hair'),
    portraitUrl: text('portrait_url'),
    personalityTraits: text('personality_traits'),
    ideals: text('ideals'),
    bonds: text('bonds'),
    flaws: text('flaws'),
    appearance: text('appearance'),
    backstory: text('backstory'),
    alliesOrganizations: text('allies_organizations'),
    armorClassOverride: integer('armor_class_override'),
    deathSaveSuccesses: integer('death_save_successes').notNull().default(0),
    deathSaveFailures: integer('death_save_failures').notNull().default(0),
    inspiration: integer('inspiration').notNull().default(0),
    // Secret character prep: invisible to other players, inactive in combat
    hidden: integer('hidden').notNull().default(0),
    notes: text('notes'),
    copper: integer('copper').notNull().default(0),
    silver: integer('silver').notNull().default(0),
    electrum: integer('electrum').notNull().default(0),
    gold: integer('gold').notNull().default(0),
    platinum: integer('platinum').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    // --- Columns historically added via COLUMN_MIGRATIONS (ALTER TABLE) ---
    concentrating: integer('concentrating').notNull().default(0),
    weaponProficiencies: text('weapon_proficiencies'),
    armorProficiencies: text('armor_proficiencies'),
    fightingStyle: text('fighting_style'),
    wildShapeSlug: text('wild_shape_slug'),
    wildShapeHp: integer('wild_shape_hp'),
    wildShapeMaxHp: integer('wild_shape_max_hp'),
    wildShapeUses: integer('wild_shape_uses').notNull().default(2),
    hitDiceUsed: integer('hit_dice_used').notNull().default(0),
    wildShapeSeenJson: text('wild_shape_seen_json').notNull().default('[]'),
    druidCircle: text('druid_circle'),
    divineDomain: text('divine_domain'),
    landCircle: text('land_circle'),
    sacredOath: text('sacred_oath'),
    // Subclass key (CLASS_SUBCLASSES) for classes without a dedicated column
    subclass: text('subclass'),
    // --- Multiclassage (SRD 5.1) ---
    // Pact-magic pool (Occultiste), SEPARATE from spell_slots_used: a
    // warlock mixed with another caster owns both pools and they would
    // collide at the same array index. Recharges on a short rest.
    pactSlotsUsed: text('pact_slots_used').notNull().default('[0,0,0,0,0,0,0,0,0]'),
    // Active Unarmored Defense when several are available (null = best auto)
    unarmoredDefense: text('unarmored_defense'),
  },
  (t) => [
    check('characters_strength_check', sql`strength >= 1`),
    check('characters_capacity_multiplier_check', sql`capacity_multiplier > 0`),
    check('characters_exhaustion_check', sql`exhaustion >= 0 AND exhaustion <= 6`),
    check('characters_max_hp_check', sql`max_hp >= 1`),
    check('characters_level_check', sql`level >= 1 AND level <= 20`),
    index('idx_characters_party').on(t.partyId),
    index('idx_characters_owner').on(t.ownerId),
  ],
);

// ---------- Multiclassage: one row per class line (SRD 5.1) ----------
// The flat characters columns (character_class, level, subclass…) stay as a
// denormalized view of the STARTING class (position 0) + total level = SUM.
export const characterClasses = sqliteTable(
  'character_classes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** French class name (DND_CLASSES). */
    classKey: text('class_key').notNull(),
    /** Levels in THIS class — the character's total level is the SUM. */
    level: integer('level').notNull().default(1),
    /** Subclass taken in this class (CLASS_SUBCLASSES key). */
    subclassKey: text('subclass_key'),
    /** Hit dice of this class already spent. */
    hitDiceUsed: integer('hit_dice_used').notNull().default(0),
    /** Fighting style taken through this class (Guerrier 1, Paladin 2, Rôdeur 2). */
    fightingStyle: text('fighting_style'),
    /** 0 = starting class (max-HD first level, full proficiencies). */
    position: integer('position').notNull().default(0),
  },
  (t) => [
    unique('character_classes_character_class_unique').on(t.characterId, t.classKey),
    index('idx_character_classes_character').on(t.characterId),
    check('character_classes_level_check', sql`level >= 1 AND level <= 20`),
  ],
);

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull().default('srd'),
    partyId: integer('party_id').references(() => parties.id, { onDelete: 'cascade' }), // NULL = global/SRD
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }), // author of a custom item (players can author too)
    category: text('category').notNull(),
    srdIndex: text('srd_index'), // original SRD index for dedup
    name: text('name').notNull(),
    nameFr: text('name_fr'),
    rarity: text('rarity').notNull().default('none'),
    weightKg: real('weight_kg'), // KILOGRAMS; NULL if unknown
    costQty: integer('cost_qty'),
    costUnit: text('cost_unit'),
    description: text('description'),
    descriptionEn: text('description_en'),
    baseWeapon: text('base_weapon'),
    baseArmor: text('base_armor'),
    armorFamily: text('armor_family'),
    magicBonus: integer('magic_bonus'),
    damageDice: text('damage_dice'),
    damageType: text('damage_type'),
    acBase: integer('ac_base'),
    strMin: integer('str_min'),
    stealthDisadvantage: integer('stealth_disadvantage').notNull().default(0),
    propertiesJson: text('properties_json').notNull().default('[]'),
    survivalTags: text('survival_tags').notNull().default('[]'),
    aliases: text('aliases'),
    imagePath: text('image_path'),
    // Internal path to the attached illustration (data/images/items/<id>.jpg)
    // — never exposed in payloads, only the derived hasImage boolean is.
    imageUrl: text('image_url'),
    // Annotation d'exemplaire : copie dérivée de l'objet de base (dessin/notes
    // aplatis dans SON image). SET NULL si la base disparaît — l'exemplaire
    // annoté vit sa vie. Toujours NULL sur les objets de catalogue.
    derivedFromItemId: integer('derived_from_item_id').references(() => items.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check('items_source_check', sql`source IN ('srd','custom')`),
    unique('items_srd_index_unique').on(t.srdIndex),
    index('idx_items_category').on(t.category),
    index('idx_items_party').on(t.partyId),
    index('idx_items_name').on(t.name),
  ],
);

export const storageLocations = sqliteTable(
  'storage_locations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull().default('carried'),
    strength: integer('strength').default(10), // for mounts: their Strength score
    multiplier: real('multiplier').notNull().default(1.0), // Beast of Burden = 2, cart = 5
    capacityKg: real('capacity_kg'), // fixed capacity for containers (Bag of Holding = 227)
    ownWeightKg: real('own_weight_kg').notNull().default(0),
    itemId: integer('item_id').references(() => items.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_storage_locations_character').on(t.characterId),
    check('storage_locations_type_check', sql`type IN ('carried','mount','container')`),
  ],
);

export const inventory = sqliteTable(
  'inventory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    equipped: integer('equipped').notNull().default(0),
    notes: text('notes'),
    storageLocationId: integer('storage_location_id').references(() => storageLocations.id, {
      onDelete: 'set null',
    }),
    addedAt: text('added_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    unique('inventory_character_item_location_unique').on(
      t.characterId,
      t.itemId,
      t.storageLocationId,
    ),
    index('idx_inventory_character').on(t.characterId),
    index('idx_inventory_location').on(t.storageLocationId),
    check('inventory_quantity_check', sql`quantity >= 0`),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    characterId: integer('character_id').references(() => characters.id, { onDelete: 'set null' }),
    itemId: integer('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemName: text('item_name').notNull(), // snapshot in case item is deleted
    deltaQty: integer('delta_qty').notNull(),
    reason: text('reason').notNull().default('adjust'),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    at: text('at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_transactions_party').on(t.partyId)],
);

export const npcs = sqliteTable(
  'npcs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    location: text('location'),
    faction: text('faction'),
    disposition: text('disposition').notNull().default('neutral'),
    status: text('status').notNull().default('alive'),
    description: text('description'),
    secret: text('secret'),
    isShared: integer('is_shared').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_npcs_party').on(t.partyId),
    index('idx_npcs_shared').on(t.partyId, t.isShared),
  ],
);

// ---------- SRD Spell catalog (reference data, seeded) ----------

export const spells = sqliteTable(
  'spells',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    srdIndex: text('srd_index').notNull().unique('spells_srd_index_unique'),
    name: text('name').notNull(),
    nameFr: text('name_fr'),
    level: integer('level').notNull(),
    school: text('school').notNull(),
    castingTime: text('casting_time'),
    rangeText: text('range_text'),
    components: text('components').notNull().default('[]'),
    material: text('material'),
    duration: text('duration'),
    concentration: integer('concentration').notNull().default(0),
    ritual: integer('ritual').notNull().default(0),
    description: text('description'),
    descriptionFr: text('description_fr'),
    higherLevel: text('higher_level'),
    higherLevelFr: text('higher_level_fr'),
    attackType: text('attack_type'),
    damageJson: text('damage_json'),
    dcJson: text('dc_json'),
    classesJson: text('classes_json').notNull().default('[]'),
    sortOrder: integer('sort_order').default(0),
  },
  (t) => [
    index('idx_spells_level').on(t.level),
    index('idx_spells_name').on(t.name),
    index('idx_spells_name_fr').on(t.nameFr),
  ],
);

// ---------- Character ↔ Spell (known/prepared spells) ----------

export const characterSpells = sqliteTable(
  'character_spells',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    spellId: integer('spell_id')
      .notNull()
      .references(() => spells.id, { onDelete: 'cascade' }),
    prepared: integer('prepared').notNull().default(0),
    /** Which class's list this spell was taken from (multiclassing SRD). */
    classSource: text('class_source'),
    sortOrder: integer('sort_order').notNull().default(0),
    addedAt: text('added_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    unique('character_spells_character_spell_unique').on(t.characterId, t.spellId),
    index('idx_character_spells_char').on(t.characterId),
    index('idx_character_spells_spell').on(t.spellId),
  ],
);

// ---------- Character features (free-form traits, class/racial/background/feat) ----------

export const characterFeatures = sqliteTable(
  'character_features',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    category: text('category').notNull().default('custom'),
    description: text('description'), // template text with {{variables}}
    counterMax: integer('counter_max'), // null/0 = no counter; positive = max charges
    counterCurrent: integer('counter_current'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    // Link to the SRD feature catalog (classFeatures.ts) — powers rest resets
    catalogId: text('catalog_id'),
    // Manual rest recharge for non-catalog traits: 'short' | 'long' | NULL
    resetType: text('reset_type'),
  },
  (t) => [index('idx_character_features_char').on(t.characterId)],
);

// ---------- Character notes (free-form with simple formatting) ----------

export const characterNotes = sqliteTable(
  'character_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content'), // Markdown-like plain text
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_character_notes_char').on(t.characterId)],
);

// ---------- Correspondance secrète MD ↔ joueur (fil par personnage) ----------

export const characterMessages = sqliteTable(
  'character_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    senderUserId: integer('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    // Lu par le destinataire (le propriétaire pour un message du MD, un MD
    // pour un message du joueur) — null = non lu. Pas d'édition ni de
    // suppression : le fil est un journal.
    readAt: text('read_at'),
  },
  (t) => [index('idx_character_messages_char').on(t.characterId, t.createdAt)],
);

// ---------- SRD Monster catalog (reference data, seeded from 5e-drs.fr) ----------

export const monsters = sqliteTable(
  'monsters',
  {
    slug: text('slug').primaryKey(),
    nameFr: text('name_fr').notNull(),
    /** Overlay anglais (nom + bloc de stat texte) — voir data/monsters-en.json. */
    overlayEn: text('overlay_en'),
    type: text('type'),
    subtype: text('subtype'),
    size: text('size'),
    alignment: text('alignment'),
    armorClass: integer('armor_class'),
    armorDesc: text('armor_desc'),
    hitPoints: integer('hit_points'),
    hitDice: text('hit_dice'),
    speedJson: text('speed_json'),
    abilitiesJson: text('abilities_json'),
    savingThrowsJson: text('saving_throws_json'),
    skillsJson: text('skills_json'),
    languagesJson: text('languages_json'),
    challengeRating: real('challenge_rating'),
    xp: integer('xp'),
    senses: text('senses'),
    telepathy: integer('telepathy'),
    damageResistancesJson: text('damage_resistances_json'),
    damageImmunitiesJson: text('damage_immunities_json'),
    conditionImmunitiesJson: text('condition_immunities_json'),
    traitsJson: text('traits_json'),
    actionsJson: text('actions_json'),
    legendaryActionsJson: text('legendary_actions_json'),
    source: text('source'),
  },
  (t) => [
    index('idx_monsters_name_fr').on(t.nameFr),
    index('idx_monsters_type').on(t.type),
    index('idx_monsters_cr').on(t.challengeRating),
  ],
);

// ---------- Combat encounters (initiative tracker, party-scoped) ----------

export const encounters = sqliteTable(
  'encounters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    round: integer('round').notNull().default(0), // 0 = setup, >=1 = in combat
    turnIndex: integer('turn_index').notNull().default(0),
    status: text('status').notNull().default('setup'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_encounters_party').on(t.partyId),
    check('encounters_status_check', sql`status IN ('setup','active','ended')`),
  ],
);

export const combatants = sqliteTable(
  'combatants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    encounterId: integer('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    characterId: integer('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    monsterSlug: text('monster_slug'),
    name: text('name').notNull(),
    count: integer('count').notNull().default(1),
    groupId: integer('group_id'), // shared by grouped monsters (same initiative)
    initiative: integer('initiative'), // NULL = not yet rolled
    initiativeBonus: integer('initiative_bonus').notNull().default(0), // dex mod cached at add time
    armorClass: integer('armor_class').notNull().default(10),
    hitPoints: integer('hit_points').notNull().default(1),
    maxHitPoints: integer('max_hit_points').notNull().default(1),
    conditions: text('conditions').notNull().default('[]'), // JSON: [{name,duration}]
    sortOrder: integer('sort_order').notNull().default(0),
    defeated: integer('defeated').notNull().default(0),
    cardColor: text('card_color'), // hex color for card background, NULL = default
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_combatants_encounter').on(t.encounterId),
    index('idx_combatants_character').on(t.characterId),
    check('combatants_type_check', sql`type IN ('player','monster')`),
  ],
);

// ---------- GM Assistant integration (group ↔ campaign link + chronicle cache) ----------
// Our writes over there are exactly two: the one-time init (campaign + player
// characters created FROM the group) and the GM-triggered character resync
// (upsert batch; deletion only ever explicit). Sessions and recaps are cached
// locally so players never hit the GMA API and a GMA outage degrades to a
// stale-but-readable chronicle.

/** A user's GM Assistant API key — server-side only, encrypted at rest. */
export const userGmaLinks = sqliteTable('user_gma_links', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // AES-256-GCM blob: v1:<iv b64>:<tag b64>:<ciphertext b64>
  apiKeyEnc: text('api_key_enc').notNull(),
  gmaAccountId: text('gma_account_id'),
  gmaEmail: text('gma_email'), // masked when served — never the raw key
  // 'read' | 'full_access' | NULL = unknown until the first write attempt
  scope: text('scope'),
  validatedAt: text('validated_at').notNull().default(sql`(datetime('now'))`),
});

/** 1:1 link between a party and a GM Assistant campaign. */
export const partyGmaLinks = sqliteTable(
  'party_gma_links',
  {
    partyId: integer('party_id')
      .primaryKey()
      .references(() => parties.id, { onDelete: 'cascade' }),
    gmaCampaignId: text('gma_campaign_id').notNull().unique('party_gma_links_campaign_unique'),
    campaignTitle: text('campaign_title').notNull(), // display cache
    linkedByUserId: integer('linked_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Party-wide sessions-list freshness marker (lives here, not on the rows:
    // an empty campaign has no rows to carry a timestamp).
    sessionsFetchedAt: text('sessions_fetched_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_party_gma_links_campaign').on(t.gmaCampaignId)],
);

/** Cache of the linked campaign's sessions — the chronicle's table of contents. */
export const gmaSessions = sqliteTable(
  'gma_sessions',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    title: text('title').notNull(),
    playedAt: text('played_at'), // YYYY-MM-DD or null
    sortOrder: integer('sort_order').notNull().default(0),
    // Per-session content freshness marker — recaps AND memorable moments
    // (fetched together). null = content never fetched.
    recapsFetchedAt: text('recaps_fetched_at'),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.sessionId] })],
);

/** Cache of one session's recaps (every style; `default` served first). */
export const gmaRecaps = sqliteTable(
  'gma_recaps',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    style: text('style').notNull(),
    text: text('text').notNull(),
    updatedAt: text('updated_at'), // GMA-side timestamp, display only
  },
  (t) => [primaryKey({ columns: [t.partyId, t.sessionId, t.style] })],
);

/** Cache of one session's memorable moments (fetched with the recaps). */
export const gmaMoments = sqliteTable(
  'gma_moments',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    momentId: text('moment_id').notNull(),
    isQuote: integer('is_quote').notNull().default(0),
    type: text('type'),
    description: text('description').notNull(),
    speaker: text('speaker'),
    context: text('context'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.partyId, t.sessionId, t.momentId] }),
    index('idx_gma_moments_session').on(t.partyId, t.sessionId),
  ],
);

// ---------- Push notifications (Web Push / VAPID) ----------

/**
 * One Web Push subscription per browser/appareil. The push service's endpoint
 * URL is the natural key — re-subscribing from the same browser upserts its
 * keys (they rotate). `locale` freezes the user's language at subscribe time
 * so server-initiated payloads can localize title/body without a request.
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique('push_subscriptions_endpoint_unique'),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    locale: text('locale').notNull().default('fr'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    // NULL = never sent to; diagnostic marker only.
    lastUsedAt: text('last_used_at'),
  },
  (t) => [index('idx_push_subscriptions_user').on(t.userId)],
);

// ---------- Emails transactionnels (réinitialisation de mot de passe) ----------

/**
 * Jetons de réinitialisation de mot de passe. Seul le SHA-256 hexadécimal du
 * jeton est stocké — le jeton brut ne vit que dans le lien e-mail. Un seul
 * jeton actif par utilisateur (les non-consommés sont supprimés à chaque
 * demande). `locale` fige la langue de l'e-mail au moment de la demande,
 * même principe que push_subscriptions.locale.
 */
export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique('password_reset_tokens_hash_unique'),
    locale: text('locale').notNull().default('fr'),
    expiresAt: text('expires_at').notNull(),
    // NULL = en attente ; renseigné à la consommation (usage unique).
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_password_reset_tokens_user').on(t.userId)],
);

/**
 * Jetons de vérification d'adresse e-mail — mêmes règles de stockage que les
 * jetons de reset (SHA-256 seulement, usage unique, un seul actif par
 * utilisateur, locale figée à la demande). TTL plus long (24 h) : la
 * vérification n'est pas une opération critique comme un changement de mot
 * de passe.
 */
export const emailVerificationTokens = sqliteTable(
  'email_verification_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique('email_verification_tokens_hash_unique'),
    locale: text('locale').notNull().default('fr'),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_email_verification_tokens_user').on(t.userId)],
);

/** Mapping local character ↔ GMA player character (written by init + resync). */
export const gmaPcLinks = sqliteTable(
  'gma_pc_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    // SET NULL: a deleted local sheet leaves an ORPHAN link — surfaced in the
    // resync diff, deleted on GMA only via an explicit confirmed gesture.
    characterId: integer('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    gmaPcId: text('gma_pc_id').notNull().unique('gma_pc_links_pc_unique'),
    nameAtSync: text('name_at_sync').notNull(), // display name for orphan rows
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    unique('gma_pc_links_party_character_unique').on(t.partyId, t.characterId),
    index('idx_gma_pc_links_party').on(t.partyId),
  ],
);
