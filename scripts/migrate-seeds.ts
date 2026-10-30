#!/usr/bin/env tsx
/**
 * Migration des seeds (audit 2026-10-30 — plan audit/plans/PLAN-seeds.md).
 *
 * Applique les correctifs du lot A (data/items-seed.json) et du lot B
 * (data/spells-seed.json), keyed sur srdIndex, 100 % idempotent : une règle ne
 * touche une entrée que si sa valeur actuelle diffère de la cible.
 *
 *   npx tsx scripts/migrate-seeds.ts                 # dry-run, affiche le diff complet
 *   npx tsx scripts/migrate-seeds.ts --apply         # écrit les fichiers
 *   npx tsx scripts/migrate-seeds.ts --lot=items     # un seul lot (items | spells | all)
 *   npx tsx scripts/migrate-seeds.ts --lot=spells --apply
 *
 * Édition de référence : 2014 / SRD 5.1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ITEMS_FILE = resolve(ROOT, 'data', 'items-seed.json');
const SPELLS_FILE = resolve(ROOT, 'data', 'spells-seed.json');

// ---------- Types (sous-ensemble des champs utilisés) ----------

interface SeedItem {
  source: string;
  category: string;
  srdIndex: string;
  name: string;
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
  nameFr: string;
  [key: string]: unknown;
}

interface SeedSpell {
  srdIndex: string;
  castingTime: string;
  duration: string;
  description: string;
  descriptionFr: string | null;
  damageJson: string | null;
  [key: string]: unknown;
}

interface Change {
  rule: string;
  srdIndex: string;
  field: string;
  from: unknown;
  to: unknown;
}

const changes: Change[] = [];

function record(rule: string, srdIndex: string, field: string, from: unknown, to: unknown): void {
  changes.push({ rule, srdIndex, field, from, to });
}

/** Pose `to` sur obj[field] si différent ; enregistre le changement. */
function setField<T extends object>(rule: string, obj: T, field: keyof T, to: T[keyof T]): void {
  const from = obj[field];
  if (JSON.stringify(from) !== JSON.stringify(to)) {
    record(rule, (obj as { srdIndex?: string }).srdIndex ?? '?', String(field), from, to);
    obj[field] = to;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 90 ? `${s.slice(0, 90)}…` : (s ?? 'null');
}

// ---------- Lot A — items ----------

/** A7 : lots de munitions (les unités restent, taguées survival). */
const AMMO_LOTS: Array<{
  srdIndex: string;
  name: string;
  nameFr: string;
  weightKg: number;
  costQty: number;
  costUnit: string;
  description: string;
}> = [
  {
    srdIndex: 'arrows-20',
    name: 'Arrows (20)',
    nameFr: 'Flèches (20)',
    weightKg: 0.4,
    costQty: 1,
    costUnit: 'gp',
    description: 'Lot de 20 flèches.',
  },
  {
    srdIndex: 'crossbow-bolts-20',
    name: 'Crossbow bolts (20)',
    nameFr: 'Carreaux (20)',
    weightKg: 0.75,
    costQty: 1,
    costUnit: 'gp',
    description: 'Lot de 20 carreaux.',
  },
  {
    srdIndex: 'sling-bullets-20',
    name: 'Sling bullets (20)',
    nameFr: 'Balles de fronde (20)',
    weightKg: 0.75,
    costQty: 4,
    costUnit: 'cp',
    description: 'Lot de 20 balles de fronde.',
  },
  {
    srdIndex: 'blowgun-needles-50',
    name: 'Blowgun needles (50)',
    nameFr: 'Fléchettes de sarbacane (50)',
    weightKg: 0.5,
    costQty: 1,
    costUnit: 'gp',
    description: 'Lot de 50 fléchettes de sarbacane.',
  },
];

/** A7 : description ajoutée aux munitions unitaires (elles restent consommables). */
const AMMO_UNIT_NOTES: Record<string, string> = {
  arrow: "Vendue à l'unité ; le lot de 20 coûte 1 gp.",
  'crossbow-bolt': "Vendu à l'unité ; le lot de 20 coûte 1 gp.",
  'sling-bullet': "Vendue à l'unité ; le lot de 20 coûte 4 pc.",
  'blowgun-needle': "Vendue à l'unité ; le lot de 50 coûte 1 gp.",
};

/** A9 : contenu SRD des 7 sacs d'équipement (qté × slug). */
const PACKS: Record<string, Array<[string, number]>> = {
  'burglars-pack': [
    ['backpack', 1],
    ['string-10-feet', 1],
    ['bell', 1],
    ['candle', 5],
    ['crowbar', 1],
    ['hammer', 1],
    ['piton', 10],
    ['lantern-hooded', 1],
    ['oil-flask', 2],
    ['rations-1-day', 5],
    ['tinderbox', 1],
    ['waterskin', 1],
  ],
  'diplomats-pack': [
    ['chest', 1],
    ['case-map-or-scroll', 2],
    ['clothes-fine', 2],
    ['ink-1-ounce-bottle', 1],
    ['ink-pen', 1],
    ['parchment-one-sheet', 2],
  ],
  'dungeoneers-pack': [
    ['backpack', 1],
    ['crowbar', 1],
    ['hammer', 1],
    ['piton', 10],
    ['torch', 10],
    ['tinderbox', 1],
    ['rations-1-day', 10],
    ['waterskin', 1],
    ['rope-hempen-50-feet', 1],
  ],
  'entertainers-pack': [
    ['backpack', 1],
    ['bedroll', 1],
    ['clothes-costume', 2],
    ['candle', 5],
    ['rations-1-day', 5],
    ['waterskin', 1],
  ],
  'explorers-pack': [
    ['backpack', 1],
    ['bedroll', 1],
    ['mess-kit', 1],
    ['tinderbox', 1],
    ['torch', 10],
    ['rations-1-day', 10],
    ['waterskin', 1],
    ['rope-hempen-50-feet', 1],
  ],
  'priests-pack': [
    ['backpack', 1],
    ['blanket', 1],
    ['candle', 10],
    ['tinderbox', 1],
    ['alms-box', 1],
    ['block-of-incense', 2],
    ['censer', 1],
    ['vestments', 1],
    ['rations-1-day', 2],
    ['waterskin', 1],
  ],
  'scholars-pack': [
    ['backpack', 1],
    ['book', 1],
    ['ink-1-ounce-bottle', 1],
    ['ink-pen', 1],
    ['parchment-one-sheet', 10],
    ['pouch', 1],
    ['small-knife', 1],
  ],
};

/** Poids attendus (plan §A9) — le script vérifie la somme calculée contre cette table. */
const PACK_WEIGHTS_EXPECTED: Record<string, number> = {
  'burglars-pack': 17.77,
  'diplomats-pack': 19.5,
  'dungeoneers-pack': 30.75,
  'entertainers-pack': 17.5,
  'explorers-pack': 29.5,
  'priests-pack': 11.1,
  'scholars-pack': 5.6,
};

function migrateItems(items: SeedItem[]): void {
  const byIndex = new Map(items.map((it) => [it.srdIndex, it]));
  const get = (srdIndex: string): SeedItem => {
    const it = byIndex.get(srdIndex);
    if (!it) throw new Error(`item introuvable dans le seed : ${srdIndex}`);
    return it;
  };

  // A1 — Chemise de mailles : 50 → 75 gp
  setField('A1', get('chain-shirt'), 'costQty', 75);

  // A2 — Harnois : 32,5 → 29,5 kg (tous les items à 32,5) + barding-plate 65 → 59
  for (const it of items) {
    if (it.weightKg === 32.5) setField('A2', it, 'weightKg', 29.5);
  }
  setField('A2', get('barding-plate'), 'weightKg', 59);

  // A3 — Cotte d'écailles : 22,5 → 20,4 kg (tous les items à 22,5) + barding 45 → 40,8
  for (const it of items) {
    if (it.weightKg === 22.5) setField('A3', it, 'weightKg', 20.4);
  }
  setField('A3', get('barding-scale-mail'), 'weightKg', 40.8);

  // A4 — Fronde : 1 sp → 1 cp
  setField('A4', get('sling'), 'costUnit', 'cp');

  // A5 — Lance d'arçon : propriété heavy
  {
    const lance = get('lance');
    if (!lance.properties.includes('heavy')) {
      setField('A5', lance, 'properties', ['heavy', ...lance.properties]);
    }
  }

  // A6 — Ceinturon de force de géant de pierre : 0,01 → 0,15 kg
  setField('A6', get('belt-of-giant-strength-stone'), 'weightKg', 0.15);

  // A7 — Lots de munitions (ajout) + note sur les unités
  for (const lot of AMMO_LOTS) {
    if (!byIndex.has(lot.srdIndex)) {
      const entry: SeedItem = {
        source: 'srd',
        category: 'gear',
        srdIndex: lot.srdIndex,
        name: lot.name,
        rarity: 'none',
        weightKg: lot.weightKg,
        costQty: lot.costQty,
        costUnit: lot.costUnit,
        description: lot.description,
        damageDice: null,
        damageType: null,
        acBase: null,
        strMin: null,
        stealthDisadvantage: false,
        properties: [],
        imagePath: null,
        nameFr: lot.nameFr,
      };
      items.push(entry);
      byIndex.set(lot.srdIndex, entry);
      record(
        'A7',
        lot.srdIndex,
        '(nouvel objet)',
        null,
        `${lot.nameFr} — ${lot.costQty} ${lot.costUnit}, ${lot.weightKg} kg`,
      );
    }
  }
  for (const [srdIndex, note] of Object.entries(AMMO_UNIT_NOTES)) {
    setField('A7', get(srdIndex), 'description', note);
  }

  // A8 — Rareté « peu commun » par détection (description FR contient « peu commun »,
  // rareté courante/none) — rien de codé en dur côté liste.
  for (const it of items) {
    if (
      it.description !== null &&
      it.description.includes('peu commun') &&
      (it.rarity === 'common' || it.rarity === 'none')
    ) {
      setField('A8', it, 'rarity', 'uncommon');
    }
  }

  // A9 — Sacs d'équipement : poids réel (somme des poids seed du contenu) + contenu en description
  for (const [pack, content] of Object.entries(PACKS)) {
    const packItem = get(pack);
    let weight = 0;
    const parts: string[] = [];
    for (const [slug, qty] of content) {
      const comp = get(slug);
      if (comp.weightKg === null) throw new Error(`composant ${slug} sans poids`);
      weight += comp.weightKg * qty;
      const nameFr = comp.nameFr || comp.name;
      parts.push(qty > 1 ? `${qty}× ${nameFr}` : nameFr);
    }
    const w = round2(weight);
    const expected = PACK_WEIGHTS_EXPECTED[pack];
    if (expected !== undefined && w !== expected) {
      throw new Error(`A9 ${pack} : poids calculé ${w} kg, attendu ${expected} kg (seed dérivé ?)`);
    }
    setField('A9', packItem, 'weightKg', w);
    setField('A9', packItem, 'description', `Contient : ${parts.join(', ')}.`);
  }
}

// ---------- Lot B — sorts ----------

interface DamageTypeRef {
  index: string;
  name: string;
  url: string;
}

const DAMAGE_TYPE_NAMES: Record<string, string> = {
  thunder: 'Thunder',
  fire: 'Fire',
  force: 'Force',
  lightning: 'Lightning',
  piercing: 'Piercing',
  cold: 'Cold',
  necrotic: 'Necrotic',
  poison: 'Poison',
  radiant: 'Radiant',
  bludgeoning: 'Bludgeoning',
  psychic: 'Psychic',
};

function damageTypeRef(index: string): DamageTypeRef {
  return { index, name: DAMAGE_TYPE_NAMES[index] ?? index, url: `/api/2014/damage-types/${index}` };
}

/** B1 — 14 cantrips de dégâts : table damage_at_character_level (paliers 1/5/11/17). */
const CANTRIP_TABLES: Record<
  string,
  { type: string | null; dice: [string, string, string, string] }
> = {
  thunderclap: { type: 'thunder', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'create-bonfire': { type: 'fire', dice: ['1d8', '2d8', '3d8', '4d8'] },
  'sword-burst': { type: 'force', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'lightning-lure': { type: 'lightning', dice: ['1d8', '2d8', '3d8', '4d8'] },
  'thorn-whip': { type: 'piercing', dice: ['1d6', '2d6', '3d6', '4d6'] },
  frostbite: { type: 'cold', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'toll-the-dead': { type: 'necrotic', dice: ['1d8', '2d8', '3d8', '4d8'] },
  infestation: { type: 'poison', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'green-flame-blade': { type: 'fire', dice: ['1d8', '2d8', '3d8', '4d8'] },
  'booming-blade': { type: 'thunder', dice: ['1d8', '2d8', '3d8', '4d8'] },
  'word-of-radiance': { type: 'radiant', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'magic-stone': { type: 'bludgeoning', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'mind-sliver': { type: 'psychic', dice: ['1d6', '2d6', '3d6', '4d6'] },
  'primal-savagery': { type: null, dice: ['1d10', '2d10', '3d10', '4d10'] },
};

/** B2 — 5 sorts scalants : damage_at_slot_level étendu de la base au niveau 9. */
const SLOT_TABLES: Record<string, Record<string, string>> = {
  sleep: {
    '1': '5d8',
    '2': '7d8',
    '3': '9d8',
    '4': '11d8',
    '5': '13d8',
    '6': '15d8',
    '7': '17d8',
    '8': '19d8',
    '9': '21d8',
  },
  'phantasmal-killer': {
    '4': '4d10',
    '5': '5d10',
    '6': '6d10',
    '7': '7d10',
    '8': '8d10',
    '9': '9d10',
  },
  'wall-of-fire': {
    '4': '5d8',
    '5': '6d8',
    '6': '7d8',
    '7': '8d8',
    '8': '9d8',
    '9': '10d8',
  },
  disintegrate: {
    '6': '10d6 + 40',
    '7': '13d6 + 40',
    '8': '16d6 + 40',
    '9': '19d6 + 40',
  },
  'freezing-sphere': {
    '6': '10d6',
    '7': '11d6',
    '8': '12d6',
    '9': '13d6',
  },
};

/** B3 — « round » → « tour » dans les champs FR uniquement (jamais la description EN). */
function frRoundsToTours(text: string): string {
  return text
    .replace(/\bRounds\b/g, 'Tours')
    .replace(/\bRound\b/g, 'Tour')
    .replace(/\brounds\b/g, 'tours')
    .replace(/\bround\b/g, 'tour');
}

function migrateSpells(spells: SeedSpell[]): void {
  const byIndex = new Map(spells.map((s) => [s.srdIndex, s]));
  const get = (srdIndex: string): SeedSpell => {
    const s = byIndex.get(srdIndex);
    if (!s) throw new Error(`sort introuvable dans le seed : ${srdIndex}`);
    return s;
  };

  // B1 — cantrips
  for (const [srdIndex, { type, dice }] of Object.entries(CANTRIP_TABLES)) {
    const spell = get(srdIndex);
    const damageJson = JSON.stringify({
      damage_type: type === null ? null : damageTypeRef(type),
      damage_at_character_level: { '1': dice[0], '5': dice[1], '11': dice[2], '17': dice[3] },
    });
    setField('B1', spell, 'damageJson', damageJson);
  }

  // B2 — sorts scalants (damage_type conservé s'il existe)
  for (const [srdIndex, table] of Object.entries(SLOT_TABLES)) {
    const spell = get(srdIndex);
    let parsed: Record<string, unknown> = {};
    if (spell.damageJson) {
      try {
        parsed = JSON.parse(spell.damageJson) as Record<string, unknown>;
      } catch {
        throw new Error(`B2 ${srdIndex} : damageJson illisible : ${spell.damageJson}`);
      }
    }
    parsed.damage_at_slot_level = table;
    setField('B2', spell, 'damageJson', JSON.stringify(parsed));
  }

  // B3 — round → tour (duration + descriptionFr uniquement)
  for (const spell of spells) {
    setField('B3', spell, 'duration', frRoundsToTours(spell.duration));
    if (spell.descriptionFr !== null) {
      setField('B3', spell, 'descriptionFr', frRoundsToTours(spell.descriptionFr));
    }
  }

  // B4 — Bouclier : « 1 reaction » → « 1 réaction »
  {
    const shield = get('shield');
    setField('B4', shield, 'castingTime', shield.castingTime.replace(/\breaction\b/g, 'réaction'));
  }
}

// ---------- main ----------

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const lotArg = args.find((a) => a.startsWith('--lot='))?.slice('--lot='.length) ?? 'all';
  if (!['all', 'items', 'spells'].includes(lotArg)) {
    console.error(`--lot invalide : ${lotArg} (items | spells | all)`);
    process.exit(1);
  }

  const doItems = lotArg === 'all' || lotArg === 'items';
  const doSpells = lotArg === 'all' || lotArg === 'spells';

  const items = doItems ? (JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) as SeedItem[]) : null;
  const spells = doSpells ? (JSON.parse(readFileSync(SPELLS_FILE, 'utf8')) as SeedSpell[]) : null;

  if (items) migrateItems(items);
  if (spells) migrateSpells(spells);

  // Rapport
  const byRule = new Map<string, Change[]>();
  for (const c of changes) {
    const list = byRule.get(c.rule) ?? [];
    list.push(c);
    byRule.set(c.rule, list);
  }
  console.log(
    `\n=== ${apply ? 'APPLY' : 'DRY-RUN'} (lot=${lotArg}) — ${changes.length} changement(s) ===\n`,
  );
  for (const [rule, list] of [...byRule.entries()].sort()) {
    const entries = new Set(list.map((c) => c.srdIndex));
    console.log(`${rule} : ${list.length} champ(s) sur ${entries.size} entrée(s)`);
    for (const c of list) {
      console.log(`  ${c.srdIndex} · ${c.field} : ${short(c.from)} → ${short(c.to)}`);
    }
  }
  if (changes.length === 0) console.log('(aucun changement — seeds déjà à jour)');

  if (apply) {
    if (items) writeFileSync(ITEMS_FILE, `${JSON.stringify(items, null, 2)}\n`);
    if (spells) writeFileSync(SPELLS_FILE, `${JSON.stringify(spells, null, 2)}\n`);
    console.log('\nFichiers écrits.');
  } else {
    console.log('\nDry-run — relancer avec --apply pour écrire.');
  }
}

main();
