/**
 * Seed the items table from data/items-seed.json (the SRD catalog, weights in kg)
 * and the spells table from data/spells-seed.json (the SRD spell catalog).
 * Idempotent: upserts keyed on srd_index — French translations in the seed JSON
 * are refreshed on re-seed.
 * Run: npm run seed
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveItemBases } from '@table-sync/shared';
import { getDb } from './index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the monorepo root (3 levels up from apps/api/src/db/). */
function monorepoRoot(): string {
  return resolve(__dirname, '..', '..', '..', '..');
}

function resolveSeedPath(filename: string): string {
  // 1. relative to cwd (npm run seed from root)
  // 2. relative to monorepo root (tsx src/db/seed.ts from apps/api)
  const candidates = [
    resolve(process.cwd(), 'data', filename),
    resolve(monorepoRoot(), 'data', filename),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      // try next
    }
  }
  throw new Error(`${filename} not found in: ${candidates.join(', ')}`);
}

interface SeedItem {
  source: 'srd';
  category: string;
  srdIndex: string;
  name: string;
  nameFr: string;
  rarity: string;
  weightKg: number | null;
  costQty: number | null;
  costUnit: string | null;
  description: string | null;
  damageDice: string | null;
  damageType: string | null;
  acBase: number | null;
  strMin: number | null;
  stealthDisadvantage: boolean;
  properties: string[];
  imagePath: string | null;
}

const INSERT = `
  INSERT INTO items (
    source, party_id, category, srd_index, name, name_fr, rarity,
    weight_kg, cost_qty, cost_unit, description, description_en,
    damage_dice, damage_type, ac_base, str_min, stealth_disadvantage,
    properties_json, survival_tags, aliases, image_path,
    base_weapon, base_armor, armor_family, magic_bonus
  ) VALUES (
    'srd', NULL, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?
  )
  ON CONFLICT(srd_index) DO UPDATE SET
    name_fr = excluded.name_fr,
    weight_kg = excluded.weight_kg,
    description = excluded.description,
    description_en = excluded.description_en,
    survival_tags = excluded.survival_tags,
    aliases = excluded.aliases,
    base_weapon = excluded.base_weapon,
    base_armor = excluded.base_armor,
    armor_family = excluded.armor_family,
    magic_bonus = excluded.magic_bonus
`;

// SRD items that count as food or water for survival tracking
const SURVIVAL_TAGS: Record<string, string[]> = {
  'rations-1-day': ['food'],
  waterskin: ['water'],
};

// Alternative search names for items where the official French translation
// differs from common usage or AideDD naming
const ITEM_ALIASES: Record<string, string[]> = {
  'tinkers-tools': ['bricoleur', 'outils de bricoleur'],
  'thieves-tools': ['outils de voleur', 'crochetage'],
  'disguise-kit': ['kit de déguisement'],
  'forgery-kit': ['kit de contrefaçon', 'falsification'],
  'herbalism-kit': ["kit d'herboriste", 'herboristerie'],
  'poisoners-kit': ["kit d'empoisonneur", 'empoisonnement'],
  'navigators-tools': ['outils de navigation'],
  'alchemists-supplies': ["fournitures d'alchimiste", 'alchimie'],
  'brewers-supplies': ['fournitures de brasseur', 'brasserie'],
  'calligraphers-supplies': ['fournitures de calligraphe', 'calligraphie'],
  'carpenters-tools': ['outils de charpentier', 'charpente'],
  'cartographers-tools': ['outils de cartographe', 'cartographie'],
  'cobblers-tools': ['outils de cordonnier', 'cordonnerie'],
  'cooks-utensils': ['ustensiles de cuisinier', 'cuisine'],
  'glassblowers-tools': ['outils de verrier', 'verrerie'],
  'jewelers-tools': ['outils de joaillier', 'joaillerie'],
  'leatherworkers-tools': ['outils de tanneur', 'tannerie'],
  'masons-tools': ['outils de maçon', 'maçonnerie'],
  'painters-supplies': ['fournitures de peintre', 'peinture'],
  'potters-tools': ['outils de potier', 'poterie'],
  'smiths-tools': ['outils de forgeron', 'forge'],
  'weavers-tools': ['outils de tisserand', 'tissage'],
  'woodcarvers-tools': ['outils de sculpteur sur bois', 'sculpture'],
  'scale-mail': ["armure d'écailles", 'écailles'],
  'mage-armor': ['armure du mage'],
  'crossbow-light': ['arbalète légère'],
  'crossbow-heavy': ['arbalète lourde'],
  'crossbow-hand': ['arbalète de poing'],
};

