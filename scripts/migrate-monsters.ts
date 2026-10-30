/**
 * Migration de data/monsters-seed.json — audit bestiaire 2026-10-30
 * (plan : audit/plans/PLAN-bestiaire.md, exécuté lot par lot).
 *
 * AMENDEMENT DE REVUE (LOT 1, acté par l'orchestrateur) : data/mm-bestiary-en.json
 * EST le MM 2014 (vérifié 450/450 CR+HP identiques au canon 2014) — les valeurs
 * Liche CR 21, Tyrannoeil CR 13, dragons, loups sont CORRECTES 2014 ; l'audit
 * d'origine comparait à une mauvaise table. Aucun correctif CR/XP/PV du LOT 1.
 *
 * Lots :
 *   --lot 2  PV/hitDice des 15 entrées du RAPPORT §1. Canon = bestiaires EN locaux
 *            (cos/mm/vrgr, résolution récursive des _copy). Si PV du seed = moyenne
 *            canonique -> PV conservé, hitDice recalculé pour coller au PV (dés/type
 *            de dé canoniques, bonus ajusté). Si PV != canonique -> PV corrigé +
 *            hitDice = formule canonique. Si aucun canon local -> repli : dé par
 *            taille (TP=d4, P=d6, M=d8, G=d10, TG=d12, Gig=d20), nombre de dés depuis
 *            PV / moyenne du dé, bonus ajusté (flagué dans le rapport d'exécution).
 *   --lot 3  Vitesses : chaînes numériques -> nombres ("4,50" -> 4.5, "9" -> 9)
 *            sur walk/fly/swim/burrow/climb ; "NaN" -> valeur canonique CoS
 *            (ft -> m : round(ft / 3.28084 / 1.5) * 1.5). hover/special/canHover
 *            INTACTS (y compris canHover "0,3" — convention maison).
 *   --lot 4  Perception passive ajoutée aux monstres dont senses ne la contient pas :
 *            passive = 10 + mod SAG + (compétence perception ? prof : 0),
 *            prof = max(2, floor(CR/4) + 2). Les passives existantes ne sont PAS touchées.
 *   --lot 5  --report-only : écrit docs/bestiary-english-prose.md (table
 *            slug | nameFr | source des monstres dont la prose contient >= 3
 *            occurrences des expressions anglaises {damage, saving throw, must make,
 *            hit points, attack roll}). Aucune donnée seed modifiée.
 *
 * Usage :
 *   npx tsx scripts/migrate-monsters.ts --lot 2 --dry-run   # affiche le diff, n'écrit rien
 *   npx tsx scripts/migrate-monsters.ts --lot 2 --apply     # écrit le seed
 *   npx tsx scripts/migrate-monsters.ts --lot 5 --report-only
 *   (sans --lot : applique les lots 2-4 ; --dry-run est le mode par défaut)
 *
 * Idempotent, keyed sur slug : relancer un lot appliqué ne produit aucun diff.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SEED_PATH = resolve(ROOT, 'data/monsters-seed.json');
const OVERLAY_PATH = resolve(ROOT, 'data/monsters-en.json');
const DOC_PATH = resolve(ROOT, 'docs/bestiary-english-prose.md');

// ---------- Types ----------

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
  speed: Record<string, number | string | boolean>;
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

interface EnMonster {
  name: string;
  source?: string;
  hp?: { average: number; formula: string };
  speed?: Record<string, number | { number: number; condition?: string } | undefined>;
  _copy?: { name: string; source?: string };
}

// ---------- Entrées du LOT 2 (RAPPORT §1) et noms EN ----------

const LOT2_SLUGS = [
  'arabelle',
  'armored-saber-toothed-tiger',
  'avatar-de-la-mort',
  'beucephalus',
  'emil-toranescu',
  'esprit-verdoyant',
  'exethanter',
  'hraesvelgr',
  'ireena-kolyana',
  'kiril-stoyanovich',
  'marchefleche',
  'orobas',
  'sangzor',
  'vladimir-horngaard',
  'zmey-bebecephale',
];

// Noms EN pour les slugs absents de l'overlay monsters-en.json (monstres CoS).
const EN_NAME_MAP: Record<string, string> = {
  arabelle: 'Arabelle',
  'armored-saber-toothed-tiger': 'Armored Saber-Toothed Tiger',
  'avatar-de-la-mort': 'Avatar of Death',
  beucephalus: 'Beucephalus',
  'emil-toranescu': 'Emil Toranescu',
  'esprit-verdoyant': 'Verdant Spirit',
  exethanter: 'Exethanter',
  hraesvelgr: 'Hraesvelgr',
  'ireena-kolyana': 'Ireena Kolyana',
  'kiril-stoyanovich': 'Kiril Stoyanovich',
  marchefleche: 'Spire Walker',
  orobas: 'Orobas',
  sangzor: 'Sangzor',
  'vladimir-horngaard': 'Vladimir Horngaard',
  'zmey-bebecephale': 'Baby Zmey',
  'animated-halberd': 'Animated Halberd',
  'broom-of-animated-attack': 'Broom of Animated Attack',
  'bray-martikov': 'Bray Martikov',
  'brom-martikov': 'Brom Martikov',
  'danika-dorakova': 'Danika Dorakova',
  'davian-martikov': 'Davian Martikov',
  'rosavalda-rose-durst': 'Rosavalda "Rose" Durst',
  'snow-maiden': 'Snow Maiden',
  'thornboldt-thorn-durst': 'Thornboldt "Thorn" Durst',
  'urwin-martikov': 'Urwin Martikov',
  'young-wereraven': 'Young Wereraven',
  'zuleika-toranescu': 'Zuleika Toranescu',
};

// ---------- Chargement ----------

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const seed = loadJson(SEED_PATH) as SeedMonster[];
const overlay = loadJson(OVERLAY_PATH) as Record<string, { name?: string }>;
const bestiaries: Record<string, EnMonster[]> = {
  cos: (loadJson(resolve(ROOT, 'data/cos-bestiary-en.json')) as { monster: EnMonster[] }).monster,
  mm: (loadJson(resolve(ROOT, 'data/mm-bestiary-en.json')) as { monster: EnMonster[] }).monster,
  vrgr: (loadJson(resolve(ROOT, 'data/vrgr-bestiary-en.json')) as { monster: EnMonster[] }).monster,
};

function enName(slug: string): string | null {
  return overlay[slug]?.name ?? EN_NAME_MAP[slug] ?? null;
}

/** Résout un monstre EN par nom dans cos -> mm -> vrgr, en suivant les _copy. */
function resolveEn(name: string, depth = 0): EnMonster | null {
  if (depth > 5) return null;
  for (const tag of ['cos', 'mm', 'vrgr'] as const) {
    const hit = bestiaries[tag].find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (hit) {
      if (hit.hp || hit.speed || !hit._copy) return hit;
      const base = resolveEn(hit._copy.name, depth + 1);
      if (base && (base.hp || base.speed)) {
        return { ...base, name: hit.name, _copy: undefined };
      }
      return hit;
    }
  }
  return null;
}

