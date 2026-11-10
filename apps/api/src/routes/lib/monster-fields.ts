/**
 * Validation + mapping des monstres personnalisés — extrait de
 * routes/monsters.ts (gate modularity R1 : aucun fichier de routes > 700
 * lignes). Gabarit de validateWeaponFields/validateArmorFields (items.ts) :
 * `input` porte les champs fournis (ou fusionnés avec la ligne existante
 * pour un PATCH) ; retourne le message d'erreur FR, ou les champs validés.
 */

import {
  MONSTER_TYPES_FR,
  MONSTER_CR_VALUES,
  MONSTER_SIZE_LABELS_FR,
  monsterXpForCR,
  parseMonsterActionCombatInfo,
} from '@table-sync/shared';
import type { MonsterAction } from '@table-sync/shared';
import { randomBytes } from 'node:crypto';
import { monsters } from '../../db/schema.ts';
import { normalizeText } from '../../db/index.ts';

/** Modes de vitesse SRD (en mètres). */
const SPEED_MODES = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;

/** Champs validés d'un monstre personnalisé (noyau combat structuré, Q5a). */
export interface MonsterFieldsChecked {
  nameFr: string;
  type: string;
  size: string;
  alignment: string | null;
  armorClass: number;
  armorDesc: string | null;
  hitPoints: number;
  hitDice: string | null;
  speed: Partial<Record<(typeof SPEED_MODES)[number], number>>;
  abilities: { for: number; dex: number; con: number; int: number; sag: number; cha: number };
  challengeRating: number;
  traits: { name: string; desc: string }[];
  actions: { name: string; desc: string }[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  senses: string | null;
  languages: string[];
}

/**
 * Valide le noyau structuré d'un monstre personnalisé : PX et bonus de
 * maîtrise sont DÉRIVÉS du FP (jamais saisis) ; les bonus d'attaque/dés des
 * actions sont parsés au mieux à l'écriture (best effort, jamais bloquants).
 */
export function validateMonsterFields(input: Record<string, any>): string | MonsterFieldsChecked {
  const nameFr = typeof input.nameFr === 'string' ? input.nameFr.trim() : '';
  if (!nameFr) return 'nom du monstre requis';
  if (nameFr.length > 120) return 'nom du monstre trop long';

  const type = typeof input.type === 'string' && input.type ? input.type : 'Humanoïde';
  if (!(MONSTER_TYPES_FR as readonly string[]).includes(type)) return 'type de monstre invalide';
  const size = typeof input.size === 'string' && input.size ? input.size : 'M';
  if (!Object.keys(MONSTER_SIZE_LABELS_FR).includes(size)) return 'taille de monstre invalide';
  const alignment =
    typeof input.alignment === 'string' && input.alignment.trim()
      ? input.alignment.trim().slice(0, 80)
      : null;

  const armorClass = input.armorClass;
  if (!Number.isInteger(armorClass) || armorClass < 1 || armorClass > 30) {
    return 'classe d’armure invalide';
  }
  const armorDesc =
    typeof input.armorDesc === 'string' && input.armorDesc.trim()
      ? input.armorDesc.trim().slice(0, 80)
      : null;

  const hitPoints = input.hitPoints;
  if (!Number.isInteger(hitPoints) || hitPoints < 1 || hitPoints > 2000) {
    return 'points de vie invalides';
  }
  const hitDice =
    typeof input.hitDice === 'string' && input.hitDice.trim()
      ? input.hitDice.trim().replace(/\s+/g, '')
      : null;
  // Formule NdX±m — le même format que rollHitPoints (shared) consomme à
  // l'ajout en rencontre (1-100 dés, faces 2-20).
  const diceMatch = hitDice !== null ? /^(\d{1,3})d(\d{1,2})([+-]\d{1,4})?$/.exec(hitDice) : null;
  if (hitDice !== null && diceMatch === null) return 'formule de dés de vie invalide';
  if (diceMatch !== null) {
    const n = parseInt(diceMatch[1], 10);
    const faces = parseInt(diceMatch[2], 10);
    if (n < 1 || n > 100 || faces < 2 || faces > 20) return 'formule de dés de vie invalide';
  }

  const speed: MonsterFieldsChecked['speed'] = {};
  const rawSpeed = input.speed && typeof input.speed === 'object' ? input.speed : {};
  for (const mode of SPEED_MODES) {
    const v = rawSpeed[mode];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 150) return 'vitesse invalide';
    if (n > 0) speed[mode] = Math.round(n);
  }