const COUNT_SQL = `SELECT COUNT(*) as n FROM items WHERE source = 'srd'`;

export function seedItems(): void {
  const db = getDb();
  const seedPath = resolveSeedPath('items-seed.json');
  const items = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedItem[];
  console.log(`[seed] loading from ${seedPath}`);

  const before = (db.prepare(COUNT_SQL).get() as { n: number }).n;

  const insert = db.prepare(INSERT);
  const tx = db.transaction((rows: SeedItem[]) => {
    for (const it of rows) {
      // Clés de base résolues UNE FOIS à l'import (docs/i18n-engine-refactor-plan.md)
      const bases = resolveItemBases(it);
      insert.run(
        it.category,
        it.srdIndex,
        it.name,
        it.nameFr || it.name,
        it.rarity,
        it.weightKg,
        it.costQty,
        it.costUnit,
        it.description,
        (it as { descriptionEn?: string | null }).descriptionEn ?? null,
        it.damageDice,
        it.damageType,
        it.acBase,
        it.strMin,
        it.stealthDisadvantage ? 1 : 0,
        JSON.stringify(it.properties),
        JSON.stringify(SURVIVAL_TAGS[it.srdIndex] || []),
        JSON.stringify(ITEM_ALIASES[it.srdIndex] || []),
        it.imagePath,
        bases.baseWeapon,
        bases.baseArmor,
        bases.armorFamily,
        bases.magicBonus,
      );
    }
  });
  tx(items);

  const after = (db.prepare(COUNT_SQL).get() as { n: number }).n;
  console.log(`[seed] SRD items: ${before} → ${after} (inserted ${after - before})`);
}

// ---------- Spells ----------

interface SeedSpell {
  srdIndex: string;
  name: string;
  nameFr: string | null;
  level: number;
  school: string;
  castingTime: string;
  rangeText: string;
  components: string[];
  material: string | null;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  descriptionFr: string | null;
  higherLevel: string | null;
  higherLevelFr: string | null;
  attackType: string | null;
  damageJson: string | null;
  dcJson: string | null;
  classes: string[]; // French class names: ["Magicien","Ensorceleur"]
}

const SPELL_INSERT = `
  INSERT INTO spells (
    srd_index, name, name_fr, level, school, casting_time, range_text,
    components, material, duration, concentration, ritual,
    description, description_fr, higher_level, higher_level_fr,
    attack_type, damage_json, dc_json, classes_json, sort_order
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?
  )
  ON CONFLICT(srd_index) DO UPDATE SET
    name_fr = excluded.name_fr,
    casting_time = excluded.casting_time,
    range_text = excluded.range_text,
    duration = excluded.duration,
    material = excluded.material,
    description_fr = excluded.description_fr,
    higher_level_fr = excluded.higher_level_fr,
    damage_json = excluded.damage_json,
    classes_json = excluded.classes_json
`;

const SPELL_COUNT_SQL = `SELECT COUNT(*) as n FROM spells`;

export function seedSpells(): void {
  const db = getDb();
  const seedPath = resolveSeedPath('spells-seed.json');
  const spells = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedSpell[];
  console.log(`[seed] loading spells from ${seedPath}`);

  const before = (db.prepare(SPELL_COUNT_SQL).get() as { n: number }).n;

  const insert = db.prepare(SPELL_INSERT);
  const tx = db.transaction((rows: SeedSpell[]) => {
    rows.forEach((s, i) => {
      insert.run(
        s.srdIndex,
        s.name,
        s.nameFr || s.name,
        s.level,
        s.school,
        s.castingTime,
        s.rangeText,
        JSON.stringify(s.components),
        s.material,
        s.duration,
        s.concentration ? 1 : 0,
        s.ritual ? 1 : 0,
        s.description,
        s.descriptionFr,
        s.higherLevel,
        s.higherLevelFr,
        s.attackType,
        s.damageJson,
        s.dcJson,
        JSON.stringify(s.classes),
        i, // sort_order: SRD catalog order
      );
    });
  });
  tx(spells);

  const after = (db.prepare(SPELL_COUNT_SQL).get() as { n: number }).n;
  console.log(`[seed] SRD spells: ${before} → ${after} (inserted ${after - before})`);
}

// ---------- Monsters ----------