// ---------- Helpers ----------

const DIE_BY_SIZE: Record<string, number> = { TP: 4, P: 6, M: 8, G: 10, TG: 12, Gig: 20 };
const SPEED_KEYS = ['walk', 'fly', 'swim', 'burrow', 'climb'] as const;
const NUMERIC_STRING = /^\d+([.,]\d+)?$/;

/** Moyenne d'un dé : (die + 1) / 2. */
const dieMean = (die: number) => (die + 1) / 2;

interface DiceParts {
  dice: number;
  die: number;
  bonus: number;
}

function parseDice(formula: string): DiceParts | null {
  const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(formula.replace(/\s+/g, ''));
  if (!m) return null;
  return {
    dice: Number(m[1]),
    die: Number(m[2]),
    bonus: m[3] ? Number(m[3].replace(/\s/g, '')) : 0,
  };
}

function formatDice({ dice, die, bonus }: DiceParts): string {
  const sign = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : '';
  return `${dice}d${die}${sign}`;
}

/** ft -> m, arrondi au multiple de 1,5 (plan LOT 3). */
function ftToM(ft: number): number {
  return Math.round(ft / 3.28084 / 1.5) * 1.5;
}

// ---------- LOT 2 : PV / hitDice ----------

interface Lot2Change {
  slug: string;
  hitPoints?: { from: number; to: number };
  hitDice?: { from: string | null; to: string };
  note: string;
}