  const rawAbilities =
    input.abilities && typeof input.abilities === 'object' ? input.abilities : {};
  const abilities = {} as MonsterFieldsChecked['abilities'];
  for (const key of ['for', 'dex', 'con', 'int', 'sag', 'cha'] as const) {
    const v = Number(rawAbilities[key] ?? 10);
    if (!Number.isInteger(v) || v < 1 || v > 30) return 'caractéristique hors bornes';
    abilities[key] = v;
  }

  const challengeRating = Number(input.challengeRating);
  if (!(MONSTER_CR_VALUES as readonly number[]).includes(challengeRating)) {
    return 'facteur de puissance invalide';
  }

  const entries = (raw: unknown, label: string) => {
    if (!Array.isArray(raw)) return { list: [] as { name: string; desc: string }[], error: null };
    const list: { name: string; desc: string }[] = [];
    for (const e of raw.slice(0, 30)) {
      if (!e || typeof e !== 'object') return { list, error: `${label} invalide` };
      const name = typeof e.name === 'string' ? e.name.trim().slice(0, 80) : '';
      const text = typeof e.text === 'string' ? e.text.trim().slice(0, 2000) : '';
      if (!name || !text) continue; // lignes incomplètes ignorées
      list.push({ name, desc: text });
    }
    return { list, error: null };
  };
  const traits = entries(input.traits, 'trait');
  if (traits.error) return traits.error;
  const actions = entries(input.actions, 'action');
  if (actions.error) return actions.error;

  const stringList = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is string => typeof s === 'string' && !!s.trim())
      .map((s) => s.trim().slice(0, 60))
      .slice(0, 20);
  };

  const languagesRaw = input.languages;
  const languages = Array.isArray(languagesRaw)
    ? stringList(languagesRaw)
    : typeof languagesRaw === 'string' && languagesRaw.trim()
      ? languagesRaw
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

  const senses =
    typeof input.senses === 'string' && input.senses.trim()
      ? input.senses.trim().slice(0, 240)
      : null;

  return {
    nameFr,
    type,
    size,
    alignment,
    armorClass,
    armorDesc,
    hitPoints,
    hitDice,
    speed,
    abilities,
    challengeRating,
    traits: traits.list,
    actions: actions.list,
    damageResistances: stringList(input.damageResistances),
    damageImmunities: stringList(input.damageImmunities),
    conditionImmunities: stringList(input.conditionImmunities),
    senses,
    languages,
  };
}

/** Fusionne une payload PATCH partielle avec la ligne existante (re-validation
 *  sur le contexte complet — le champ absent garde sa valeur en base). Les
 *  listes stockées ({name, desc}) sont renormalisées au format d'entrée
 *  ({name, text}) pour repasser la même validation qu'à la création. */