interface SeedMonsterAction {
  name: string;
  desc: string;
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  cost?: number;
}

interface SeedMonster {
  slug: string;
  nameFr: string;
  type: string;
  subtype: string | null;
  size: string;
  alignment: string | null;
  armorClass: number;
  armorDesc: string | null;
  hitPoints: number;
  hitDice: string | null;
  speed: Record<string, number>;
  abilities: { for: number; dex: number; con: number; int: number; sag: number; cha: number };
  savingThrows: string[];
  skills: { name: string; isExpert: boolean }[];
  languages: string[];
  challengeRating: number;
  xp: number;
  senses: string | null;
  telepathy: number | null;
  damageResistances: string[] | null;
  damageImmunities: string[] | null;
  conditionImmunities: string[] | null;
  traits: SeedMonsterAction[];
  actions: SeedMonsterAction[];
  legendaryActions: SeedMonsterAction[];
  source: string;
  sourcePage: number | null;
}

const MONSTER_INSERT = `
  INSERT INTO monsters (
    slug, name_fr, type, subtype, size, alignment,
    armor_class, armor_desc, hit_points, hit_dice,
    speed_json, abilities_json, saving_throws_json, skills_json, languages_json,
    challenge_rating, xp, senses, telepathy,
    damage_resistances_json, damage_immunities_json, condition_immunities_json,
    traits_json, actions_json, legendary_actions_json, source, overlay_en
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?,
    ?
  )
  ON CONFLICT(slug) DO UPDATE SET
    name_fr = excluded.name_fr,
    type = excluded.type,
    armor_class = excluded.armor_class,
    hit_points = excluded.hit_points,
    challenge_rating = excluded.challenge_rating,
    abilities_json = excluded.abilities_json,
    actions_json = excluded.actions_json,
    legendary_actions_json = excluded.legendary_actions_json,
    traits_json = excluded.traits_json,
    overlay_en = excluded.overlay_en
`;

const MONSTER_COUNT_SQL = `SELECT COUNT(*) as n FROM monsters`;

export function seedMonsters(): void {
  const db = getDb();
  const seedPath = resolveSeedPath('monsters-seed.json');
  const monsters = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedMonster[];
  console.log(`[seed] loading monsters from ${seedPath}`);
  // Overlay anglais (bestiaire localisé — voir docs/i18n-english-plan.md)
  let enOverlay: Record<string, unknown> = {};
  try {
    const enPath = resolveSeedPath('monsters-en.json');
    enOverlay = JSON.parse(readFileSync(enPath, 'utf8')) as Record<string, unknown>;
    console.log(`[seed] EN monster overlay: ${Object.keys(enOverlay).length} entries`);
  } catch {
    console.log('[seed] no EN monster overlay found (FR-only)');
  }

  const before = (db.prepare(MONSTER_COUNT_SQL).get() as { n: number }).n;

  const insert = db.prepare(MONSTER_INSERT);
  const tx = db.transaction((rows: SeedMonster[]) => {
    for (const m of rows) {
      insert.run(
        m.slug,
        m.nameFr,
        m.type,
        m.subtype,
        m.size,
        m.alignment,
        m.armorClass,
        m.armorDesc,
        m.hitPoints,
        m.hitDice,
        JSON.stringify(m.speed),
        JSON.stringify(m.abilities),
        JSON.stringify(m.savingThrows),
        JSON.stringify(m.skills),
        JSON.stringify(m.languages),
        m.challengeRating,
        m.xp,
        m.senses,
        m.telepathy,
        m.damageResistances ? JSON.stringify(m.damageResistances) : null,
        m.damageImmunities ? JSON.stringify(m.damageImmunities) : null,
        m.conditionImmunities ? JSON.stringify(m.conditionImmunities) : null,
        JSON.stringify(m.traits),
        JSON.stringify(m.actions),
        JSON.stringify(m.legendaryActions),
        m.source,
        enOverlay[m.slug] ? JSON.stringify(enOverlay[m.slug]) : null,
      );
    }
  });
  tx(monsters);

  const after = (db.prepare(MONSTER_COUNT_SQL).get() as { n: number }).n;
  console.log(`[seed] SRD monsters: ${before} → ${after} (inserted ${after - before})`);
}

// If run directly, migrate first then seed
if (import.meta.url === `file://${process.argv[1]}`) {
  const { migrate } = await import('./index.ts');
  migrate();
  seedItems();
  seedSpells();
  seedMonsters();
  console.log('[seed] done.');
}