function lot2(): Lot2Change[] {
  const changes: Lot2Change[] = [];
  for (const slug of LOT2_SLUGS) {
    const m = seed.find((x) => x.slug === slug);
    if (!m) {
      changes.push({ slug, note: 'ABSENT du seed — aucune écriture' });
      continue;
    }
    const name = enName(slug);
    const canon = name ? resolveEn(name) : null;
    const canonHp = canon?.hp;
    if (canonHp) {
      if (m.hitPoints === canonHp.average) {
        // PV canonique : on recalcule hitDice pour coller au PV.
        const parts = parseDice(canonHp.formula);
        let dice: number, die: number;
        if (parts) {
          dice = parts.dice;
          die = parts.die;
        } else {
          die = DIE_BY_SIZE[m.size] ?? 8;
          dice = Math.round(m.hitPoints / dieMean(die));
        }
        const bonus = Math.round(m.hitPoints - dice * dieMean(die));
        const hitDice = formatDice({ dice, die, bonus });
        if (m.hitDice !== hitDice) {
          changes.push({
            slug,
            hitDice: { from: m.hitDice, to: hitDice },
            note: `PV ${m.hitPoints} = canon (${canonHp.formula}) -> hitDice recalculé`,
          });
          m.hitDice = hitDice;
        } else {
          changes.push({ slug, note: `déjà conforme (${hitDice}) — aucune écriture` });
        }
      } else {
        // PV non canonique : on corrige PV + hitDice = formule canonique.
        const parts = parseDice(canonHp.formula);
        const hitDice = parts
          ? formatDice(parts)
          : formatDice({
              dice: Math.round(canonHp.average / dieMean(DIE_BY_SIZE[m.size] ?? 8)),
              die: DIE_BY_SIZE[m.size] ?? 8,
              bonus: 0,
            });
        changes.push({
          slug,
          hitPoints: { from: m.hitPoints, to: canonHp.average },
          hitDice: { from: m.hitDice, to: hitDice },
          note: `PV corrigé sur canon ${canonHp.average} (${canonHp.formula})`,
        });
        m.hitPoints = canonHp.average;
        m.hitDice = hitDice;
      }
    } else {
      // Aucun canon local : repli dé par taille + PV (plan, règle 2 « à défaut »).
      const die = DIE_BY_SIZE[m.size] ?? 8;
      const dice = Math.round(m.hitPoints / dieMean(die));
      const bonus = Math.round(m.hitPoints - dice * dieMean(die));
      const hitDice = formatDice({ dice, die, bonus });
      if (m.hitDice !== hitDice) {
        changes.push({
          slug,
          hitDice: { from: m.hitDice, to: hitDice },
          note: `pas de canon EN local -> repli taille ${m.size} (d${die}) depuis PV ${m.hitPoints}`,
        });
        m.hitDice = hitDice;
      } else {
        changes.push({ slug, note: `déjà conforme (${hitDice}) — aucune écriture` });
      }
    }
  }
  return changes;
}

// ---------- LOT 3 : vitesses ----------

interface Lot3Change {
  slug: string;
  key: string;
  from: string | number;
  to: number;
  note: string;
}

function lot3(): Lot3Change[] {
  const changes: Lot3Change[] = [];
  for (const m of seed) {
    for (const key of SPEED_KEYS) {
      const v = m.speed[key];
      if (typeof v !== 'string') continue;
      if (v.trim() === 'NaN') {
        // Valeur canonique CoS via le bestiaire EN local.
        const name = enName(m.slug);
        const canon = name ? resolveEn(name) : null;
        const raw = canon?.speed?.[key];
        const ft = typeof raw === 'number' ? raw : raw?.number;
        if (ft == null) {
          changes.push({
            slug: m.slug,
            key,
            from: v,
            to: NaN,
            note: 'NaN sans canon local — flag manuel',
          });
          continue;
        }
        const to = ftToM(ft);
        changes.push({ slug: m.slug, key, from: v, to, note: `NaN -> canon ${ft} ft = ${to} m` });
        m.speed[key] = to;
      } else if (NUMERIC_STRING.test(v.trim())) {
        const to = Number(v.trim().replace(',', '.'));
        changes.push({ slug: m.slug, key, from: v, to, note: 'chaîne numérique -> nombre' });
        m.speed[key] = to;
      }
    }
  }
  return changes;
}

// ---------- LOT 4 : Perception passive ----------

interface Lot4Change {
  slug: string;
  from: string | null;
  to: string;
  passive: number;
}

function lot4(): Lot4Change[] {
  const changes: Lot4Change[] = [];
  for (const m of seed) {
    if (m.senses && m.senses.includes('Perception passive')) continue;
    const mod = Math.floor((m.abilities.sag - 10) / 2);
    const prof = Math.max(2, Math.floor(m.challengeRating / 4) + 2);
    const hasPerception = m.skills.some((s) => /^perception/i.test(s.name));
    const passive = 10 + mod + (hasPerception ? prof : 0);
    const to = m.senses
      ? `${m.senses}, Perception passive ${passive}`
      : `Perception passive ${passive}`;
    changes.push({ slug: m.slug, from: m.senses, to, passive });
    m.senses = to;
  }
  return changes;
}

// ---------- LOT 5 : rapport prose anglaise (aucune donnée modifiée) ----------