export function mergeMonsterBody(row: any, body: Record<string, any>): Record<string, any> {
  const json = (raw: any, fallback: any) => {
    if (raw === null || raw === undefined) return fallback;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  };
  const entryList = (raw: unknown): { name: string; text: string }[] =>
    Array.isArray(raw)
      ? raw
          .filter((e) => e && typeof e === 'object')
          .map((e) => ({ name: String(e.name ?? ''), text: String(e.desc ?? e.text ?? '') }))
      : [];
  return {
    nameFr: body.nameFr !== undefined ? body.nameFr : row.name_fr,
    type: body.type !== undefined ? body.type : (row.type ?? 'Humanoïde'),
    size: body.size !== undefined ? body.size : (row.size ?? 'M'),
    alignment: body.alignment !== undefined ? body.alignment : row.alignment,
    armorClass: body.armorClass !== undefined ? body.armorClass : (row.armor_class ?? 10),
    armorDesc: body.armorDesc !== undefined ? body.armorDesc : row.armor_desc,
    hitPoints: body.hitPoints !== undefined ? body.hitPoints : (row.hit_points ?? 10),
    hitDice: body.hitDice !== undefined ? body.hitDice : row.hit_dice,
    speed: body.speed !== undefined ? body.speed : json(row.speed_json, {}),
    abilities: body.abilities !== undefined ? body.abilities : json(row.abilities_json, {}),
    challengeRating:
      body.challengeRating !== undefined ? body.challengeRating : (row.challenge_rating ?? 0),
    traits: body.traits !== undefined ? body.traits : entryList(json(row.traits_json, [])),
    actions: body.actions !== undefined ? body.actions : entryList(json(row.actions_json, [])),
    damageResistances:
      body.damageResistances !== undefined
        ? body.damageResistances
        : json(row.damage_resistances_json, []),
    damageImmunities:
      body.damageImmunities !== undefined
        ? body.damageImmunities
        : json(row.damage_immunities_json, []),
    conditionImmunities:
      body.conditionImmunities !== undefined
        ? body.conditionImmunities
        : json(row.condition_immunities_json, []),
    senses: body.senses !== undefined ? body.senses : row.senses,
    languages: body.languages !== undefined ? body.languages : json(row.languages_json, []),
  };
}

/** Slug serveur `custom-<slug(nom)>-<suffixe court>` — le préfixe ne
 *  collisionne jamais avec les slugs seedés (plan archi §1.2). */
export function customMonsterSlug(nameFr: string): string {
  const base = normalizeText(nameFr)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(2).toString('hex');
  return `custom-${base || 'monstre'}-${suffix}`;
}

/** Colonnes d'écriture dérivées des champs validés (insertion ET mise à jour —
 *  la payload remplace l'état complet du statblock, comme le panneau Arme). */
export function monsterValues(
  slug: string,
  f: MonsterFieldsChecked,
  partyId: number,
  createdBy: number,
): typeof monsters.$inferInsert {
  // Bonus d'attaque/dés parsés au mieux (même analyse que l'import SRD) —
  // best effort, jamais bloquant (Q5a).
  const withCombatInfo = (list: { name: string; desc: string }[]): MonsterAction[] =>
    list.map((e) => ({
      ...e,
      ...parseMonsterActionCombatInfo(e.desc),
    }));
  return {
    slug,
    nameFr: f.nameFr,
    searchText: normalizeText(`${f.nameFr} ${f.type}`),
    nameSearch: normalizeText(f.nameFr),
    type: f.type,
    size: f.size,
    alignment: f.alignment,
    armorClass: f.armorClass,
    armorDesc: f.armorDesc,
    hitPoints: f.hitPoints,
    hitDice: f.hitDice,
    speedJson: JSON.stringify(f.speed),
    abilitiesJson: JSON.stringify(f.abilities),
    savingThrowsJson: '[]',
    skillsJson: '[]',
    languagesJson: JSON.stringify(f.languages),
    challengeRating: f.challengeRating,
    xp: monsterXpForCR(f.challengeRating),
    senses: f.senses,
    telepathy: null,
    damageResistancesJson: JSON.stringify(f.damageResistances),
    damageImmunitiesJson: JSON.stringify(f.damageImmunities),
    conditionImmunitiesJson: JSON.stringify(f.conditionImmunities),
    traitsJson: JSON.stringify(f.traits),
    actionsJson: JSON.stringify(withCombatInfo(f.actions)),
    legendaryActionsJson: '[]',
    origin: 'custom',
    partyId,
    createdBy,
  };
}