const EN_PHRASES = ['damage', 'saving throw', 'must make', 'hit points', 'attack roll'];

function lot5Rows(): { slug: string; nameFr: string; source: string; hits: number }[] {
  const rows: { slug: string; nameFr: string; source: string; hits: number }[] = [];
  for (const m of seed) {
    const prose = [...m.traits, ...m.actions, ...m.legendaryActions]
      .map((a) => a.desc)
      .join(' ')
      .toLowerCase();
    const hits = EN_PHRASES.reduce((n, p) => n + prose.split(p).length - 1, 0);
    if (hits >= 3) rows.push({ slug: m.slug, nameFr: m.nameFr, source: m.source, hits });
  }
  return rows;
}

function writeLot5Doc(
  rows: { slug: string; nameFr: string; source: string; hits: number }[],
): void {
  const lines = [
    '# Bestiaire — prose anglaise restante (rapport-only)',
    '',
    `Généré le 2026-10-30 par \`npx tsx scripts/migrate-monsters.ts --lot 5 --report-only\``,
    '(plan `audit/plans/PLAN-bestiaire.md`, LOT 5). Aucune donnée seed modifiée.',
    '',
    `Règle : monstres dont la prose FR (concaténation des \`desc\` de \`traits\` + \`actions\``,
    `+ \`legendaryActions\`) contient **>= 3 occurrences** des expressions anglaises`,
    '`damage`, `saving throw`, `must make`, `hit points`, `attack roll` (insensible à la casse).',
    '',
    `**${rows.length} monstre(s)** signalé(s) sur ${seed.length}.`,
    '',
    '| slug | nom FR | source | occurrences EN |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.slug} | ${r.nameFr} | ${r.source} | ${r.hits} |`),
    '',
  ];
  writeFileSync(DOC_PATH, lines.join('\n'));
}

// ---------- CLI ----------

function main(): void {
  const args = process.argv.slice(2);
  const lotArg =
    args.find((a) => a.startsWith('--lot='))?.slice(6) ??
    (args.includes('--lot') ? args[args.indexOf('--lot') + 1] : null);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const reportOnly = args.includes('--report-only');

  const lots = lotArg && lotArg !== 'all' ? [Number(lotArg)] : [2, 3, 4];

  if (lots.includes(5) || reportOnly) {
    const rows = lot5Rows();
    writeLot5Doc(rows);
    console.log(`[lot 5] ${rows.length} monstre(s) à prose anglaise -> ${DOC_PATH}`);
    return;
  }

  console.log(`[migrate-monsters] lots ${lots.join(', ')} — mode ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  if (lots.includes(2)) {
    const changes = lot2();
    const writes = changes.filter((c) => c.hitPoints || c.hitDice);
    console.log(`[lot 2] ${writes.length} écriture(s) sur ${LOT2_SLUGS.length} entrées :`);
    for (const c of changes) {
      const hp = c.hitPoints ? ` PV ${c.hitPoints.from}->${c.hitPoints.to}` : '';
      const hd = c.hitDice
        ? ` hitDice ${JSON.stringify(c.hitDice.from)}->${JSON.stringify(c.hitDice.to)}`
        : '';
      console.log(`  - ${c.slug}:${hp}${hd} — ${c.note}`);
    }
  }
  if (lots.includes(3)) {
    const changes = lot3();
    const nan = changes.filter((c) => c.note.startsWith('NaN'));
    const num = changes.filter((c) => !c.note.startsWith('NaN'));
    console.log(
      `[lot 3] ${changes.length} conversion(s) : ${num.length} chaînes numériques, ${nan.length} NaN`,
    );
    if (dryRun) {
      for (const c of changes.slice(0, 40)) {
        console.log(`  - ${c.slug}.${c.key}: ${JSON.stringify(c.from)} -> ${c.to} (${c.note})`);
      }
      if (changes.length > 40) console.log(`  … ${changes.length - 40} de plus`);
    }
  }
  if (lots.includes(4)) {
    const changes = lot4();
    console.log(`[lot 4] ${changes.length} Perception passive ajoutées`);
    if (dryRun) {
      for (const c of changes.slice(0, 10)) console.log(`  - ${c.slug}: ${JSON.stringify(c.to)}`);
      if (changes.length > 10) console.log(`  … ${changes.length - 10} de plus`);
    }
  }

  if (dryRun) {
    console.log('[migrate-monsters] DRY-RUN — aucune écriture (relance avec --apply)');
  } else {
    writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2));
    console.log(`[migrate-monsters] seed écrit : ${SEED_PATH}`);
  }
}

main();
